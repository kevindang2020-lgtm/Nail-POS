// payroll-paycheck.vitest.spec.ts — Weekly Paycheck mandate (Oct 21 2026) §20 financial cases on the PURE pieces: the
// 50 / 50 default with the deterministic odd cent, manual percent / dollar splits, the salon's policy (methods, cash cap,
// manual splits), already-paid cash tips, negative payable, statement numbers, paid / partially-paid status, the check
// and cash payout statuses, and the weekly window. No database, no clock.
import { describe, it, expect } from 'vitest';
import { assertTransition } from '@aipowersalon/database';
import {
  splitByBasisPoints, defaultInstructions, fitCashCap, manualInstructions, validateInstructions, statementFigures, statementNumber, statementPaymentStatus, periodPayoutStatus,
  payoutStatusForCheck, payoutStatusForCash, lastCompletedWeek, lastCompletedPeriod, periodLabel, itemiseReversals, validSignaturePath, DEFAULT_POLICY, PAY_STATEMENT, CHECK_PAYOUT, CASH_PAYOUT, type PayoutPolicy,
} from './payroll-paycheck';
import { PAYROLL_PERIOD, dashboardStatusOf, isPeriodLocked } from './payroll.dto';

const sum = (xs: Array<{ amountCents: number }>) => xs.reduce((a, x) => a + x.amountCents, 0);
const line = (over: Record<string, number> = {}) => ({ commissionCents: 60000, retailCommissionCents: 0, cardTipCents: 8000, cashTipCents: 4000, tipsCents: 12000, guaranteeTopUpCents: 0,
  hourlyPayCents: 0, salaryPayCents: 0, bonusCents: 0, adjustmentCents: 0, deductionCents: 0, netCents: 72000, payableCents: 72000, ...over });

