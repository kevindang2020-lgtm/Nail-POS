/**
 * payroll-workflow.ts — PURE pieces of the payroll review / approval / lock / payout workflow (Payroll mandate wave 2,
 * Oct 12 2026). No I/O: the Kysely repository and the service call these, the unit tests pin them.
 *
 *  • PayrollError — the §204 error taxonomy (codes registered in packages/api-contracts errors.ts).
 *  • canonicalLineHash — §119–§121: sha256 over the canonical, sorted line set + the calculation version. Stored as the
 *    preview hash (prepare) and the approval hash (approve): the approver approves THESE numbers, and a locked period
 *    whose recomputed hash differs from its approval hash was changed outside the workflow (tamper-evident).
 *  • evaluateValidation — §143–§145: the blocking / warning issues computed from the facts the repository gathers.
 *  • lineNetAndPayable — §148 / §150 / §61: net = earnings + tips + bonus + adjustments − deductions (signed); payable is
 *    never negative (a negative net is REVIEW_REQUIRED, never a negative payment); a deduction may never eat into tips.
 *  • payoutHeadroom — §149: paid ≤ approved payable.
 * Integer cents everywhere.
 */
import { createHash } from 'crypto';

/** Bumped when the payroll calculation changes in a way that would change historical figures (§119). */
export const PAYROLL_CALCULATION_VERSION = 'payroll-2026.10-w2';

export type PayrollErrorCode =
  | 'PAYROLL_PERIOD_NOT_FOUND' | 'PAYROLL_PERIOD_LOCKED' | 'PAYROLL_PERIOD_ALREADY_APPROVED' | 'PAYROLL_PERIOD_NOT_READY' | 'PAYROLL_ENGINE_NOT_ROLLED_OUT'
  | 'PAYROLL_VERSION_CONFLICT' | 'PAYROLL_VALIDATION_FAILED' | 'PAYOUT_EXCEEDS_PAYABLE' | 'ADJUSTMENT_NOT_ALLOWED'
  | 'PAY_PLAN_CONFLICT' | 'PAYROLL_PROVIDER_NOT_CONFIGURED' | 'PERMISSION_DENIED' | 'VALIDATION_FAILED' | 'SERVICE_UNAVAILABLE' | 'RESOURCE_NOT_FOUND'
  // the weekly paycheck (Paycheck mandate, Oct 21 2026)
  | 'PAYROLL_PAY_THROUGH_PAYOUTS' | 'PAYOUT_PLAN_INVALID' | 'PAYROLL_SUBMIT_BLOCKED' | 'PAYROLL_SELF_APPROVAL' | 'CHECK_NUMBER_IN_USE' | 'INSUFFICIENT_CASH' | 'PAYOUT_INVALID_STATE' | 'PIN_INVALID' | 'STATEMENT_NOT_FOUND'
  // deep-scan (Oct 22 2026): a period whose dates overlap another of the same scope would pay the same sales twice
  | 'PAYROLL_PERIOD_OVERLAP'
  // close-out (Oct 27 2026, §11.5): the QR handoff code the Tech App presented is not the live one (expired / replaced / wrong)
  | 'HANDOFF_TOKEN_INVALID'
  // 17.5 (Oct 27 2026): the pay-stub download budget per person (payroll-paystub.ts PayStubRateLimiter)
  | 'RATE_LIMITED';
