// commission-checks.ts — F2 (Finish the Five, 30 Oct 2026): the two financial discrepancy checks, PURE and deterministic.
// No database, no I/O, integer cents only. The scanner (commission-review.repository.ts) loads the canonical records and
// hands them here; these functions only decide whether a record is OK, a genuine mismatch, or cannot be verified.
// Nothing here — and nothing the scanner does with the result — pays, deducts, refunds, voids or edits a ledger row.
//
// 1. RATE vs HISTORICAL CONFIGURATION (checkRateLine)
//    For one paid service line (all its technicians' snapshot rows together):
//      a. the rate the line was PRICED with is the snapshot's captured commission type/value;
//      b. the rate that SHOULD have applied is resolved as of the moment the line was priced (ticket_service_lines
//         .created_at — when stampCommissionOnLine runs), with the same precedence the money path uses
//         (pickLineCommission: authored rule by level → the service's own rate → the tenant default). Only rule versions
//         that EXISTED at that moment take part (a rule authored later with a back-dated start is not history);
//      c. an approved Ticket Override is an authored rule like any other, so an authorised override is honoured;
//      d. when the answer depends on a value whose history is not recorded (the service's own rate or the tenant
//         default changed after the service — neither has a rate history table), the result is UNABLE_TO_VERIFY, never a
//         mismatch; so are legacy lines with no captured rate, tier-plan lines and unrecognised rule sources;
//      e. the expected technician earnings are recomputed with THE one formula (lineCommissionCents, or the
//         technician-funded split) on the recorded commissionable base and compared within the tolerance.
// 2. REFUND REVERSAL (checkRefundTicket)
//    For one ticket with POSTED refunds (payment_refunds.status = 'refunded'; requested / pending / failed / voided are
//    ignored), deduplicated by processor event id so a replayed webhook is counted once:
//      • tenant policy missing → POLICY_NOT_CONFIGURED (Review Required), never an expected deduction;
//      • NO_REVERSAL → any recorded commission reversal is excessive;
//      • PRO_RATA → the expected reversal per technician is exactly what the money path would build (buildRefundReversal,
//        per refund: whole ticket → full; named lines → those lines; otherwise pro-rata on the commissionable capture);
//      • recorded = commission reversal entries (refund_reversal / void_reversal / retail_reversal, not rejected) on the
//        ticket; duplicates (same refund + line + technician + category more than once) and entries for a technician
//        with no expected reversal (misattributed) are named. Tips are not commission and are not compared here;
//      • a commission already paid (prior period locked / future-period routing) is flagged for special review.
import { buildRefundReversal, type ReversibleRow, type RefundEvent } from '../compensation/compensation-adjustments';
import { expectedLineEarningsCents } from '../compensation/commission-expected';
import { pickLineCommission, resolveFromRules, mapVersionRowToRule, type PolicyVersionRow } from '../compensation/compensation-rule-loader';

export const RATE_TOLERANCE_CENTS = 1;          // largest-remainder splits may differ by one cent per line
export const REFUND_TOLERANCE_CENTS_PER_REFUND = 1;
export type CheckState = 'OK' | 'MISMATCH' | 'UNABLE_TO_VERIFY';
export type Severity = 'low' | 'medium' | 'high';

export function severityFor(deltaCents: number): { severity: Severity; reason: string } {
  const d = Math.abs(deltaCents);
  if (d >= 500) return { severity: 'high', reason: 'difference of $5.00 or more' };
  if (d >= 100) return { severity: 'medium', reason: 'difference between $1.00 and $4.99' };
  return { severity: 'low', reason: 'difference under $1.00' };
}

