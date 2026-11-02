/**
 * payroll-paycheck.ts — the PURE rules of the weekly paycheck (Kevin's Weekly Technician Paycheck, Cash Payout & Owner
 * Approval mandate, Oct 21 2026). Earnings come from the ONE payroll line (payroll_lines); this file only decides
 *   • what a pay statement says (the snapshot, the amount already received, the approved payable — §4–§5),
 *   • how the approved payable is split into payout instructions (50% check / 50% cash, odd cent to the primary
 *     method, manual percent or dollar splits under the salon's policy — §6–§7),
 *   • the check, cash, statement, plan and period-payout lifecycles (§5, §10–§13),
 *   • the weekly window and pay date (§3).
 * Integer cents everywhere. Nothing here touches the database.
 */
import { addDays } from '@aipowersalon/date-time';
import { defineStateMachine } from '@aipowersalon/database';

// ── lifecycles ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** payroll_statements.status (§5): a statement is a draft while the week is prepared, SUBMITTED to the owner, then
 *  APPROVED and LOCKED in the same step; it moves to ISSUED / PARTIALLY_PAID / PAID only as payouts actually complete.
 *  HELD = the owner approved the week but held this technician's statement. VOIDED = the week was reopened before any payout. */
export const PAY_STATEMENT = defineStateMachine({
  name: 'payroll_statement', table: 'payroll_statements', column: 'status',
  states: ['draft', 'ready_for_review', 'submitted', 'held', 'approved', 'locked', 'issued', 'partially_paid', 'paid', 'voided'],
  transitions: {
    draft: ['ready_for_review', 'submitted', 'voided'],
    ready_for_review: ['draft', 'submitted', 'voided'],
    submitted: ['draft', 'approved', 'held', 'voided'],
    held: ['approved', 'draft', 'voided'],
    approved: ['locked'],
    locked: ['issued', 'partially_paid', 'paid', 'voided'],
    issued: ['locked', 'partially_paid', 'paid'],
    partially_paid: ['issued', 'locked', 'paid'],
    paid: ['partially_paid', 'issued', 'locked'],   // a delivered check voided later reopens what is owed
  },
  initial: ['draft'],
});
/** payroll_payout_plans.status (§6). */
export const PAYOUT_PLAN = defineStateMachine({
  name: 'payroll_payout_plan', table: 'payroll_payout_plans', column: 'status',
  states: ['draft', 'submitted', 'approved', 'superseded'],
  transitions: { draft: ['submitted', 'superseded'], submitted: ['draft', 'approved', 'superseded'], approved: ['superseded'] },
  initial: ['draft'],
});
/** payroll_payout_instructions.status. */
export const PAYOUT_INSTRUCTION = defineStateMachine({
  name: 'payroll_payout_instruction', table: 'payroll_payout_instructions', column: 'status',
  states: ['planned', 'materialized', 'canceled'],
  transitions: { planned: ['materialized', 'canceled'], materialized: ['canceled'] },
  initial: ['planned'],
});
/** payroll_payouts.check_status (§10): a printed check is not a cleared check; a voided check stays in history. */
export const CHECK_PAYOUT = defineStateMachine({
  name: 'payroll_check_payout', table: 'payroll_payouts', column: 'check_status',
  states: ['planned', 'issued', 'delivered', 'cleared', 'voided', 'returned'],
  transitions: { planned: ['issued', 'voided'], issued: ['delivered', 'voided'], delivered: ['cleared', 'voided', 'returned'], cleared: ['returned'] },
  initial: ['planned', 'issued'],
});
/** payroll_payouts.cash_status (§11): planning cash is not paying it; paid only when handed over and confirmed. */
export const CASH_PAYOUT = defineStateMachine({
  name: 'payroll_cash_payout', table: 'payroll_payouts', column: 'cash_status',
  states: ['planned', 'ready_for_handoff', 'handed_off', 'acknowledged', 'disputed', 'canceled'],
  transitions: {
    planned: ['ready_for_handoff', 'canceled'],
    ready_for_handoff: ['handed_off', 'acknowledged', 'canceled'],
    handed_off: ['acknowledged', 'disputed'],
    disputed: ['ready_for_handoff', 'acknowledged', 'canceled'],
  },
  initial: ['planned'],
});
/** payroll_periods.payout_status (§13): what has actually been paid on the approved week. */
export const PERIOD_PAYOUT = defineStateMachine({
  name: 'payroll_period_payout', table: 'payroll_periods', column: 'payout_status',
  states: ['none', 'unpaid', 'partially_paid', 'paid'],
  transitions: { none: ['unpaid', 'partially_paid', 'paid'], unpaid: ['partially_paid', 'paid', 'none'], partially_paid: ['paid', 'unpaid'], paid: ['partially_paid', 'unpaid'] },
  initial: ['none'],
});

