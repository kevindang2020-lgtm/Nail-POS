import type { DepositStatusDistribution } from '@aipowersalon/api-contracts/platform';
import type { SettlementStatus, ReconciliationStatus, FundingExceptionType } from '@aipowersalon/api-contracts/platform';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { SettlementKpis } from '@aipowersalon/api-contracts/platform';
import type { SettlementKpis } from '@aipowersalon/api-contracts/platform';
export type { SettlementStatus, ReconciliationStatus, FundingExceptionType };   // owned by packages/api-contracts (Constitution 13 §13)
// settlements-core.ts — pure, I/O-free settlement + reconciliation math for the Super Admin "Settlements & Deposits"
// page. No DB, no clock (callers pass nowMs / dates). Money is INTEGER CENTS everywhere (matching the existing
// payment_settlements table). ONE documented sign convention is used across API, UI, exports, and reconciliation:
//
//   Deductions (refunds, chargebacks, processing fees) are stored as POSITIVE MAGNITUDES and SUBTRACTED.
//   Adjustments are SIGNED (positive increases the deposit, negative decreases it).
//     Net Deposit = Gross Transactions − Refunds − Chargebacks − Processing Fees + Signed Adjustments
//   Reconciliation Difference = Actual Deposit − Expected Net Deposit   (SIGNED; positive = overfunded)
//
// Nothing here mutates processor/bank source data; reconciliation only DERIVES a difference + severity.

export type DepositStatus =
  | 'expected' | 'pending' | 'detected' | 'matched' | 'partially_matched' | 'confirmed' | 'delayed' | 'missing' | 'failed' | 'reversed';

export const SETTLEMENT_STATUSES: SettlementStatus[] = ['pending', 'processing', 'settled', 'partially_settled', 'delayed', 'failed', 'held', 'cancelled', 'reversed', 'unknown'];
export const RECONCILIATION_STATUSES: ReconciliationStatus[] = ['not_started', 'pending', 'matched', 'in_review', 'discrepancy_found', 'partially_reconciled', 'reconciled', 'resolved', 'escalated', 'failed'];