// ── 1. rate vs historical configuration ──────────────────────────────────────────────────────────────────────────
export interface RateSnapshotRow {
  snapshotId: string; technicianId: string | null; commissionableCents: number; earningsCents: number;
}
export interface RateLineInput {
  tenantId: string; ticketId: string | null; serviceLineId: string; branchId: string | null;
  serviceId: string | null; serviceCategory: string | null; technicianId: string | null;   // the line's primary technician
  pricedAt: string;                  // when the line was priced (ISO)
  recordedType: string | null; recordedValue: number | null;
  ruleSource: string | null; policyId: string | null; policyVersion: number | null;
  discountCents: number; discountFunding: string | null;
  rows: RateSnapshotRow[];
}
export interface RateHistory {
  /** every authored policy version (all statuses the resolver accepts) WITH its created_at */
  versions: (PolicyVersionRow & { created_at: string | Date })[];
  /** the service's own rate today and the last time the service row changed */
  service: { commission_type: string | null; commission_value: number | null; updated_at: string | Date | null } | null;
  /** the tenant default today and the last time the tenant row changed */
  tenantDefault: { percent: number; updatedAt: string | Date | null };
}
export interface RateCheckResult {
  state: CheckState; reasons: string[];
  expected: { type: 'percent' | 'fixed'; value: number; source: string; policyId: string | null; policyVersion: number | null } | null;
  recorded: { type: string | null; value: number | null };
  expectedCents: number | null; recordedCents: number; deltaCents: number | null; explanation: string;
}

const KNOWN_SOURCES = new Set(['Ticket Override', 'Technician + Service', 'Technician + Category', 'Technician Default', 'Branch + Service',
  'Branch + Category', 'Service', 'Category', 'Branch Default', 'Salon Default', 'Service default', 'Tenant default rate']);
const ms = (v: string | Date | null | undefined) => (v == null ? NaN : new Date(v).getTime());
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const rateText = (t: string | null, v: number | null) => (v == null ? 'no rate' : t === 'fixed' || t === 'flat' ? `${money(v)} fixed` : `${v}%`);

/** expected technician earnings on the recorded base — the compensation authority's own formula */
export const expectedEarningsCents = expectedLineEarningsCents;

