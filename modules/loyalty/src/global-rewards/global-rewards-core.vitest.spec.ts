// global-rewards-core.vitest — the deterministic matrices of LoyaltyTokens.pdf §2.3 / §13.1 and LoyaltyRules.pdf §1.4,
// §4.6, §8.1, on the ONE pure calculator every surface uses.
import { describe, it, expect } from 'vitest';
import {
  computeEarn, validateCustomRate, previewRows, policyVersionAt, policyDisplay, versionDisplayState, globalVersionAt, eligibleCentsOf,
  redeemableBlocks, alertLevel, tenthsLabel, tokensLabel, rateLabel, purchaseQuantity, isSpendable, centsPerPointTenth, GlobalRewardsError,
  type ProgramPolicy, type EarningRate, type PolicyVersion, refundedEligibleCentsOf, walletFundingForecast,
} from './global-rewards-core';

const program: ProgramPolicy = {
  earnPaused: false, redeemPaused: false, purchasesPaused: false, reimbursementsPaused: false,
  pointsPerRedeemBlock: 10, redeemBlockValueCents: 100, tokenValueCents: 100,
  customMinSpendIncrementCents: 100, customMaxSpendIncrementCents: 10000, customMaxPointTenthsPerIncrement: 50, customMinEligibleFloorCents: 0,
  maxPointTenthsPerTicket: 10000, lowBalanceCents: 2000, criticalBalanceCents: 500, reservationTtlSeconds: 900,
  purchasePresetsTokens: [10, 25, 50, 100, 250, 500], maxPurchaseTokens: 5000, termsVersion: 't', version: 1,
};
const rate = (spend: number, tenths: number, extra: Partial<EarningRate> = {}): EarningRate => ({ spendIncrementCents: spend, pointTenthsPerIncrement: tenths, minEligibleCents: 0, perTicketCapTenths: null, roundingMode: 'COMPLETED_INCREMENT', ...extra });
const GLOBAL_5 = rate(500, 5);            // $5 = 0.5 point (guide §2.2)
const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return e instanceof GlobalRewardsError ? e.code : String(e); } };

describe('earn + exact token backing — LoyaltyTokens §2.3 / §13.1', () => {
  it.each([
    [499, 0, 0], [500, 5, 5], [750, 5, 5], [1000, 10, 10], [1999, 15, 15], [2500, 25, 25], [5000, 50, 50], [10000, 100, 100], [20000, 200, 200],
  ])('$%d¢ → %d tenths of a point, %d¢ of tokens', (cents, tenths, backing) => {
    expect(computeEarn(cents, GLOBAL_5, program)).toMatchObject({ pointTenths: tenths, backingCents: backing });
  });
  it('three customers 1 + 5 + 10 points debit 0.10 + 0.50 + 1.00 → a 100-token wallet keeps 98.40', () => {
    const debits = [1000, 5000, 10000].map((c) => computeEarn(c, GLOBAL_5, program).backingCents);
    expect(debits).toEqual([10, 50, 100]);
    expect(tokensLabel(10000 - debits.reduce((a, b) => a + b, 0))).toBe('98.40');
  });
  it('one point-tenth is exactly one cent at 10 points = $1', () => { expect(centsPerPointTenth(program)).toBe(1); });
});