// ── policy & splits ─────────────────────────────────────────────────────────────────────────────────────────────────
export const INSTRUCTION_METHODS = ['check', 'cash', 'ach', 'direct_deposit', 'external_transfer', 'payroll_provider'] as const;
export type InstructionMethod = typeof INSTRUCTION_METHODS[number];
export const POLICY_TYPES = ['split_check_cash', 'all_check', 'all_cash', 'manual_percent', 'manual_amount'] as const;
export type PolicyType = typeof POLICY_TYPES[number];

export interface PayoutPolicy {
  defaultPolicy: 'split_check_cash' | 'all_check' | 'all_cash';
  defaultCheckBp: number;               // 5000 = 50% by check
  primaryMethod: 'check' | 'cash';      // receives the odd cent
  cashEnabled: boolean;
  maxCashBp: number;                    // the most a statement may pay in cash
  allowedMethods: string[];
  manualSplitAllowed: boolean;
}
export const DEFAULT_POLICY: PayoutPolicy = { defaultPolicy: 'split_check_cash', defaultCheckBp: 5000, primaryMethod: 'check', cashEnabled: true, maxCashBp: 10000, allowedMethods: ['check', 'cash'], manualSplitAllowed: true };

export interface Instruction { method: InstructionMethod; amountCents: number; basisPoints: number | null }

/** Split `payable` by basis points per method, EXACTLY: floor each share, then the remainder cents go to the first
 *  (primary) entry — deterministic (§6 odd-cent rule: $2,000.01 → check $1,000.01 / cash $1,000.00). Zero shares drop out. */
export function splitByBasisPoints(payableCents: number, parts: Array<{ method: InstructionMethod; basisPoints: number }>): Instruction[] {
  const total = Math.round(payableCents);
  if (total <= 0) return [];
  const shares = parts.map((p) => ({ ...p, amountCents: Math.floor((total * p.basisPoints) / 10000) }));
  const rest = total - shares.reduce((a, s) => a + s.amountCents, 0);
  if (shares.length) shares[0].amountCents += rest;
  return shares.filter((s) => s.amountCents > 0).map((s) => ({ method: s.method, amountCents: s.amountCents, basisPoints: s.basisPoints }));
}

/** The salon's default plan for a payable (the 50 / 50 preset unless the salon chose otherwise). */
export function defaultInstructions(payableCents: number, policy: PayoutPolicy): { policyType: PolicyType; instructions: Instruction[] } {
  const cashOk = policy.cashEnabled && policy.allowedMethods.includes('cash');
  if (policy.defaultPolicy === 'all_cash' && cashOk && policy.maxCashBp >= 10000) return { policyType: 'all_cash', instructions: splitByBasisPoints(payableCents, [{ method: 'cash', basisPoints: 10000 }]) };
  if (policy.defaultPolicy === 'all_check' || !cashOk) return { policyType: 'all_check', instructions: splitByBasisPoints(payableCents, [{ method: 'check', basisPoints: 10000 }]) };
  const checkBp = Math.max(policy.defaultCheckBp, 10000 - policy.maxCashBp);   // never above the salon's cash cap
  const parts: Array<{ method: InstructionMethod; basisPoints: number }> = [{ method: 'check', basisPoints: checkBp }, { method: 'cash', basisPoints: 10000 - checkBp }];
  if (policy.primaryMethod === 'cash') parts.reverse();
  return { policyType: 'split_check_cash', instructions: fitCashCap(payableCents, splitByBasisPoints(payableCents, parts), policy.maxCashBp) };
}