describe('§6 the 50 / 50 default split', () => {
  it('splits an even payable exactly in half', () => {
    expect(defaultInstructions(150000, DEFAULT_POLICY).instructions).toEqual([{ method: 'check', amountCents: 75000, basisPoints: 5000 }, { method: 'cash', amountCents: 75000, basisPoints: 5000 }]);
  });
  it('gives the odd cent to the primary method (check by default, cash when the salon chose cash)', () => {
    const a = defaultInstructions(100001, DEFAULT_POLICY).instructions;
    expect(a).toEqual([{ method: 'check', amountCents: 50001, basisPoints: 5000 }, { method: 'cash', amountCents: 50000, basisPoints: 5000 }]);
    const b = defaultInstructions(100001, { ...DEFAULT_POLICY, primaryMethod: 'cash' }).instructions;
    expect(b[0]).toEqual({ method: 'cash', amountCents: 50001, basisPoints: 5000 });
    expect(sum(b)).toBe(100001);
  });
  it('Oct 28 audit (§6.8 / §7.7): with cash primary and a cash cap, the odd cent never pushes cash over the cap', () => {
    const capped = { ...DEFAULT_POLICY, primaryMethod: 'cash' as const, maxCashBp: 5000 };
    for (const p of [100001, 2001, 3, 1, 99999, 12345]) {
      const ins = defaultInstructions(p, capped).instructions;
      expect(sum(ins), String(p)).toBe(p);
      expect(validateInstructions(p, ins, capped, 'split_check_cash'), String(p)).toEqual([]);
    }
    expect(defaultInstructions(100001, capped).instructions).toEqual([{ method: 'cash', amountCents: 50000, basisPoints: 5000 }, { method: 'check', amountCents: 50001, basisPoints: 5000 }]);
    // a manual 50 / 50 by percent: rounding moves to the check, never over the cap
    const m = fitCashCap(2001, manualInstructions(2001, 'manual_percent', [{ method: 'cash', basisPoints: 5000 }, { method: 'check', basisPoints: 5000 }]).instructions, 5000);
    expect(validateInstructions(2001, m, capped, 'manual_percent')).toEqual([]);
    // a split OVER the cap on purpose is not "fixed" — it is still refused
    const over = manualInstructions(10000, 'manual_percent', [{ method: 'cash', basisPoints: 7000 }, { method: 'check', basisPoints: 3000 }]).instructions;
    expect(fitCashCap(10000, over, 5000)).toEqual(over);
    expect(validateInstructions(10000, over, capped, 'manual_percent')).toContain('CASH_OVER_LIMIT');
  });
  it('always sums to the payable, for every amount (no cent lost or invented)', () => {
    for (const p of [1, 2, 3, 99, 101, 12345, 999999, 1000001]) for (const bp of [0, 1, 3333, 5000, 6667, 9999, 10000]) {
      const ins = splitByBasisPoints(p, [{ method: 'check', basisPoints: bp }, { method: 'cash', basisPoints: 10000 - bp }]);
      expect(sum(ins)).toBe(p);
      expect(ins.every((i) => i.amountCents > 0 && Number.isInteger(i.amountCents))).toBe(true);
    }
  });
  it('§20: $100.00 → $50.00 / $50.00; $100.01 → $50.01 / $50.00; 25/75, 10/90, 100/0, 0/100', () => {
    const two = (p: number, checkBp: number) => splitByBasisPoints(p, [{ method: 'check', basisPoints: checkBp }, { method: 'cash', basisPoints: 10000 - checkBp }]).map((i) => [i.method, i.amountCents]);
    expect(two(10000, 5000)).toEqual([['check', 5000], ['cash', 5000]]);
    expect(two(10001, 5000)).toEqual([['check', 5001], ['cash', 5000]]);
    expect(two(10000, 2500)).toEqual([['check', 2500], ['cash', 7500]]);
    expect(two(10000, 1000)).toEqual([['check', 1000], ['cash', 9000]]);
    expect(two(10000, 10000)).toEqual([['check', 10000]]);            // 100 / 0: one payout, no $0 cash envelope
    expect(two(10000, 0)).toEqual([['cash', 10000]]);                 // 0 / 100
    expect(two(1, 5000)).toEqual([['check', 1]]);                     // $0.01 → $0.01 check / $0.00 cash (no zero payout)
  });
  it('a zero payable has no payouts; a one-cent payable is one payout', () => {
    expect(defaultInstructions(0, DEFAULT_POLICY).instructions).toEqual([]);
    expect(defaultInstructions(1, DEFAULT_POLICY).instructions).toEqual([{ method: 'check', amountCents: 1, basisPoints: 5000 }]);
  });
  it('respects the salon: cash off → all check; a cash cap lowers the cash half; all-cash preset', () => {
    expect(defaultInstructions(1000, { ...DEFAULT_POLICY, cashEnabled: false }).instructions).toEqual([{ method: 'check', amountCents: 1000, basisPoints: 10000 }]);
    const capped = defaultInstructions(1000, { ...DEFAULT_POLICY, maxCashBp: 3000 }).instructions;
    expect(capped.find((i) => i.method === 'cash')!.amountCents).toBe(300);
    expect(defaultInstructions(1000, { ...DEFAULT_POLICY, defaultPolicy: 'all_cash' }).instructions).toEqual([{ method: 'cash', amountCents: 1000, basisPoints: 10000 }]);
  });
});

