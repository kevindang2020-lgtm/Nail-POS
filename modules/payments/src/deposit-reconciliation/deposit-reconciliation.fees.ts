// deposit-reconciliation.fees.ts — versioned fee schedules + the PURE fee-reconciliation engine. Validates the
// processor fee actually charged on a settlement (payment_settlements.fee_cents) against the tenant's configured
// fee schedule. CRITICAL honesty rule (per spec): when a component can't be computed from available data — e.g.
// a per-transaction fee but the settlement carries no transaction count, or interchange detail is missing — the
// result is 'unverified', NOT 'fee_difference'. We never claim a fee is wrong without the data to prove it.
import type { Settlement } from './deposit-reconciliation.dto';

export interface FeeSchedule {
  id: string;
  processorType: string;
  label: string;
  version: number;
  effectiveFrom: string;          // YYYY-MM-DD
  percentageBps: number;          // basis points, e.g. 290 = 2.90%
  perTransactionCents: number;    // per-transaction fee (needs a txn count to apply)
  batchCents: number;             // per settlement/batch
  monthlyCents: number;           // account fee — NOT applied per settlement
  notes: string | null;
}

export type FeeReconStatus = 'matched' | 'fee_difference' | 'unverified' | 'no_schedule';

export interface FeeComponents { percentageCents: number; perTransactionCents: number | null; batchCents: number }

export interface FeeReconRow {
  settlementId: string;
  processorType: string | null;
  settledAt: string | null;
  grossCents: number;
  actualFeeCents: number;
  expectedFeeCents: number | null;    // null when unverified / no schedule
  differenceCents: number | null;     // actual - expected (null when not computable)
  status: FeeReconStatus;
  scheduleVersion: number | null;
  components: FeeComponents | null;
  confidence: number;
  unverifiedReason: string | null;
}

export interface FeeReconKpis {
  settlementCount: number;
  verified: number;
  unverified: number;
  noSchedule: number;
  matched: number;
  feeDifferences: number;
  expectedFeeCents: number;   // sum over verified rows
  actualFeeCents: number;     // sum over all rows
  feeDifferenceCents: number; // sum of |difference| over verified rows
}

export interface FeeReconState { kpis: FeeReconKpis; rows: FeeReconRow[] }

export interface FeeOptions { toleranceCents: number }
export const DEFAULT_FEE_OPTIONS: FeeOptions = { toleranceCents: 50 };

const dateOf = (iso: string | null): string | null => (iso ? String(iso).slice(0, 10) : null);

// The schedule in effect for a settlement: same processor, greatest effective_from <= the settlement date.
export function applicableSchedule(schedules: FeeSchedule[], s: Settlement): FeeSchedule | null {
  const d = dateOf(s.settledAt);
  const eligible = schedules
    .filter((fs) => (!s.processorType || fs.processorType === s.processorType) && (!d || fs.effectiveFrom <= d))
    .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.version - a.version : b.effectiveFrom.localeCompare(a.effectiveFrom)));
  return eligible[0] ?? null;
}

// Expected fee for a settlement under a schedule. txnCount is usually unknown (settlements carry no count) so a
// non-zero per-transaction fee makes the total unverifiable — reported honestly rather than guessed.
export function expectedFee(
  schedule: FeeSchedule, s: Settlement, txnCount: number | null,
): { verifiable: boolean; expectedCents: number | null; components: FeeComponents; unverifiedReason: string | null } {
  const percentageCents = Math.round((s.grossCents * schedule.percentageBps) / 10000);
  const batchCents = schedule.batchCents;
  if (schedule.perTransactionCents > 0 && (txnCount == null || !Number.isFinite(txnCount))) {
    return { verifiable: false, expectedCents: null, components: { percentageCents, perTransactionCents: null, batchCents }, unverifiedReason: 'Per-transaction fee cannot be verified: settlement has no transaction count' };
  }
  const perTx = schedule.perTransactionCents * (txnCount ?? 0);
  return { verifiable: true, expectedCents: percentageCents + batchCents + perTx, components: { percentageCents, perTransactionCents: perTx, batchCents }, unverifiedReason: null };
}

export function reconcileFee(schedule: FeeSchedule | null, s: Settlement, opts: FeeOptions, txnCount: number | null = null): FeeReconRow {
  const base = { settlementId: s.id, processorType: s.processorType, settledAt: s.settledAt, grossCents: s.grossCents, actualFeeCents: s.feeCents };
  if (!schedule) return { ...base, expectedFeeCents: null, differenceCents: null, status: 'no_schedule', scheduleVersion: null, components: null, confidence: 0, unverifiedReason: 'No fee schedule is configured for this processor and date' };
  const ef = expectedFee(schedule, s, txnCount);
  if (!ef.verifiable) return { ...base, expectedFeeCents: null, differenceCents: null, status: 'unverified', scheduleVersion: schedule.version, components: ef.components, confidence: 0.3, unverifiedReason: ef.unverifiedReason };
  const expected = ef.expectedCents as number;
  const diff = s.feeCents - expected;
  const matched = Math.abs(diff) <= opts.toleranceCents;
  return { ...base, expectedFeeCents: expected, differenceCents: diff, status: matched ? 'matched' : 'fee_difference', scheduleVersion: schedule.version, components: ef.components, confidence: matched ? 0.9 : 0.8, unverifiedReason: null };
}

export function buildFeeReconState(settlements: Settlement[], schedules: FeeSchedule[], opts: FeeOptions): FeeReconState {
  const rows = settlements
    .map((s) => reconcileFee(applicableSchedule(schedules, s), s, opts))
    .sort((a, b) => String(b.settledAt || '').localeCompare(String(a.settledAt || '')));
  const verifiedRows = rows.filter((r) => r.status === 'matched' || r.status === 'fee_difference');
  const kpis: FeeReconKpis = {
    settlementCount: settlements.length,
    verified: verifiedRows.length,
    unverified: rows.filter((r) => r.status === 'unverified').length,
    noSchedule: rows.filter((r) => r.status === 'no_schedule').length,
    matched: rows.filter((r) => r.status === 'matched').length,
    feeDifferences: rows.filter((r) => r.status === 'fee_difference').length,
    expectedFeeCents: verifiedRows.reduce((a, r) => a + (r.expectedFeeCents || 0), 0),
    actualFeeCents: rows.reduce((a, r) => a + r.actualFeeCents, 0),
    feeDifferenceCents: verifiedRows.reduce((a, r) => a + Math.abs(r.differenceCents || 0), 0),
  };
  return { kpis, rows };
}

// ---- validation ----
export function validateFeeSchedule(i: { processorType?: string; label?: string; effectiveFrom?: string; percentageBps?: number }): { ok: boolean; error?: string } {
  if (!i?.processorType || !String(i.processorType).trim()) return { ok: false, error: 'A processor is required' };
  if (!i?.label || !String(i.label).trim()) return { ok: false, error: 'A label is required' };
  if (!i?.effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(String(i.effectiveFrom))) return { ok: false, error: 'A valid effective date (YYYY-MM-DD) is required' };
  if (i.percentageBps != null && (Number(i.percentageBps) < 0 || Number(i.percentageBps) > 10000)) return { ok: false, error: 'Percentage (bps) must be between 0 and 10000' };
  return { ok: true };
}