/**
 * Oct 28 2026 (Weekly Paycheck mandate audit, §6.8 / §7.7): the ROUNDING cents of a split never push cash over the salon's
 * cash cap. With cash as the primary method the odd cent went to cash — at a 50 % cap, $1,000.01 → cash $500.01 →
 * CASH_OVER_LIMIT, so every odd-cent statement blocked submit and choosing "50 / 50" threw. Only rounding (fewer cents
 * than there are parts) moves, to the check part; a split that is over the cap on purpose is still refused by
 * validateInstructions.
 */
export function fitCashCap(payableCents: number, ins: Instruction[], maxCashBp: number): Instruction[] {
  const cashAt = ins.findIndex((i) => i.method === 'cash');
  if (cashAt < 0 || payableCents <= 0) return ins;
  const cash = ins[cashAt];
  const capCents = Math.floor((payableCents * maxCashBp) / 10000);
  const excess = cash.amountCents - capCents;
  if (excess <= 0) return ins;
  const checkAt = ins.findIndex((i) => i.method === 'check');
  if (checkAt >= 0) {
    if (excess >= ins.length) return ins;   // not a rounding difference: a split over the cap on purpose stays refused
    return ins.map((i, k) => (k === cashAt ? { ...i, amountCents: i.amountCents - excess } : k === checkAt ? { ...i, amountCents: i.amountCents + excess } : i)).filter((i) => i.amountCents > 0);
  }
  // the check part rounded to $0.00 and was dropped (a 1-cent payable): the cent is the check's, if the split meant one
  if (excess !== 1 || cash.basisPoints == null || cash.basisPoints >= 10000) return ins;
  return [...ins.map((i, k) => (k === cashAt ? { ...i, amountCents: i.amountCents - 1 } : i)).filter((i) => i.amountCents > 0), { method: 'check' as const, amountCents: 1, basisPoints: 10000 - cash.basisPoints }];
}

export type PlanIssue = 'UNDER_ALLOCATED' | 'OVER_ALLOCATED' | 'METHOD_NOT_ALLOWED' | 'CASH_DISABLED' | 'CASH_OVER_LIMIT' | 'MANUAL_SPLIT_NOT_ALLOWED' | 'INVALID_AMOUNT' | 'PERCENT_NOT_100' | 'DUPLICATE_METHOD';

/** Build a manual plan from what the manager typed (percent OR dollars), exactly. */
export function manualInstructions(payableCents: number, kind: 'manual_percent' | 'manual_amount', entries: Array<{ method: string; basisPoints?: number | null; amountCents?: number | null }>): { instructions: Instruction[]; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const methods = entries.map((e) => e.method);
  if (new Set(methods).size !== methods.length) issues.push('DUPLICATE_METHOD');
  if (methods.some((m) => !(INSTRUCTION_METHODS as readonly string[]).includes(m))) issues.push('METHOD_NOT_ALLOWED');
  if (kind === 'manual_percent') {
    if (entries.some((e) => !Number.isInteger(e.basisPoints) || (e.basisPoints as number) < 0 || (e.basisPoints as number) > 10000)) issues.push('INVALID_AMOUNT');
    if (entries.reduce((a, e) => a + (Number(e.basisPoints) || 0), 0) !== 10000) issues.push('PERCENT_NOT_100');
    if (issues.length) return { instructions: [], issues };
    return { instructions: splitByBasisPoints(payableCents, entries.map((e) => ({ method: e.method as InstructionMethod, basisPoints: Number(e.basisPoints) }))), issues };
  }
  if (entries.some((e) => !Number.isInteger(e.amountCents) || (e.amountCents as number) < 0)) issues.push('INVALID_AMOUNT');
  if (issues.length) return { instructions: [], issues };
  const instructions = entries.filter((e) => (e.amountCents as number) > 0).map((e) => ({ method: e.method as InstructionMethod, amountCents: e.amountCents as number, basisPoints: null }));
  return { instructions, issues };
}