describe('§7 manual splits + policy validation', () => {
  const policy: PayoutPolicy = { ...DEFAULT_POLICY };
  it('a 70 / 30 percent split is exact', () => {
    const m = manualInstructions(100001, 'manual_percent', [{ method: 'check', basisPoints: 7000 }, { method: 'cash', basisPoints: 3000 }]);
    expect(m.issues).toEqual([]);
    expect(m.instructions).toEqual([{ method: 'check', amountCents: 70001, basisPoints: 7000 }, { method: 'cash', amountCents: 30000, basisPoints: 3000 }]);
    expect(validateInstructions(100001, m.instructions, policy, 'manual_percent')).toEqual([]);
  });
  it('percentages must add to 100 and methods appear once', () => {
    expect(manualInstructions(1000, 'manual_percent', [{ method: 'check', basisPoints: 6000 }, { method: 'cash', basisPoints: 3000 }]).issues).toContain('PERCENT_NOT_100');
    expect(manualInstructions(1000, 'manual_percent', [{ method: 'check', basisPoints: 5000 }, { method: 'check', basisPoints: 5000 }]).issues).toContain('DUPLICATE_METHOD');
  });
  it('dollar splits must equal the payable exactly — under / over are refused', () => {
    const under = manualInstructions(1500_00, 'manual_amount', [{ method: 'check', amountCents: 1000_00 }, { method: 'cash', amountCents: 499_99 }]);
    expect(validateInstructions(1500_00, under.instructions, policy, 'manual_amount')).toEqual(['UNDER_ALLOCATED']);
    const over = manualInstructions(1500_00, 'manual_amount', [{ method: 'check', amountCents: 1000_00 }, { method: 'cash', amountCents: 500_01 }]);
    expect(validateInstructions(1500_00, over.instructions, policy, 'manual_amount')).toEqual(['OVER_ALLOCATED']);
    const ok = manualInstructions(1500_00, 'manual_amount', [{ method: 'check', amountCents: 1000_00 }, { method: 'cash', amountCents: 500_00 }]);
    expect(validateInstructions(1500_00, ok.instructions, policy, 'manual_amount')).toEqual([]);
  });
  it('fractional or negative cents are refused', () => {
    expect(manualInstructions(1000, 'manual_amount', [{ method: 'check', amountCents: 999.5 }]).issues).toContain('INVALID_AMOUNT');
    expect(manualInstructions(1000, 'manual_amount', [{ method: 'check', amountCents: -1 }]).issues).toContain('INVALID_AMOUNT');
  });
  it('the salon policy: a method that is off, cash disabled, the cash cap, manual splits not allowed', () => {
    const allCash = [{ method: 'cash' as const, amountCents: 1000, basisPoints: null }];
    expect(validateInstructions(1000, [{ method: 'ach', amountCents: 1000, basisPoints: null }], policy, 'manual_amount')).toContain('METHOD_NOT_ALLOWED');
    expect(validateInstructions(1000, allCash, { ...policy, cashEnabled: false }, 'all_cash')).toContain('CASH_DISABLED');
    expect(validateInstructions(1000, allCash, { ...policy, maxCashBp: 5000 }, 'all_cash')).toContain('CASH_OVER_LIMIT');
    expect(validateInstructions(1000, allCash, { ...policy, manualSplitAllowed: false }, 'manual_amount')).toContain('MANUAL_SPLIT_NOT_ALLOWED');
    expect(validateInstructions(1000, allCash, { ...policy, manualSplitAllowed: false }, 'all_cash')).toEqual([]);   // a preset is not a manual split
  });
});