export function checkRateLine(line: RateLineInput, hist: RateHistory): RateCheckResult {
  const recordedCents = line.rows.reduce((n, r) => n + Math.round(r.earningsCents || 0), 0);
  const base = line.rows.reduce((n, r) => n + Math.round(r.commissionableCents || 0), 0);
  const recorded = { type: line.recordedType, value: line.recordedValue };
  const unable = (why: string): RateCheckResult => ({ state: 'UNABLE_TO_VERIFY', reasons: [why], expected: null, recorded, expectedCents: null, recordedCents, deltaCents: null,
    explanation: `Cannot verify: ${why}. No finding is raised.` });
  if (line.recordedValue == null || line.recordedType == null) return unable('the line carries no captured commission rate (legacy or imported line)');
  if (line.ruleSource && /tier/i.test(line.ruleSource)) return unable('the line was priced by a tier plan, which depends on period volume');
  if (line.ruleSource && !KNOWN_SOURCES.has(line.ruleSource)) return unable(`unrecognised rule source "${line.ruleSource}"`);
  const at = ms(line.pricedAt);
  if (!Number.isFinite(at)) return unable('the service time is missing');

  // b. rule versions that existed when the line was priced
  const existed = hist.versions.filter((v) => Number.isFinite(ms(v.created_at)) && ms(v.created_at) <= at);
  const rules = existed.map((v) => mapVersionRowToRule(line.tenantId, v));
  const resolved = rules.length ? resolveFromRules(rules, { tenantId: line.tenantId, branchId: line.branchId, technicianId: line.technicianId, serviceId: line.serviceId,
    serviceCategory: line.serviceCategory, ticketId: line.ticketId, asOf: new Date(at).toISOString() }) : null;
  // the snapshot names a policy version that no longer exists → the history needed is gone
  if (line.policyId && !hist.versions.some((v) => String(v.policy_id) === String(line.policyId))) return unable('the policy the line names has no stored version (deleted configuration)');

  const svcUnchanged = !hist.service || (Number.isFinite(ms(hist.service.updated_at)) && ms(hist.service.updated_at) <= at);
  const tenantUnchanged = Number.isFinite(ms(hist.tenantDefault.updatedAt)) && ms(hist.tenantDefault.updatedAt) <= at;
  const picked = pickLineCommission(resolved, hist.service ? { commission_type: hist.service.commission_type, commission_value: hist.service.commission_value } : null,
    { commissionType: 'percent', commissionValue: hist.tenantDefault.percent, source: 'Tenant default rate' });
  // which inputs did the answer depend on?
  const usedService = picked.source === 'Service default';
  const usedTenant = picked.source === 'Tenant default rate';
  // a service rate could have beaten a less specific rule: only when the service has a rate today, or the line itself says
  // it was priced from the service default (a rate set at the time and removed later would have left that source)
  const svcHasRate = !!hist.service && String(hist.service.commission_type ?? 'none') !== 'none' && hist.service.commission_value != null;
  const serviceMayHaveDecided = (svcHasRate || line.ruleSource === 'Service default') && (!resolved || (resolved.specificity ?? 99) >= 8);
  if ((usedService || serviceMayHaveDecided) && !svcUnchanged) return unable("the service's own commission rate changed after this service and its history is not recorded");
  if (usedTenant && !tenantUnchanged) return unable('the salon default commission changed after this service and its history is not recorded');

  const expected = { type: picked.commissionType, value: Number(picked.commissionValue), source: picked.source, policyId: picked.policyId ?? null, policyVersion: picked.policyVersion ?? null };
  const recType = line.recordedType === 'fixed' || line.recordedType === 'flat' ? 'fixed' : 'percent';
  const rateMatches = recType === expected.type && Number(line.recordedValue) === expected.value;
  const expectedCents = expectedEarningsCents(base, Math.max(0, Math.round(line.discountCents || 0)), line.discountFunding, expected.type, expected.value);
  const deltaCents = recordedCents - expectedCents;
  const amountOk = Math.abs(deltaCents) <= RATE_TOLERANCE_CENTS;
  const reasons: string[] = [];
  if (!rateMatches) reasons.push(`captured ${rateText(line.recordedType, line.recordedValue)} but the configuration in effect at ${new Date(at).toISOString()} was ${rateText(expected.type, expected.value)} (${expected.source}${expected.policyVersion != null ? `, version ${expected.policyVersion}` : ''})`);
  if (!amountOk) reasons.push(`earnings ${money(recordedCents)} on a ${money(base)} base; ${rateText(expected.type, expected.value)} gives ${money(expectedCents)}`);
  if (!reasons.length) return { state: 'OK', reasons: [], expected, recorded, expectedCents, recordedCents, deltaCents, explanation: `Captured ${rateText(line.recordedType, line.recordedValue)} matches the configuration in effect at service time (${expected.source}).` };
  return { state: 'MISMATCH', reasons, expected, recorded, expectedCents, recordedCents, deltaCents,
    explanation: `Expected ${money(expectedCents)} (${rateText(expected.type, expected.value)} of ${money(base)}, ${expected.source}); recorded ${money(recordedCents)}; difference ${money(deltaCents)}. Rounding: largest remainder, tolerance ${RATE_TOLERANCE_CENTS}¢.` };
}

// ── 2. refund reversal ──────────────────────────────────────────────────────────────────────────────────────────
export type RefundPolicy = 'PRO_RATA' | 'NO_REVERSAL' | null;
export interface RefundRow { id: string; amountCents: number; status: string; dedupeKey: string | null; createdAt: string; serviceLineIds?: string[] | null; tipRefunded?: boolean }
export interface RecordedReversal { id: string; technicianId: string | null; serviceLineId: string | null; category: string; amountCents: number; status: string; refundPaymentId: string | null; targetsFuturePeriod: boolean }
export interface RefundTicketInput {
  ticketId: string; capturedCents: number; nonCommissionableCents: number | null;
  refunds: RefundRow[]; rows: ReversibleRow[]; recorded: RecordedReversal[]; policy: RefundPolicy; periodPaid: boolean;
}
export type RefundFindingKind = 'POLICY_NOT_CONFIGURED' | 'MISSING' | 'UNDER' | 'EXCESSIVE' | 'DUPLICATE' | 'MISATTRIBUTED';
export interface RefundFinding {
  kind: RefundFindingKind; technicianId: string | null; expectedCents: number | null; recordedCents: number; deltaCents: number | null;
  refundIds: string[]; paidAlready: boolean; explanation: string; recordedEntryIds: string[];
}
const COMMISSION_REVERSAL = new Set(['refund_reversal', 'void_reversal', 'retail_reversal']);
const NOT_RECORDED = new Set(['rejected', 'cancelled', 'canceled']);