/** §6 payout invariant + the salon's policy: SUM(instructions) = payable exactly; only enabled methods; the cash cap. */
export function validateInstructions(payableCents: number, ins: Instruction[], policy: PayoutPolicy, policyType: PolicyType): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const sum = ins.reduce((a, i) => a + i.amountCents, 0);
  if (ins.some((i) => !Number.isInteger(i.amountCents) || i.amountCents <= 0)) issues.push('INVALID_AMOUNT');
  if (sum < payableCents) issues.push('UNDER_ALLOCATED');
  if (sum > payableCents) issues.push('OVER_ALLOCATED');
  if (ins.some((i) => !policy.allowedMethods.includes(i.method))) issues.push('METHOD_NOT_ALLOWED');
  const cash = ins.filter((i) => i.method === 'cash').reduce((a, i) => a + i.amountCents, 0);
  if (cash > 0 && !policy.cashEnabled) issues.push('CASH_DISABLED');
  if (cash > 0 && payableCents > 0 && cash * 10000 > payableCents * policy.maxCashBp) issues.push('CASH_OVER_LIMIT');
  if ((policyType === 'manual_percent' || policyType === 'manual_amount') && !policy.manualSplitAllowed) issues.push('MANUAL_SPLIT_NOT_ALLOWED');
  return [...new Set(issues)];
}

export const PLAN_ISSUE_TEXT: Record<PlanIssue, string> = {
  UNDER_ALLOCATED: 'The payout split is less than the amount payable.',
  OVER_ALLOCATED: 'The payout split is more than the amount payable.',
  METHOD_NOT_ALLOWED: 'That payout method is not turned on for this salon.',
  CASH_DISABLED: 'This salon does not pay payroll in cash.',
  CASH_OVER_LIMIT: 'The cash part is above the salon\'s cash limit.',
  MANUAL_SPLIT_NOT_ALLOWED: 'This salon only allows its default payout split.',
  INVALID_AMOUNT: 'Every payout amount must be a positive amount in cents.',
  PERCENT_NOT_100: 'The percentages must add up to 100%.',
  DUPLICATE_METHOD: 'Each payout method can appear only once.',
};

// ── statements ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface LineFigures {
  commissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number; guaranteeTopUpCents: number;
  hourlyPayCents: number; salaryPayCents: number; bonusCents: number; adjustmentCents: number; deductionCents: number; netCents: number; payableCents: number;
}
export interface StatementFigures {
  serviceCommissionCents: number; hourlyPayCents: number; salaryPayCents: number; tipsCents: number; cardTipCents: number; cashTipCents: number;
  retailCommissionCents: number; bonusCents: number; guaranteeTopUpCents: number; positiveAdjustmentsCents: number; deductionsCents: number; reversalsCents: number;
  grossEarningsCents: number; linePayableCents: number; alreadyPaidCents: number; approvedPayableCents: number; reviewRequired: boolean;
}
/** §4 weekly payable: the line's components − what the technician already received (cash tips handed over each day, when
 *  the salon does that, and payouts recorded on the period before this statement). Earned ≠ still owed; a negative
 *  result is never paid — it is REVIEW_REQUIRED (§4). */
export function statementFigures(l: LineFigures, already: { cashTipsHandedOver: boolean; priorPaidCents: number }, ledger?: { favourCents: number }): StatementFigures {
  const r = (n: number) => Math.round(Number(n) || 0);
  const adj = r(l.adjustmentCents);
  // §4.2 (Kevin's decision, Oct 28 2026): bonuses and reversals are shown ITEMISED, not netted. The line carries only the net
  // adjustment (+$50 bonus and −$10 refund reversal = +$40); the period's ledger says how much of it was in the technician's
  // favour. positive − reversals always equals the net, so the payable never changes — only the breakdown is kept.
  const favour = Math.max(0, r(ledger?.favourCents ?? 0));
  const positive = Math.max(Math.max(0, adj), favour), reversals = positive - adj;
  const gross = r(l.commissionCents) + r(l.hourlyPayCents) + r(l.salaryPayCents) + r(l.tipsCents) + r(l.retailCommissionCents) + r(l.bonusCents) + r(l.guaranteeTopUpCents) + positive;
  const alreadyPaid = (already.cashTipsHandedOver ? Math.max(0, r(l.cashTipCents)) : 0) + Math.max(0, r(already.priorPaidCents));
  const raw = r(l.netCents) - alreadyPaid;
  return {
    serviceCommissionCents: r(l.commissionCents), hourlyPayCents: r(l.hourlyPayCents), salaryPayCents: r(l.salaryPayCents), tipsCents: r(l.tipsCents),
    cardTipCents: r(l.cardTipCents), cashTipCents: r(l.cashTipCents), retailCommissionCents: r(l.retailCommissionCents), bonusCents: r(l.bonusCents),
    guaranteeTopUpCents: r(l.guaranteeTopUpCents), positiveAdjustmentsCents: positive, deductionsCents: Math.max(0, r(l.deductionCents)), reversalsCents: reversals,
    grossEarningsCents: gross, linePayableCents: r(l.payableCents), alreadyPaidCents: alreadyPaid,
    approvedPayableCents: Math.max(0, raw), reviewRequired: raw < 0,
  };
}