describe('Global vs Custom — LoyaltyRules §1.4 / §4.6 / §8.1 ($100 eligible)', () => {
  const r = (x: EarningRate) => computeEarn(10000, x, program);
  it('GLOBAL $10=1 → 10 points, 1.00 token', () => expect(r(rate(1000, 10))).toMatchObject({ pointTenths: 100, backingCents: 100 }));
  it('CUSTOM $10=2 → 20 points, 2.00 tokens (the generous rule pays for itself)', () => expect(r(rate(1000, 20))).toMatchObject({ pointTenths: 200, backingCents: 200 }));
  it('CUSTOM $20=1 → 5 points, 0.50 token', () => expect(r(rate(2000, 10))).toMatchObject({ pointTenths: 50, backingCents: 50 }));
  it('GLOBAL $10=1.5 → 15 points, 1.50 tokens; per $10: 0.15 token (A/C) vs 0.20 (custom B)', () => {
    expect(r(rate(1000, 15))).toMatchObject({ pointTenths: 150, backingCents: 150 });
    expect(computeEarn(1000, rate(1000, 15), program).backingCents).toBe(15);
    expect(computeEarn(1000, rate(1000, 20), program).backingCents).toBe(20);
  });
  it('caps: the rule cap and the global safety cap; a minimum earns nothing below it', () => {
    expect(computeEarn(100000, rate(1000, 10, { perTicketCapTenths: 50 }), program)).toMatchObject({ pointTenths: 50, cappedBy: 'rule' });
    expect(computeEarn(10_000_000, rate(100, 50), program)).toMatchObject({ pointTenths: 10000, cappedBy: 'program' });
    expect(computeEarn(1999, rate(1000, 10, { minEligibleCents: 2000 }), program)).toMatchObject({ pointTenths: 0, belowMinimum: true });
  });
});

describe('custom rule validation — addendum §1.2 / §3.3', () => {
  it('accepts a complete in-policy rate and normalises it', () => {
    expect(validateCustomRate({ spendIncrementCents: '1000', pointTenthsPerIncrement: 20 }, program)).toEqual(rate(1000, 20));
  });
  it('refuses zero, negative, fractional, missing and out-of-policy values', () => {
    expect(code(() => validateCustomRate({ spendIncrementCents: 0, pointTenthsPerIncrement: 10 }, program))).toBe('EARNING_RULE_INVALID');
    expect(code(() => validateCustomRate({ spendIncrementCents: 1000, pointTenthsPerIncrement: -1 }, program))).toBe('EARNING_RULE_INVALID');
    expect(code(() => validateCustomRate({ spendIncrementCents: 999.5, pointTenthsPerIncrement: 10 }, program))).toBe('EARNING_RULE_INVALID');
    expect(code(() => validateCustomRate({ pointTenthsPerIncrement: 10 }, program))).toBe('EARNING_RULE_INVALID');
    expect(code(() => validateCustomRate({ spendIncrementCents: 50, pointTenthsPerIncrement: 10 }, program))).toBe('EARNING_RULE_OUT_OF_POLICY');
    expect(code(() => validateCustomRate({ spendIncrementCents: 1000, pointTenthsPerIncrement: 51 }, program))).toBe('EARNING_RULE_OUT_OF_POLICY');
    expect(code(() => validateCustomRate({ spendIncrementCents: 1000, pointTenthsPerIncrement: 10, perTicketCapTenths: 10001 }, program))).toBe('EARNING_RULE_OUT_OF_POLICY');
    expect(code(() => validateCustomRate({ spendIncrementCents: 1000, pointTenthsPerIncrement: 10, roundingMode: 'ROUND_UP' }, program))).toBe('EARNING_RULE_INVALID');
  });
  it('preview: $5 / $10 / $25 / $50 / $100, token cost and the difference from global', () => {
    const rows = previewRows(rate(1000, 20), rate(1000, 10), program);
    expect(rows.map((x) => x.eligibleCents)).toEqual([500, 1000, 2500, 5000, 10000]);
    expect(rows[4]).toEqual({ eligibleCents: 10000, pointTenths: 200, tokenCostCents: 200, globalPointTenths: 100, globalTokenCostCents: 100, differenceCents: 100 });
    expect(rows[0]).toMatchObject({ pointTenths: 0, tokenCostCents: 0 });
  });
});