/** posted refunds only, one per processor event (a replayed webhook is the same refund) */
export function postedRefunds(refunds: RefundRow[]): RefundRow[] {
  const seen = new Set<string>(); const out: RefundRow[] = [];
  for (const r of [...refunds].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (r.status !== 'refunded' || !(r.amountCents > 0)) continue;
    const k = r.dedupeKey || r.id; if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

/** what the money path would reverse, per technician, for these posted refunds (commission only — never tips) */
export function expectedReversalByTech(input: RefundTicketInput, posted: RefundRow[]): Map<string, number> {
  const out = new Map<string, number>(); const add = (t: string | null, c: number) => out.set(t ?? 'unassigned', (out.get(t ?? 'unassigned') ?? 0) + c);
  const total = posted.reduce((n, r) => n + r.amountCents, 0);
  const events: RefundEvent[] = total >= input.capturedCents && input.capturedCents > 0
    ? [{ type: 'full', tipRefunded: true }]
    : posted.map((r) => (r.serviceLineIds?.length
      ? { type: 'partial', lines: [...new Set(r.serviceLineIds)].map((serviceLineId) => ({ serviceLineId, refundTip: !!r.tipRefunded })), refundPaymentId: r.id }
      : { type: 'partial', refundedCents: r.amountCents, capturedCents: input.capturedCents, ...(input.nonCommissionableCents != null ? { nonCommissionableCents: input.nonCommissionableCents } : {}), tipRefunded: !!r.tipRefunded, refundPaymentId: r.id }));
  for (const ev of events) {
    for (const e of buildRefundReversal(input.ticketId, input.rows, ev, { reason: 'check', requestedBy: null })) {
      if (COMMISSION_REVERSAL.has(e.category)) add(e.technicianId, Math.abs(e.amountCents));
    }
  }
  return out;
}

export function checkRefundTicket(input: RefundTicketInput): RefundFinding[] {
  const posted = postedRefunds(input.refunds);
  if (!posted.length) return [];
  const refundIds = posted.map((r) => r.id);
  const recorded = input.recorded.filter((e) => COMMISSION_REVERSAL.has(e.category) && !NOT_RECORDED.has(e.status));
  const paidAlready = input.periodPaid || recorded.some((e) => e.targetsFuturePeriod);
  const recByTech = new Map<string, { cents: number; ids: string[] }>();
  for (const e of recorded) { const k = e.technicianId ?? 'unassigned'; const cur = recByTech.get(k) ?? { cents: 0, ids: [] }; cur.cents += Math.abs(Math.round(e.amountCents)); cur.ids.push(e.id); recByTech.set(k, cur); }
  const tid = (k: string) => (k === 'unassigned' ? null : k);
  const refundedTotal = posted.reduce((n, r) => n + r.amountCents, 0);

  if (input.policy == null) {
    const rec = recorded.reduce((n, e) => n + Math.abs(Math.round(e.amountCents)), 0);
    return [{ kind: 'POLICY_NOT_CONFIGURED', technicianId: null, expectedCents: null, recordedCents: rec, deltaCents: null, refundIds, paidAlready, recordedEntryIds: recorded.map((e) => e.id),
      explanation: `Posted refunds of ${money(refundedTotal)} on this ticket; the salon has not configured a refund-reversal policy, so the expected commission reversal cannot be decided. Review required — nothing is deducted automatically.` }];
  }

  const findings: RefundFinding[] = [];
  // duplicates: the same refund + line + technician + category recorded more than once
  const dupKey = new Map<string, RecordedReversal[]>();
  for (const e of recorded) { if (!e.refundPaymentId) continue; const k = [e.refundPaymentId, e.serviceLineId ?? '', e.technicianId ?? '', e.category].join('|'); dupKey.set(k, [...(dupKey.get(k) ?? []), e]); }
  for (const list of dupKey.values()) if (list.length > 1) {
    const extra = list.slice(1).reduce((n, e) => n + Math.abs(Math.round(e.amountCents)), 0);
    findings.push({ kind: 'DUPLICATE', technicianId: list[0].technicianId, expectedCents: Math.abs(Math.round(list[0].amountCents)), recordedCents: Math.abs(Math.round(list[0].amountCents)) + extra, deltaCents: extra,
      refundIds: [String(list[0].refundPaymentId)], paidAlready, recordedEntryIds: list.map((e) => e.id), explanation: `The same reversal (refund ${list[0].refundPaymentId}, ${list[0].category}) is recorded ${list.length} times; ${money(extra)} is counted more than once.` });
  }

  const expected = input.policy === 'NO_REVERSAL' ? new Map<string, number>() : expectedReversalByTech(input, posted);
  const tol = REFUND_TOLERANCE_CENTS_PER_REFUND * posted.length;
  const techs = new Set<string>([...expected.keys(), ...recByTech.keys()]);
  for (const k of [...techs].sort()) {
    const exp = expected.get(k) ?? 0; const rec = recByTech.get(k)?.cents ?? 0; const ids = recByTech.get(k)?.ids ?? []; const delta = rec - exp;
    if (Math.abs(delta) <= tol) continue;
    const policyText = input.policy === 'NO_REVERSAL' ? 'the salon policy is no commission reversal on refunds' : 'the salon policy is a pro-rata commission reversal';
    if (exp === 0 && rec > 0) findings.push({ kind: input.policy === 'NO_REVERSAL' ? 'EXCESSIVE' : 'MISATTRIBUTED', technicianId: tid(k), expectedCents: 0, recordedCents: rec, deltaCents: delta, refundIds, paidAlready, recordedEntryIds: ids,
      explanation: input.policy === 'NO_REVERSAL' ? `Reversals of ${money(rec)} are recorded but ${policyText}.` : `Reversals of ${money(rec)} are recorded for a technician who earned nothing on the refunded lines.` });
    else if (rec === 0) findings.push({ kind: 'MISSING', technicianId: tid(k), expectedCents: exp, recordedCents: 0, deltaCents: delta, refundIds, paidAlready, recordedEntryIds: ids,
      explanation: `Posted refunds of ${money(refundedTotal)}; ${policyText}, so ${money(exp)} of commission should be reversed. No authorised reversal entry exists. Investigate — nothing is deducted automatically.` });
    else findings.push({ kind: delta < 0 ? 'UNDER' : 'EXCESSIVE', technicianId: tid(k), expectedCents: exp, recordedCents: rec, deltaCents: delta, refundIds, paidAlready, recordedEntryIds: ids,
      explanation: `Expected reversal ${money(exp)} (${policyText}); recorded ${money(rec)}; difference ${money(delta)}.` });
  }
  return findings;
}

// ── fingerprints (stable per tenant: same source + same relevant version → same finding, so a rescan never duplicates) ──
export function rateFingerprint(serviceLineId: string, r: RateCheckResult): string {
  return ['RATE_CONFIG', serviceLineId, `${r.recorded.type ?? ''}:${r.recorded.value ?? ''}`, r.expected ? `${r.expected.policyId ?? r.expected.source}:${r.expected.policyVersion ?? ''}:${r.expected.value}` : '', r.recordedCents].join('|').slice(0, 300);
}
export function refundFingerprint(ticketId: string, f: RefundFinding): string {
  return ['REFUND_REVERSAL', ticketId, f.kind, f.technicianId ?? '-', [...f.refundIds].sort().join(',')].join('|').slice(0, 300);
}