/** PAY-2026-000128 */
export function statementNumber(year: number, n: number): string { return `PAY-${year}-${String(n).padStart(6, '0')}`; }

/** The statement status implied by its money (§13): PAID when paid = payable, PARTIALLY_PAID when some, ISSUED when a payout
 *  is in motion but nothing is paid yet, LOCKED otherwise. */
export function statementPaymentStatus(payableCents: number, paidCents: number, anyInMotion: boolean): 'locked' | 'issued' | 'partially_paid' | 'paid' {
  if (paidCents >= payableCents) return 'paid';
  if (paidCents > 0) return 'partially_paid';
  return anyInMotion ? 'issued' : 'locked';
}
export function periodPayoutStatus(statements: Array<{ status: string; approvedPayableCents: number; paidCents: number }>): 'none' | 'unpaid' | 'partially_paid' | 'paid' {
  const live = statements.filter((s) => ['locked', 'issued', 'partially_paid', 'paid'].includes(s.status));
  if (!live.length) return 'none';
  const payable = live.reduce((a, s) => a + s.approvedPayableCents, 0), paid = live.reduce((a, s) => a + s.paidCents, 0);
  const held = statements.some((s) => s.status === 'held');
  if (paid >= payable && !held) return 'paid';
  return paid > 0 ? 'partially_paid' : 'unpaid';
}

/** The payout's own status (payroll_payouts.status) for a check / cash lifecycle state — only a delivered / cleared check
 *  and an acknowledged cash payout (or handed off, when the salon counts that as paid) are PAID (§10–§11). */
export function payoutStatusForCheck(s: string): 'pending' | 'paid' | 'canceled' {
  if (s === 'delivered' || s === 'cleared') return 'paid';
  if (s === 'voided' || s === 'returned') return 'canceled';
  return 'pending';
}
export function payoutStatusForCash(s: string, paidOn: 'acknowledged' | 'handed_off'): 'pending' | 'processing' | 'paid' | 'canceled' {
  if (s === 'acknowledged') return 'paid';
  if (s === 'handed_off') return paidOn === 'handed_off' ? 'paid' : 'processing';
  if (s === 'disputed') return 'processing';
  if (s === 'canceled') return 'canceled';
  return 'pending';
}

// ── the weekly window (§3) ──────────────────────────────────────────────────────────────────────────────────────────
const addDaysYmd = (ymd: string, n: number) => addDays(ymd, n);
/** The last COMPLETED week before `todayYmd` (the salon's calendar day) for a week starting on `weekStartDay`
 *  (0 = Sunday, 1 = Monday), and its pay date. Example: Monday start, today Wed Oct 21 → Oct 12 – Oct 18, pay Oct 23. */