const STATUS: Record<PayrollErrorCode, number> = {
  PAYROLL_PERIOD_NOT_FOUND: 404, PAYROLL_PERIOD_LOCKED: 409, PAYROLL_PERIOD_ALREADY_APPROVED: 409, PAYROLL_PERIOD_NOT_READY: 409, PAYROLL_ENGINE_NOT_ROLLED_OUT: 409,
  PAYROLL_VERSION_CONFLICT: 409, PAYROLL_VALIDATION_FAILED: 422, PAYOUT_EXCEEDS_PAYABLE: 422, ADJUSTMENT_NOT_ALLOWED: 409,
  PAY_PLAN_CONFLICT: 409, PAYROLL_PROVIDER_NOT_CONFIGURED: 503, PERMISSION_DENIED: 403, VALIDATION_FAILED: 400, SERVICE_UNAVAILABLE: 503, RESOURCE_NOT_FOUND: 404,
  PAYROLL_PAY_THROUGH_PAYOUTS: 409, PAYOUT_PLAN_INVALID: 422, PAYROLL_SUBMIT_BLOCKED: 422, PAYROLL_SELF_APPROVAL: 403, CHECK_NUMBER_IN_USE: 409, INSUFFICIENT_CASH: 409, PAYOUT_INVALID_STATE: 409, PIN_INVALID: 401, STATEMENT_NOT_FOUND: 404,
  PAYROLL_PERIOD_OVERLAP: 409, HANDOFF_TOKEN_INVALID: 401, RATE_LIMITED: 429,
};
/** Deep-scan (Oct 22 2026): two periods of one scope may not share a day — the line builder takes EVERY sale in a period's
 *  window, so an overlapping second period paid the same tickets again. A salon-wide period (no branch) overlaps every
 *  branch's; two different branches' periods may share days. Inclusive calendar dates (YYYY-MM-DD). */
export function periodsOverlap(a: { periodStart: string; periodEnd: string; branchId: string | null }, b: { periodStart: string; periodEnd: string; branchId: string | null }): boolean {
  const sameScope = a.branchId == null || b.branchId == null || a.branchId === b.branchId;
  return sameScope && String(a.periodStart).slice(0, 10) <= String(b.periodEnd).slice(0, 10) && String(b.periodStart).slice(0, 10) <= String(a.periodEnd).slice(0, 10);
}
export const overlapError = (other: { id: string; periodStart: string; periodEnd: string; label?: string | null }) =>
  new PayrollError('PAYROLL_PERIOD_OVERLAP', `These dates overlap the pay period ${other.label ? `"${other.label}" ` : ''}(${String(other.periodStart).slice(0, 10)} – ${String(other.periodEnd).slice(0, 10)}). The same sales would be paid twice — pick dates after it.`, { periodId: other.id, periodStart: String(other.periodStart).slice(0, 10), periodEnd: String(other.periodEnd).slice(0, 10) });

export class PayrollError extends Error {
  readonly status: number;
  constructor(public readonly code: PayrollErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message); this.name = 'PayrollError'; this.status = STATUS[code] ?? 400;
  }
}

/** The figures a line's hash covers — every money component, in a fixed order. */
export interface HashableLine {
  technicianId: string; servicesCount: number; grossSalesCents: number; commissionCents: number;
  retailCommissionCents?: number; cardTipCents?: number; cashTipCents?: number; tipsCents: number; guaranteeTopUpCents?: number;
  hourlyPayCents?: number; workedMinutes?: number; salaryPayCents?: number; bonusCents?: number; deductionCents?: number;
  adjustmentCents: number; netCents?: number; payableCents: number;
}
const HASH_FIELDS: (keyof HashableLine)[] = ['technicianId', 'servicesCount', 'grossSalesCents', 'commissionCents', 'retailCommissionCents',
  'cardTipCents', 'cashTipCents', 'tipsCents', 'guaranteeTopUpCents', 'hourlyPayCents', 'workedMinutes', 'salaryPayCents', 'bonusCents',
  'deductionCents', 'adjustmentCents', 'netCents', 'payableCents'];

/** PURE §121: deterministic sha256 of a period's line set. Order-independent (sorted by technician); missing numeric
 *  components hash as 0, so a legacy line and an explicit-zero line agree. */
export function canonicalLineHash(periodId: string, lines: HashableLine[], calculationVersion = PAYROLL_CALCULATION_VERSION): string {
  const rows = lines.slice().sort((a, b) => a.technicianId.localeCompare(b.technicianId))
    .map((l) => HASH_FIELDS.map((k) => (k === 'technicianId' ? String(l[k]) : String(Math.trunc(Number(l[k] ?? 0))))).join(':'));
  return createHash('sha256').update(JSON.stringify({ periodId, calculationVersion, rows })).digest('hex');
}