describe('§4 statement figures', () => {
  it('earned is not owed: already-paid cash tips come off only when the salon hands them over daily', () => {
    const daily = statementFigures(line(), { cashTipsHandedOver: true, priorPaidCents: 0 });
    expect(daily.alreadyPaidCents).toBe(4000);
    expect(daily.approvedPayableCents).toBe(68000);
    const weekly = statementFigures(line(), { cashTipsHandedOver: false, priorPaidCents: 0 });
    expect(weekly.alreadyPaidCents).toBe(0);
    expect(weekly.approvedPayableCents).toBe(72000);
    expect(daily.grossEarningsCents).toBe(72000);   // the earnings are the same; only what is still owed differs
  });
  it('an advance already paid on the week reduces the payable', () => {
    expect(statementFigures(line(), { cashTipsHandedOver: false, priorPaidCents: 20000 }).approvedPayableCents).toBe(52000);
  });
  it('a negative result is never paid — review required', () => {
    const f = statementFigures(line({ netCents: 3000, payableCents: 3000 }), { cashTipsHandedOver: true, priorPaidCents: 0 });
    expect(f.approvedPayableCents).toBe(0);
    expect(f.reviewRequired).toBe(true);
  });
  it('splits adjustments into positive adjustments and reversals', () => {
    expect(statementFigures(line({ adjustmentCents: -2500 }), { cashTipsHandedOver: false, priorPaidCents: 0 })).toMatchObject({ positiveAdjustmentsCents: 0, reversalsCents: 2500 });
    expect(statementFigures(line({ adjustmentCents: 1500 }), { cashTipsHandedOver: false, priorPaidCents: 0 })).toMatchObject({ positiveAdjustmentsCents: 1500, reversalsCents: 0 });
  });
  it('§4.2 (Oct 28 decision): a +$50 bonus and a −$10 reversal are shown ITEMISED (+$50 / −$10), not netted to +$40 — the payable is unchanged', () => {
    const netted = statementFigures(line({ adjustmentCents: 4000 }), { cashTipsHandedOver: false, priorPaidCents: 0 });
    const itemised = statementFigures(line({ adjustmentCents: 4000 }), { cashTipsHandedOver: false, priorPaidCents: 0 }, { favourCents: 5000 });
    expect(netted).toMatchObject({ positiveAdjustmentsCents: 4000, reversalsCents: 0 });
    expect(itemised).toMatchObject({ positiveAdjustmentsCents: 5000, reversalsCents: 1000 });
    expect(itemised.positiveAdjustmentsCents - itemised.reversalsCents).toBe(4000);
    expect(itemised.approvedPayableCents).toBe(netted.approvedPayableCents);
    expect(itemised.grossEarningsCents).toBe(netted.grossEarningsCents + 1000);   // the bonus counts in full in the earnings
    // a net reversal with a bonus inside it: −$25 net, $15 in favour → +$15 / −$40
    expect(statementFigures(line({ adjustmentCents: -2500 }), { cashTipsHandedOver: false, priorPaidCents: 0 }, { favourCents: 1500 })).toMatchObject({ positiveAdjustmentsCents: 1500, reversalsCents: 4000 });
    // a ledger smaller than the line's own adjustment never shrinks it
    expect(statementFigures(line({ adjustmentCents: 3000 }), { cashTipsHandedOver: false, priorPaidCents: 0 }, { favourCents: 1000 })).toMatchObject({ positiveAdjustmentsCents: 3000, reversalsCents: 0 });
  });
  it('statement numbers are PAY-YYYY-NNNNNN', () => {
    expect(statementNumber(2026, 128)).toBe('PAY-2026-000128');
    expect(statementNumber(2027, 1)).toBe('PAY-2027-000001');
  });
});

describe('§13 paid / unpaid', () => {
  it('paid + unpaid = payable; partially paid when some is paid', () => {
    expect(statementPaymentStatus(150000, 0, false)).toBe('locked');
    expect(statementPaymentStatus(150000, 0, true)).toBe('issued');
    expect(statementPaymentStatus(150000, 75000, false)).toBe('partially_paid');   // the check is delivered, cash still waiting
    expect(statementPaymentStatus(150000, 150000, false)).toBe('paid');
  });
  it('the week is paid only when every approved statement is paid and nothing is held', () => {
    const s = (status: string, p: number, paid: number) => ({ status, approvedPayableCents: p, paidCents: paid });
    expect(periodPayoutStatus([])).toBe('none');
    expect(periodPayoutStatus([s('locked', 100, 0), s('locked', 200, 0)])).toBe('unpaid');
    expect(periodPayoutStatus([s('paid', 100, 100), s('partially_paid', 200, 50)])).toBe('partially_paid');
    expect(periodPayoutStatus([s('paid', 100, 100), s('paid', 200, 200)])).toBe('paid');
    expect(periodPayoutStatus([s('paid', 100, 100), s('held', 200, 0)])).toBe('partially_paid');
  });
});