export function lastCompletedWeek(todayYmd: string, weekStartDay: number, payDayOffsetDays: number): { periodStart: string; periodEnd: string; payDate: string } {
  const dow = new Date(`${todayYmd}T12:00:00Z`).getUTCDay();
  const sinceStart = (dow - weekStartDay + 7) % 7;               // days since this week started
  const thisWeekStart = addDaysYmd(todayYmd, -sinceStart);
  const periodStart = addDaysYmd(thisWeekStart, -7);
  const periodEnd = addDaysYmd(thisWeekStart, -1);
  return { periodStart, periodEnd, payDate: addDaysYmd(periodEnd, payDayOffsetDays) };
}
export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export const PAY_FREQUENCIES: readonly PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const dayNumber = (ymd: string) => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
/** §3.3: the last COMPLETED pay period before `todayYmd` for any of the four frequencies (weekly stays lastCompletedWeek):
 *   • biweekly    — fixed 14-day blocks that start on `weekStartDay`, anchored on the first such day of 2024 (deterministic:
 *                   every salon with the same start day shares block edges, so a restart or a second replica opens the same one);
 *   • semimonthly — the 1st–15th and the 16th–last day of each calendar month;
 *   • monthly     — the previous calendar month.
 *  The pay date is `payDayOffsetDays` after the period ends, as for weeks. */
export function lastCompletedPeriod(frequency: string, todayYmd: string, weekStartDay: number, payDayOffsetDays: number): { periodStart: string; periodEnd: string; payDate: string; frequency: PayFrequency } {
  if (frequency === 'weekly') return { ...lastCompletedWeek(todayYmd, weekStartDay, payDayOffsetDays), frequency: 'weekly' };
  const [y, m, d] = todayYmd.split('-').map(Number);
  const ymd = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  let periodStart: string, periodEnd: string;
  if (frequency === 'biweekly') {
    // 2024-01-01 is a Monday (dow 1): the anchor is the first day of 2024 whose weekday is weekStartDay
    const anchor = addDaysYmd('2024-01-01', (weekStartDay - 1 + 7) % 7);
    const blocksSince = Math.floor((dayNumber(todayYmd) - dayNumber(anchor)) / 14);
    const thisBlockStart = addDaysYmd(anchor, blocksSince * 14);
    periodStart = addDaysYmd(thisBlockStart, -14); periodEnd = addDaysYmd(thisBlockStart, -1);
  } else if (frequency === 'semimonthly') {
    if (d >= 16) { periodStart = ymd(y, m, 1); periodEnd = ymd(y, m, 15); }
    else { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; periodStart = ymd(py, pm, 16); periodEnd = ymd(py, pm, lastDayOfMonth(py, pm)); }
  } else if (frequency === 'monthly') {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    periodStart = ymd(py, pm, 1); periodEnd = ymd(py, pm, lastDayOfMonth(py, pm));
  } else throw new Error(`unknown pay frequency ${frequency}`);
  return { periodStart, periodEnd, payDate: addDaysYmd(periodEnd, payDayOffsetDays), frequency: frequency as PayFrequency };
}
/** The period's label as the manager sees it: "Week of …" for weekly, the period kind otherwise. */
export function periodLabel(frequency: string, periodStart: string, periodEnd: string): string {
  const kind = frequency === 'weekly' ? 'Week' : frequency === 'biweekly' ? 'Two weeks' : frequency === 'semimonthly' ? 'Half month' : 'Month';
  return `${kind} of ${periodStart} – ${periodEnd}`;
}

// ── itemised reversals (§4.2) ───────────────────────────────────────────────────────────────────────────────────────
/** The adjustment-ledger categories that are REVERSALS of earlier earnings, by the statement column that itemises them.
 *  The totals are unchanged (reversals_cents stays the negative net adjustment); these only say WHICH kind each cent was. */
export const REVERSAL_CATEGORY_COLUMN: Record<string, 'refundReversalCents' | 'tipAdjustmentCents' | 'retailReversalCents'> = {
  refund_reversal: 'refundReversalCents', void_reversal: 'refundReversalCents', chargeback_reversal: 'refundReversalCents',
  tip_correction: 'tipAdjustmentCents', retail_reversal: 'retailReversalCents',
};
export interface ReversalItems { refundReversalCents: number; tipAdjustmentCents: number; retailReversalCents: number }
/** PURE: the part of a technician's ledger entries in their favour (bonuses, corrections up) — the "positive adjustments"
 *  line of an itemised statement (§4.2). */