/** PURE §148/§150/§61: a line's signed net and the non-negative payable. Deductions come only out of non-tip earnings. */
export function lineNetAndPayable(c: {
  serviceCommissionCents: number; retailCommissionCents: number; guaranteeTopUpCents: number; hourlyPayCents: number; salaryPayCents: number;
  tipsCents: number; bonusCents: number; adjustmentCents: number; deductionCents: number;
}): { netCents: number; payableCents: number; reviewRequired: boolean; deductionExceedsNonTip: boolean } {
  const r = (n: number) => Math.round(Number(n) || 0);
  const nonTip = r(c.serviceCommissionCents) + r(c.retailCommissionCents) + r(c.guaranteeTopUpCents) + r(c.hourlyPayCents) + r(c.salaryPayCents) + r(c.bonusCents) + r(c.adjustmentCents);
  const deduction = Math.max(0, r(c.deductionCents));
  const netCents = nonTip + r(c.tipsCents) - deduction;
  return { netCents, payableCents: Math.max(0, netCents), reviewRequired: netCents < 0, deductionExceedsNonTip: deduction > Math.max(0, nonTip) };
}

/** PURE §149: how much more may be paid on a line. Failed / canceled payouts do not count. */
export function payoutHeadroom(payableCents: number, payouts: { amountCents: number; status: string }[]): { committedCents: number; paidCents: number; headroomCents: number } {
  const live = payouts.filter((p) => p.status !== 'failed' && p.status !== 'canceled');
  const committedCents = live.reduce((a, p) => a + Math.round(p.amountCents), 0);
  const paidCents = payouts.filter((p) => p.status === 'paid').reduce((a, p) => a + Math.round(p.amountCents), 0);
  return { committedCents, paidCents, headroomCents: Math.max(0, Math.round(payableCents) - committedCents) };
}

export type IssueSeverity = 'blocking' | 'warning';
export interface ValidationIssue { code: string; severity: IssueSeverity; message: string; count: number; technicianIds?: string[]; ticketIds?: string[] }
export interface ValidationResult { ok: boolean; blocking: number; warnings: number; issues: ValidationIssue[]; checkedAt: string }

/** The facts the repository gathers for one period window (all tenant- and branch-scoped). */
export interface ValidationFacts {
  lines: { technicianId: string; netCents: number; deductionCents: number; nonTipCents: number }[];
  unassignedSnapshotRows: { ticketId: string }[];                // §144 service without technician ownership
  paidTicketsWithoutSnapshot: { ticketId: string }[];             // §196 compensation projection failed / pending retry
  /** §147; `technicianIds` = who served the ticket (§67: the statements the unallocated tip belongs to) */
  tipMismatches: { ticketId: string; tipCents: number; allocatedCents: number; technicianIds?: string[] }[];
  duplicateSnapshotKeys: number;                                  // §160 (the unique index makes this 0 — checked anyway)
  pendingAdjustments: { technicianId: string | null; category: string; status: string }[];
  openTimeEntries: { technicianId: string; hourly: boolean }[];   // §144 unresolved time conflict
  openExceptions: { kind: string; severity: IssueSeverity }[];
  legacyRuleLines: number;                                        // §198 lines priced before rule provenance (587)
  reconciliationDrift: { technicianId: string; persistedPayableCents: number; recomputedPayableCents: number }[];   // §145
  deductionOverCap: { technicianId: string; type: string; capCents: number; totalCents: number }[];
  /** §67: technicians with lines priced by the fallback rate — no technician / policy rule and no service rate matched */
  missingRuleTechnicians?: string[];
}