describe('§10–§11 check and cash payouts', () => {
  it('a printed check is not paid; delivered / cleared is; voided / returned is not', () => {
    expect(payoutStatusForCheck('issued')).toBe('pending');
    expect(payoutStatusForCheck('delivered')).toBe('paid');
    expect(payoutStatusForCheck('cleared')).toBe('paid');
    expect(payoutStatusForCheck('voided')).toBe('canceled');
    expect(payoutStatusForCheck('returned')).toBe('canceled');
    expect(() => assertTransition(CHECK_PAYOUT, 'voided', 'delivered')).toThrow();   // a voided check never comes back
  });
  it('prepared cash is not paid; it is paid when the technician confirms (or at handoff, if the salon says so)', () => {
    expect(payoutStatusForCash('ready_for_handoff', 'acknowledged')).toBe('pending');
    expect(payoutStatusForCash('handed_off', 'acknowledged')).toBe('processing');
    expect(payoutStatusForCash('handed_off', 'handed_off')).toBe('paid');
    expect(payoutStatusForCash('acknowledged', 'acknowledged')).toBe('paid');
    expect(payoutStatusForCash('disputed', 'acknowledged')).toBe('processing');
    expect(payoutStatusForCash('canceled', 'acknowledged')).toBe('canceled');
    expect(() => assertTransition(CASH_PAYOUT, 'acknowledged', 'canceled')).toThrow();   // confirmed cash cannot be canceled
    expect(() => assertTransition(CASH_PAYOUT, 'planned', 'acknowledged')).toThrow();    // nothing prepared, nothing to confirm
  });
  it('an approved statement is immutable: it only moves through payment states', () => {
    expect(() => assertTransition(PAY_STATEMENT, 'locked', 'draft')).toThrow();
    expect(() => assertTransition(PAY_STATEMENT, 'paid', 'draft')).toThrow();
    expect(() => assertTransition(PAY_STATEMENT, 'draft', 'approved')).toThrow();   // the owner approves what was submitted
  });
});