export function ledgerFavourCents(entries: ReadonlyArray<{ category: string; amountCents: number }>): number {
  let s = 0; for (const e of entries) { const a = Math.round(Number(e.amountCents) || 0); if (a > 0) s += a; } return s;
}
/** PURE: the negative ledger entries of a technician, itemised by reversal kind (each as a POSITIVE amount). A positive
 *  entry (a correction in the technician's favour) is never a reversal; an unknown negative category is left to the
 *  statement's reversals_cents remainder. */
export function itemiseReversals(entries: ReadonlyArray<{ category: string; amountCents: number }>): ReversalItems {
  const out: ReversalItems = { refundReversalCents: 0, tipAdjustmentCents: 0, retailReversalCents: 0 };
  for (const e of entries) {
    const a = Math.round(Number(e.amountCents) || 0);
    if (a >= 0) continue;
    const col = REVERSAL_CATEGORY_COLUMN[e.category];
    if (col) out[col] += -a;
  }
  return out;
}

// ── cash handoff confirmations (§11.5) ──────────────────────────────────────────────────────────────────────────────
/** How a technician's receipt of cash can be proven. `technician_app` = the Tech App (a plain tap, or a scanned QR handoff
 *  token); `technician_pin` = the technician's 4-digit PIN on the manager's device; `qr_handoff` = the Tech App presented
 *  the token the manager's screen showed (the technician was physically there); `signature` = the technician signed on
 *  the manager's device (PIN + signature strokes kept); `manager_dual` = the manager's own fresh step-up AND the
 *  technician's PIN on the same device. */
export const CASH_ACK_METHODS = ['technician_app', 'technician_pin', 'qr_handoff', 'signature', 'manager_dual'] as const;
export type CashAckMethod = typeof CASH_ACK_METHODS[number];
/** a handoff token lives this long on the manager's screen */
export const CASH_HANDOFF_TOKEN_TTL_MS = 10 * 60 * 1000;
/** a signature is a short list of strokes (SVG path data: digits, M/L, spaces, commas, dots, minus) — never a bitmap */
export const SIGNATURE_MAX_CHARS = 16_000;
export function validSignaturePath(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length >= 8 && s.length <= SIGNATURE_MAX_CHARS && /^[MLml0-9 ,.-]+$/.test(s.trim()) && /^[Mm]/.test(s.trim());
}

// ── §66 / §67 (200-technician mandate; M5 pilot, Oct 24 2026): the owner's review of a 200-statement week ──────────────
// Search a technician, filter a branch, SHOW EXCEPTIONS ONLY — so nobody opens 200 cards to find the eight that need a
// look. A statement's exceptions come from its own figures and from the week's last validation (the stored result: a
// read never re-validates or writes). Codes the owner sees:
export type StatementExceptionCode = 'NEGATIVE_PAYABLE' | 'PAYOUT_SPLIT_MISMATCH' | 'MANUAL_ADJUSTMENT' | 'MISSING_CLOCK_OUT' | 'PENDING_ADJUSTMENT'
  | 'DEDUCTION_EXCEEDS_EARNINGS' | 'DEDUCTION_OVER_CAP' | 'CHANGED_SINCE_BUILD' | 'UNALLOCATED_TIP' | 'MISSING_COMMISSION_RULE';