describe('time-based resolution — addendum §1.3 / §2.3 / §3.1 / §4.5 (T01, T02, T05, T06, T07, T24)', () => {
  const v = (n: number, mode: 'GLOBAL' | 'CUSTOM', status: PolicyVersion['status'], from: string | null): PolicyVersion =>
    ({ id: 'v' + n, versionNo: n, mode, status, effectiveFrom: from, rate: mode === 'CUSTOM' ? rate(1000, 20) : null });
  const now = new Date('2026-11-01T12:00:00Z');
  it('T01 no rows → GLOBAL; T02 a draft never counts', () => {
    expect(policyDisplay([], now)).toMatchObject({ current: null, mode: 'GLOBAL' });
    expect(policyDisplay([v(1, 'CUSTOM', 'DRAFT', null)], now)).toMatchObject({ mode: 'GLOBAL', drafts: [expect.objectContaining({ id: 'v1' })] });
  });
  it('T06 a future custom stays Global until its time, then Custom; a late worker resolves the ORIGINAL time', () => {
    const vs = [v(1, 'CUSTOM', 'ACTIVATED', '2026-11-15T05:00:00Z')];
    const d = policyDisplay(vs, now);
    expect(d.mode).toBe('GLOBAL'); expect(d.scheduled.map((x) => x.id)).toEqual(['v1']);
    expect(policyVersionAt(vs, new Date('2026-11-15T04:59:59Z'))).toBeNull();
    expect(policyVersionAt(vs, new Date('2026-11-15T05:00:00Z'))?.id).toBe('v1');
    expect(versionDisplayState(vs[0], policyVersionAt(vs, now), now)).toBe('SCHEDULED');
  });
  it('T07 return to Global keeps the custom history; canceled / discarded never resolve', () => {
    const vs = [v(1, 'CUSTOM', 'ACTIVATED', '2026-10-01T00:00:00Z'), v(2, 'GLOBAL', 'ACTIVATED', '2026-10-20T00:00:00Z'), v(3, 'CUSTOM', 'CANCELED', '2026-10-25T00:00:00Z'), v(4, 'CUSTOM', 'DISCARDED', null)];
    expect(policyVersionAt(vs, new Date('2026-10-10T00:00:00Z'))?.id).toBe('v1');
    expect(policyVersionAt(vs, now)?.mode).toBe('GLOBAL');
    const inForce = policyVersionAt(vs, now);
    expect(vs.map((x) => versionDisplayState(x, inForce, now))).toEqual(['SUPERSEDED', 'ACTIVE', 'CANCELED', 'DISCARDED']);
  });
  it('global versions: the latest published effective version; a canceled or future one never applies', () => {
    const g = [{ status: 'published', effectiveFrom: '2000-01-01T00:00:00Z', versionNo: 1 }, { status: 'published', effectiveFrom: '2026-11-02T04:00:00Z', versionNo: 2 }, { status: 'canceled', effectiveFrom: '2026-10-01T00:00:00Z', versionNo: 3 }];
    expect(globalVersionAt(g, now)?.versionNo).toBe(1);
    expect(globalVersionAt(g, new Date('2026-11-02T04:00:00Z'))?.versionNo).toBe(2);
  });
});