export function normalizeSettlementStatus(v: unknown): SettlementStatus {
  const s = String(v ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return (SETTLEMENT_STATUSES as string[]).includes(s) ? (s as SettlementStatus) : 'unknown';
}
export function normalizeReconStatus(v: unknown): ReconciliationStatus {
  const s = String(v ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return (RECONCILIATION_STATUSES as string[]).includes(s) ? (s as ReconciliationStatus) : 'not_started';
}

// --- money -----------------------------------------------------------------------------------------------------
export interface BatchAmounts {
  grossCents: number; refundsCents: number; chargebacksCents: number; feesCents: number; adjustmentsCents: number;
}
const int = (n: unknown): number => { const v = Math.trunc(Number(n)); return Number.isFinite(v) ? v : 0; };

/** Net deposit from the documented convention. Deductions are positive magnitudes; adjustments are signed. */
export function netDepositCents(a: BatchAmounts): number {
  return int(a.grossCents) - Math.abs(int(a.refundsCents)) - Math.abs(int(a.chargebacksCents)) - Math.abs(int(a.feesCents)) + int(a.adjustmentsCents);
}

/** Signed reconciliation difference = actual − expected. Null when no actual deposit is known yet (honest, not 0). */
export function reconciliationDiffCents(actualDepositCents: number | null, expectedNetCents: number): number | null {
  if (actualDepositCents == null) return null;
  return int(actualDepositCents) - int(expectedNetCents);
}

export type DiffSeverity = 'exact' | 'rounding' | 'minor' | 'review' | 'critical';
export interface Tolerance { roundingCents: number; minorCents: number; reviewCents: number }
export const DEFAULT_TOLERANCE: Tolerance = { roundingCents: 100, minorCents: 5000, reviewCents: 50000 };

/** Classify a signed difference into a severity band. `null` (unknown) → 'review' (needs a human), never 'exact'. */
export function diffSeverity(diffCents: number | null, t: Tolerance = DEFAULT_TOLERANCE): DiffSeverity {
  if (diffCents == null) return 'review';
  const a = Math.abs(diffCents);
  if (a === 0) return 'exact';
  if (a <= t.roundingCents) return 'rounding';
  if (a <= t.minorCents) return 'minor';
  if (a <= t.reviewCents) return 'review';
  return 'critical';
}
export const isUnresolvedDiscrepancy = (diffCents: number | null, recon: ReconciliationStatus): boolean =>
  diffCents != null && diffCents !== 0 && recon !== 'resolved' && recon !== 'reconciled';

// --- deposit timing / missing detection ------------------------------------------------------------------------
/** A settled batch whose expected deposit date has passed with no actual deposit, beyond a grace window, is "missing".
 *  Before the grace window elapses it is only "delayed"/"expected" — never prematurely "missing". Weekends are skipped
 *  by the caller-supplied `businessDaysElapsed`; this function only applies the grace threshold to real elapsed days. */
export function depositTimingState(input: {
  settlementStatus: SettlementStatus; hasActualDeposit: boolean; expectedDateMs: number | null; nowMs: number; graceBusinessDays?: number; businessDaysPastExpected?: number;
}): DepositStatus {
  if (input.hasActualDeposit) return 'confirmed';
  if (input.settlementStatus === 'failed' || input.settlementStatus === 'reversed') return 'failed';
  if (input.expectedDateMs == null) return 'expected';
  const grace = input.graceBusinessDays ?? 1;
  const past = input.businessDaysPastExpected ?? (input.nowMs > input.expectedDateMs ? Math.floor((input.nowMs - input.expectedDateMs) / 86_400_000) : 0);
  if (input.nowMs <= input.expectedDateMs) return 'expected';
  if (past <= grace) return 'delayed';
  return 'missing';
}

// --- distributions & KPIs --------------------------------------------------------------------------------------
export interface BatchLike extends BatchAmounts {
  settlementStatus: SettlementStatus; reconciliationStatus: ReconciliationStatus;
  actualDepositCents: number | null; expectedNetCents: number;
}

/** Deposit-status distribution over the batch population; counts are mutually exclusive and reconcile to the total. */
export function depositStatusDistribution(batches: { settlementStatus: SettlementStatus }[]): DepositStatusDistribution {
  const total = batches.length;
  const counts = new Map<SettlementStatus, number>();
  for (const b of batches) counts.set(b.settlementStatus, (counts.get(b.settlementStatus) ?? 0) + 1);
  const slices = [...counts.entries()].map(([status, count]) => ({ status, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);
  return { total, slices };
}


const PENDING_STATUSES: SettlementStatus[] = ['pending', 'processing', 'delayed', 'held', 'partially_settled'];

/** Roll up the 8 KPI headline values from a batch population. All money in cents; every value reconciles to the rows. */
export function rollupKpis(batches: BatchLike[]): SettlementKpis {
  let gross = 0, net = 0, pending = 0, diff = 0, fees = 0, cbk = 0, exceptions = 0;
  for (const b of batches) {
    const expected = b.expectedNetCents;
    gross += int(b.grossCents); fees += Math.abs(int(b.feesCents)); cbk += Math.abs(int(b.chargebacksCents));
    const settledNet = b.actualDepositCents != null ? int(b.actualDepositCents) : expected;
    if (b.settlementStatus === 'settled' && b.actualDepositCents != null) net += int(b.actualDepositCents);
    if (PENDING_STATUSES.includes(b.settlementStatus)) pending += expected;
    const d = reconciliationDiffCents(b.actualDepositCents, expected);
    if (isUnresolvedDiscrepancy(d, b.reconciliationStatus)) diff += d as number;
    if (isFundingException(b)) exceptions += 1;
    void settledNet;
  }
  return { totalBatches: batches.length, grossCents: gross, netCents: net, pendingDepositsCents: pending, reconDiffCents: diff, feesCents: fees, chargebackCents: cbk, fundingExceptions: exceptions };
}

/** A batch is a funding exception when it is delayed/failed, has a large unresolved difference, or is missing funding. */
export function fundingExceptionType(b: BatchLike): FundingExceptionType | null {
  if (b.settlementStatus === 'failed' || b.settlementStatus === 'reversed') return 'failed_deposit';
  if (b.settlementStatus === 'delayed') return 'delayed_deposit';
  const d = reconciliationDiffCents(b.actualDepositCents, b.expectedNetCents);
  if (isUnresolvedDiscrepancy(d, b.reconciliationStatus) && diffSeverity(d) === 'critical') return 'large_difference';
  if (b.settlementStatus === 'settled' && b.actualDepositCents == null && (b.reconciliationStatus === 'escalated' || b.reconciliationStatus === 'discrepancy_found')) return 'missing_deposit';
  return null;
}
export const isFundingException = (b: BatchLike): boolean => fundingExceptionType(b) !== null;

/** Mask a bank account to a safe suffix. Never returns more than the last 4 digits. */
export function maskAccount(last4: string | null | undefined): string | null {
  if (!last4) return null;
  const d = String(last4).replace(/\D/g, '').slice(-4);
  return d.length === 4 ? `•••• ${d}` : null;
}