export interface StatementException { code: StatementExceptionCode; message: string }
export const STATEMENT_EXCEPTION_TEXT: Record<StatementExceptionCode, string> = {
  NEGATIVE_PAYABLE: 'Owes more than earned this week — review the deductions.',
  PAYOUT_SPLIT_MISMATCH: 'The payout split does not equal the amount payable.',
  MANUAL_ADJUSTMENT: 'Includes a manual bonus, adjustment or deduction.',
  MISSING_CLOCK_OUT: 'Still clocked in for this week (no clock-out).',
  PENDING_ADJUSTMENT: 'An adjustment is waiting for a decision (not in these figures).',
  DEDUCTION_EXCEEDS_EARNINGS: 'A deduction is larger than the non-tip earnings.',
  DEDUCTION_OVER_CAP: 'A deduction is over its per-period limit.',
  CHANGED_SINCE_BUILD: 'Sales or adjustments changed after this statement was built — recalculate.',
  UNALLOCATED_TIP: 'A ticket this technician served has a tip that is not fully allocated between technicians.',
  MISSING_COMMISSION_RULE: 'Some services matched no commission rule — the salon default rate priced them.',
};
/** validation issue code (payroll-workflow evaluateValidation) → the statement exception it raises for its technicians */
const ISSUE_TO_EXCEPTION: Record<string, StatementExceptionCode> = {
  OPEN_TIME_ENTRY: 'MISSING_CLOCK_OUT', OPEN_TIME_ENTRY_INFO: 'MISSING_CLOCK_OUT', PENDING_ADJUSTMENTS: 'PENDING_ADJUSTMENT',
  NEGATIVE_NET_PAY: 'NEGATIVE_PAYABLE', DEDUCTION_EXCEEDS_EARNINGS: 'DEDUCTION_EXCEEDS_EARNINGS', DEDUCTION_OVER_CAP: 'DEDUCTION_OVER_CAP',
  PAYROLL_CHANGED_SINCE_BUILD: 'CHANGED_SINCE_BUILD', UNALLOCATED_TIP: 'UNALLOCATED_TIP', MISSING_COMMISSION_RULE: 'MISSING_COMMISSION_RULE',
};
export interface ExceptionFacts {
  technicianId: string; reviewRequired: boolean; planIssues: number;
  bonusCents: number; positiveAdjustmentsCents: number; deductionsCents: number;
}
/** PURE: one statement's exceptions, in a stable order, each code once. */
export function statementExceptions(s: ExceptionFacts, validationIssues: ReadonlyArray<{ code: string; technicianIds?: string[] }>): StatementException[] {
  const codes = new Set<StatementExceptionCode>();
  if (s.reviewRequired) codes.add('NEGATIVE_PAYABLE');
  if (s.planIssues > 0) codes.add('PAYOUT_SPLIT_MISMATCH');
  if ((s.bonusCents || 0) !== 0 || (s.positiveAdjustmentsCents || 0) !== 0 || (s.deductionsCents || 0) !== 0) codes.add('MANUAL_ADJUSTMENT');
  for (const i of validationIssues) {
    const code = ISSUE_TO_EXCEPTION[i.code];
    if (code && (i.technicianIds ?? []).includes(s.technicianId)) codes.add(code);
  }
  const order = Object.keys(STATEMENT_EXCEPTION_TEXT) as StatementExceptionCode[];
  return order.filter((c) => codes.has(c)).map((code) => ({ code, message: STATEMENT_EXCEPTION_TEXT[code] }));
}
export interface WeekReviewFilter { exceptionsOnly?: boolean; search?: string | null; branchId?: string | null }
/** PURE: does a statement pass the owner's filter? `homeBranchId` = the technician's primary branch. */
export function matchesWeekFilter(s: { technicianName: string | null; statementNumber: string; branchBreakdown: Array<{ branchId: string | null }>; exceptions: StatementException[] },
  homeBranchId: string | null, f: WeekReviewFilter): boolean {
  if (f.exceptionsOnly && s.exceptions.length === 0) return false;
  const term = String(f.search ?? '').trim().toLowerCase();
  if (term && !(String(s.technicianName ?? '').toLowerCase().includes(term) || s.statementNumber.toLowerCase().includes(term))) return false;
  if (f.branchId && homeBranchId !== f.branchId && !s.branchBreakdown.some((b) => b.branchId === f.branchId)) return false;
  return true;
}
/** The query string of the week view → the filter (`exceptionsOnly=1|true`, `search`, `branchId`; canonical filter[x] too). */
export function weekFilterFromQuery(q: Record<string, unknown> | null | undefined): WeekReviewFilter {
  const f = (q?.filter && typeof q.filter === 'object' ? q.filter : {}) as Record<string, unknown>;
  const pick = (k: string) => (q?.[k] ?? f[k]);
  const yes = (v: unknown) => v === true || v === 'true' || v === '1';
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return { exceptionsOnly: yes(pick('exceptionsOnly')), search: text(pick('search') ?? q?.q, 80), branchId: text(pick('branchId'), 64) };
}