/** PURE §143–§145: the pre-approval validation. `nowIso` is passed in (no clock reads in pure code). */
export function evaluateValidation(f: ValidationFacts, nowIso: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => { if (i.count > 0) issues.push(i); };
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  add({ code: 'MISSING_TECHNICIAN', severity: 'blocking', count: f.unassignedSnapshotRows.length, ticketIds: uniq(f.unassignedSnapshotRows.map((r) => r.ticketId)),
    message: 'Some paid services have no technician — assign them so the commission goes to the right person.' });
  add({ code: 'MISSING_COMPENSATION', severity: 'blocking', count: f.paidTicketsWithoutSnapshot.length, ticketIds: uniq(f.paidTicketsWithoutSnapshot.map((r) => r.ticketId)),
    message: 'Some paid tickets have no commission record yet (the earnings step failed). Retry them from Exceptions.' });
  add({ code: 'UNALLOCATED_TIP', severity: 'blocking', count: f.tipMismatches.length, ticketIds: uniq(f.tipMismatches.map((r) => r.ticketId)),
    technicianIds: uniq(f.tipMismatches.flatMap((r) => r.technicianIds ?? [])),
    message: 'Some tips are not fully split between technicians.' });
  add({ code: 'DUPLICATE_COMMISSION', severity: 'blocking', count: f.duplicateSnapshotKeys, message: 'A service line was credited twice.' });
  const negative = f.lines.filter((l) => l.netCents < 0);
  add({ code: 'NEGATIVE_NET_PAY', severity: 'blocking', count: negative.length, technicianIds: negative.map((l) => l.technicianId),
    message: 'A technician nets below zero after reversals or deductions. Review it — carry the balance to the next period or adjust.' });
  const overDeduct = f.lines.filter((l) => l.deductionCents > Math.max(0, l.nonTipCents));
  add({ code: 'DEDUCTION_EXCEEDS_EARNINGS', severity: 'blocking', count: overDeduct.length, technicianIds: overDeduct.map((l) => l.technicianId),
    message: 'A deduction is larger than the technician\'s non-tip earnings. Tips are never used for deductions.' });
  add({ code: 'DEDUCTION_OVER_CAP', severity: 'blocking', count: f.deductionOverCap.length, technicianIds: uniq(f.deductionOverCap.map((d) => d.technicianId)),
    message: 'A deduction is over the per-period limit set for its type.' });
  const hourlyOpen = f.openTimeEntries.filter((t) => t.hourly);
  add({ code: 'OPEN_TIME_ENTRY', severity: 'blocking', count: hourlyOpen.length, technicianIds: uniq(hourlyOpen.map((t) => t.technicianId)),
    message: 'An hourly technician is still clocked in for this period. Close or correct the time entry first.' });
  const otherOpen = f.openTimeEntries.filter((t) => !t.hourly);
  add({ code: 'OPEN_TIME_ENTRY_INFO', severity: 'warning', count: otherOpen.length, technicianIds: uniq(otherOpen.map((t) => t.technicianId)),
    message: 'Some technicians are still clocked in for this period.' });
  const blockingEx = f.openExceptions.filter((e) => e.severity === 'blocking');
  add({ code: 'OPEN_FINANCIAL_EXCEPTIONS', severity: 'blocking', count: blockingEx.length, message: 'There are unresolved financial exceptions.' });
  const warnEx = f.openExceptions.filter((e) => e.severity === 'warning');
  add({ code: 'FINANCIAL_EXCEPTIONS_TO_REVIEW', severity: 'warning', count: warnEx.length, message: 'There are financial exceptions to review (refunds against closed periods, chargebacks).' });
  add({ code: 'PENDING_ADJUSTMENTS', severity: 'warning', count: f.pendingAdjustments.length, technicianIds: uniq(f.pendingAdjustments.map((a) => a.technicianId).filter((x): x is string => !!x)),
    message: 'Some adjustments are waiting for a decision — they are not in these totals until approved.' });
  const noRule = uniq(f.missingRuleTechnicians ?? []);
  add({ code: 'MISSING_COMMISSION_RULE', severity: 'warning', count: noRule.length, technicianIds: noRule,
    message: 'Some services matched no commission rule (no technician rule, no service rate) — the salon default rate priced them.' });
  add({ code: 'LEGACY_RULE_PROVENANCE', severity: 'warning', count: f.legacyRuleLines,
    message: 'Some services were priced before rule tracking existed; their rule is shown as "Service-line snapshot".' });
  add({ code: 'PAYROLL_CHANGED_SINCE_BUILD', severity: 'warning', count: f.reconciliationDrift.length, technicianIds: f.reconciliationDrift.map((d) => d.technicianId),
    message: 'Sales, refunds or adjustments changed after these lines were built. Rebuild from sales to include them.' });
  if (f.lines.length === 0) issues.push({ code: 'NO_LINES', severity: 'warning', count: 1, message: 'This period has no technician lines yet.' });
  const blocking = issues.filter((i) => i.severity === 'blocking').length;
  return { ok: blocking === 0, blocking, warnings: issues.length - blocking, issues, checkedAt: nowIso };
}