describe('§3 the weekly window', () => {
  it('Monday weeks: on Wed Oct 21 2026 the last completed week is Oct 12 – Oct 18, paid Oct 23', () => {
    expect(lastCompletedWeek('2026-10-21', 1, 5)).toEqual({ periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23' });
  });
  it('on the first day of a week, the week that just ended', () => {
    expect(lastCompletedWeek('2026-10-19', 1, 5)).toEqual({ periodStart: '2026-10-12', periodEnd: '2026-10-18', payDate: '2026-10-23' });
  });
  it('Sunday weeks and a year boundary', () => {
    expect(lastCompletedWeek('2026-10-21', 0, 3)).toEqual({ periodStart: '2026-10-11', periodEnd: '2026-10-17', payDate: '2026-10-20' });
    expect(lastCompletedWeek('2027-01-02', 1, 5)).toEqual({ periodStart: '2026-12-21', periodEnd: '2026-12-27', payDate: '2027-01-01' });
  });
});

// ── close-out (Oct 27 2026): the INTERNAL items of docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md ──────────────────────
describe('§3.3 non-weekly frequencies: the last completed period', () => {
  it('weekly is exactly lastCompletedWeek', () => {
    expect(lastCompletedPeriod('weekly', '2026-10-21', 1, 5)).toEqual({ ...lastCompletedWeek('2026-10-21', 1, 5), frequency: 'weekly' });
  });
  it('biweekly: fixed 14-day blocks starting on the week start day (anchored Jan 2024), deterministic across days of the block', () => {
    // Monday blocks: 2026-10-05 – 10-18 is one block (2024-01-01 + 14·k); on any day of the next block the last completed one is that
    for (const today of ['2026-10-19', '2026-10-24', '2026-11-01']) expect(lastCompletedPeriod('biweekly', today, 1, 3)).toEqual({ periodStart: '2026-10-05', periodEnd: '2026-10-18', payDate: '2026-10-21', frequency: 'biweekly' });
    expect(lastCompletedPeriod('biweekly', '2026-10-18', 1, 3).periodEnd).toBe('2026-10-04');   // the block is not over yet
    const sun = lastCompletedPeriod('biweekly', '2026-10-21', 0, 0);
    expect(new Date(`${sun.periodStart}T12:00:00Z`).getUTCDay()).toBe(0);   // Sunday-start salons start their blocks on a Sunday
    expect(sun.periodEnd).toBe('2026-10-10');   // Sunday blocks: Sep 27 – Oct 10, Oct 11 – Oct 24 (today Oct 21 is inside the latter)
  });
  it('semimonthly: 1st–15th and 16th–last day; monthly: the previous calendar month (Feb and the year boundary too)', () => {
    expect(lastCompletedPeriod('semimonthly', '2026-10-21', 1, 2)).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-10-15', payDate: '2026-10-17', frequency: 'semimonthly' });
    expect(lastCompletedPeriod('semimonthly', '2026-10-03', 1, 2)).toEqual({ periodStart: '2026-09-16', periodEnd: '2026-09-30', payDate: '2026-10-02', frequency: 'semimonthly' });
    expect(lastCompletedPeriod('semimonthly', '2026-03-01', 1, 0).periodEnd).toBe('2026-02-28');
    expect(lastCompletedPeriod('monthly', '2026-10-21', 1, 5)).toEqual({ periodStart: '2026-09-01', periodEnd: '2026-09-30', payDate: '2026-10-05', frequency: 'monthly' });
    expect(lastCompletedPeriod('monthly', '2027-01-09', 1, 5)).toEqual({ periodStart: '2026-12-01', periodEnd: '2026-12-31', payDate: '2027-01-05', frequency: 'monthly' });
    expect(() => lastCompletedPeriod('daily', '2026-10-21', 1, 5)).toThrow();
    expect(periodLabel('weekly', '2026-10-12', '2026-10-18')).toBe('Week of 2026-10-12 – 2026-10-18');
    expect(periodLabel('monthly', '2026-09-01', '2026-09-30')).toBe('Month of 2026-09-01 – 2026-09-30');
  });
});

describe('§4.2 itemised reversals', () => {
  it('splits the negative ledger entries by kind, as positive amounts; positive entries are never reversals', () => {
    expect(itemiseReversals([{ category: 'refund_reversal', amountCents: -1200 }, { category: 'void_reversal', amountCents: -300 }, { category: 'chargeback_reversal', amountCents: -500 },
      { category: 'tip_correction', amountCents: -250 }, { category: 'tip_correction', amountCents: 400 }, { category: 'retail_reversal', amountCents: -75 }, { category: 'bonus', amountCents: 5000 }, { category: 'payroll_correction', amountCents: -10 }]))
      .toEqual({ refundReversalCents: 2000, tipAdjustmentCents: 250, retailReversalCents: 75 });
    expect(itemiseReversals([])).toEqual({ refundReversalCents: 0, tipAdjustmentCents: 0, retailReversalCents: 0 });
  });
});

describe('§3.4 the CANCELED pay period', () => {
  it('only a draft period can be canceled; canceled is terminal and counts as locked', () => {
    expect(PAYROLL_PERIOD.can('draft', 'canceled')).toBe(true);
    for (const from of ['review', 'finalized', 'paid']) expect(PAYROLL_PERIOD.can(from, 'canceled')).toBe(false);
    for (const to of ['draft', 'review', 'finalized', 'paid']) expect(PAYROLL_PERIOD.can('canceled', to)).toBe(false);
    expect(isPeriodLocked('canceled')).toBe(true);
    expect(dashboardStatusOf({ status: 'canceled', blockingCount: 3 })).toBe('CANCELED');
  });
});

describe('§11.5 signature strokes', () => {
  it('accepts short SVG path data and refuses bitmaps, scripts and empty scribbles', () => {
    expect(validSignaturePath('M 10 20 L 30 40 L 50 45')).toBe(true);
    expect(validSignaturePath('M10,20L30,40')).toBe(true);
    expect(validSignaturePath('M 1 1')).toBe(false);               // too short to be a signature
    expect(validSignaturePath('data:image/png;base64,iVBOR')).toBe(false);
    expect(validSignaturePath('<svg onload=alert(1)>')).toBe(false);
    expect(validSignaturePath('M ' + '1 2 L '.repeat(4000))).toBe(false);   // over the cap
    expect(validSignaturePath(null)).toBe(false);
  });
});