describe('eligibility, redemption, alerts, labels, purchases', () => {
  it('eligible basis excludes tax, tips, gift-card value bought and the reward-funded part', () => {
    expect(eligibleCentsOf({ paidCents: 11500, taxCents: 700, tipCents: 800, giftCardChargeCents: 0, rewardTenderCents: 0 })).toBe(10000);
    expect(eligibleCentsOf({ paidCents: 4900, taxCents: 0, tipCents: 0, giftCardChargeCents: 0, rewardTenderCents: 0 })).toBe(4900);
    expect(eligibleCentsOf({ paidCents: 5000, taxCents: 0, tipCents: 0, giftCardChargeCents: 6000, rewardTenderCents: 0 })).toBe(0);
  });
  it('redeem in whole 10-point blocks, never above what the ticket owes', () => {
    expect(redeemableBlocks(100, 5000, program)).toEqual({ blocks: 1, pointTenths: 100, valueCents: 100 });
    expect(redeemableBlocks(99, 5000, program)).toEqual({ blocks: 0, pointTenths: 0, valueCents: 0 });
    expect(redeemableBlocks(1000, 350, program)).toEqual({ blocks: 3, pointTenths: 300, valueCents: 300 });
  });
  it('low 20 / critical 5 tokens', () => {
    expect([3000, 2000, 500, 0].map((c) => alertLevel(c, program))).toEqual(['ok', 'low', 'critical', 'empty']);
  });
  it('exact labels', () => {
    expect([5, 100, 15, 0].map(tenthsLabel)).toEqual(['0.5', '10', '1.5', '0']);
    expect([5, 12575, 100].map((c) => tokensLabel(c))).toEqual(['0.05', '125.75', '1.00']);
    expect(rateLabel(rate(1000, 10))).toBe('$10.00 = 1 point');
    expect(rateLabel(rate(500, 5))).toBe('$5.00 = 0.5 points');
  });
  it('purchases: whole tokens within the limit; only FUNDS_VERIFIED is spendable', () => {
    expect(purchaseQuantity(100, program)).toEqual({ tokenCents: 10000, amountCents: 10000 });
    expect(code(() => purchaseQuantity(0, program))).toBe('VALIDATION_FAILED');
    expect(code(() => purchaseQuantity(10.5, program))).toBe('VALIDATION_FAILED');
    expect(code(() => purchaseQuantity(5001, program))).toBe('VALIDATION_FAILED');
    expect(['PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING', 'UNKNOWN', 'FUNDS_VERIFIED'].map(isSpendable)).toEqual([false, false, false, true]);
  });
});

describe('refundedEligibleCentsOf (Nov 3 audit: tip / tax refunds never take back points)', () => {
  it('a tip-only refund removes nothing from the earning amount', () => {
    expect(refundedEligibleCentsOf({ paidCents: 12000, taxCents: 0, tipCents: 2000, eligibleCents: 10000, refunds: [{ amountCents: 2000, tipRefunded: true }] })).toBe(0);
  });
  it('a service refund removes its own amount less its tax share; capped at the eligible amount', () => {
    expect(refundedEligibleCentsOf({ paidCents: 10600, taxCents: 600, tipCents: 0, eligibleCents: 10000, refunds: [{ amountCents: 5300 }] })).toBe(5000);
    expect(refundedEligibleCentsOf({ paidCents: 10600, taxCents: 600, tipCents: 0, eligibleCents: 10000, refunds: [{ amountCents: 10600 }, { amountCents: 500 }] })).toBe(10000);
  });
  it('a refund marked with the tip takes the tip first, then service money', () => {
    expect(refundedEligibleCentsOf({ paidCents: 12000, taxCents: 0, tipCents: 2000, eligibleCents: 10000, refunds: [{ amountCents: 7000, tipRefunded: true }] })).toBe(5000);
  });
});

// extras GLOBAL LOYALTY REWARDS 03 (round 10): the funding forecast arithmetic (verified use only, nothing bought)
describe('walletFundingForecast', () => {
  it('daily pace from the window, days left / to the low level, funding needed beyond available + pending', () => {
    expect(walletFundingForecast(10_000, 0, 9_000, 30, 2_000)).toEqual({ basisDays: 30, usedCents: 9_000, dailyCents: 300, daysLeft: 33, daysToLow: 26, fundingNeededCents: 0, automaticPurchase: false });
    expect(walletFundingForecast(1_000, 2_000, 9_000, 30, 2_000)).toMatchObject({ daysLeft: 3, daysToLow: 0, fundingNeededCents: 9_000 - 1_000 - 2_000 });
    expect(walletFundingForecast(0, 0, 100, 30, 0)).toMatchObject({ dailyCents: 4, daysLeft: 0 });   // 3.33 rounds UP — never flatters
  });
  it('no verified use → no estimate (never invented)', () => {
    expect(walletFundingForecast(10_000, 0, 0, 30, 2_000)).toEqual({ basisDays: 30, usedCents: 0, dailyCents: null, daysLeft: null, daysToLow: null, fundingNeededCents: null, automaticPurchase: false });
  });
});
