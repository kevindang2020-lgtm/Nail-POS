import { describe, it, expect } from 'vitest';
import { buildReferralKpis, validateRecordReferral, type ReferralRedemption, type ReferralsContext } from './pos-referrals.dto';
import { InMemoryReferralsRepository } from './pos-referrals.repository';
import { ReferralsService, ReferralForbiddenError, ReferralValidationError } from './pos-referrals.service';

const ctx = (o: Partial<ReferralsContext> = {}): ReferralsContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.manage'], ...o });
const redemption = (o: Partial<ReferralRedemption> = {}): ReferralRedemption => ({
  id: 'ref_1', referrerCustomerId: 'cust_a', referrerName: 'Alice', referredCustomerId: 'cust_b', referredName: 'Bob',
  code: 'ALICE10', status: 'pending', rewardCents: 0, redeemedAt: '2026-07-01T00:00:00.000Z', rewardedAt: null, ...o,
});
const codes = [{ customerId: 'cust_a', customerName: 'Alice', code: 'ALICE10' }];

describe('referrals — KPIs (pure)', () => {
  it('summarizes totals, pending, rewarded, and reward value', () => {
    const rows = [redemption(), redemption({ id: 'ref_2', status: 'rewarded', rewardCents: 1500 }), redemption({ id: 'ref_3', status: 'rewarded', rewardCents: 2500 })];
    const k = buildReferralKpis(rows, 5);
    expect(k.codesIssued).toBe(5);
    expect(k.totalReferrals).toBe(3);
    expect(k.pendingReferrals).toBe(1);
    expect(k.rewardedReferrals).toBe(2);
    expect(k.rewardValueCents).toBe(4000);
  });
  it('empty program → all zeros', () => {
    expect(buildReferralKpis([], 0)).toEqual({ codesIssued: 0, totalReferrals: 0, pendingReferrals: 0, rewardedReferrals: 0, rewardValueCents: 0 });
  });
});

describe('referrals — validation (pure)', () => {
  it('requires a code and a referred customer', () => {
    expect(validateRecordReferral({ code: '', referredCustomerId: 'x' }).ok).toBe(false);
    expect(validateRecordReferral({ code: 'ALICE10', referredCustomerId: '' }).ok).toBe(false);
    expect(validateRecordReferral({ code: 'ALICE10', referredCustomerId: 'cust_b' }).ok).toBe(true);
  });
});

describe('referrals — service', () => {
  it('rejects unauthenticated', async () => {
    const svc = new ReferralsService(new InMemoryReferralsRepository([], codes));
    await expect(svc.getState({ ...ctx(), userId: '' } as any)).rejects.toBeInstanceOf(ReferralForbiddenError);
  });
  it('records a referral for a valid code and computes state', async () => {
    const svc = new ReferralsService(new InMemoryReferralsRepository([], codes));
    const row = await svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_b' });
    expect(row.referrerCustomerId).toBe('cust_a');
    expect(row.status).toBe('pending');
    const state = await svc.getState(ctx());
    expect(state.kpis.totalReferrals).toBe(1);
    expect(state.kpis.codesIssued).toBe(1);
  });
  it('rejects unknown code, self-referral, and double-referral', async () => {
    const svc = new ReferralsService(new InMemoryReferralsRepository([], codes));
    await expect(svc.record(ctx(), { code: 'NOPE', referredCustomerId: 'cust_b' })).rejects.toBeInstanceOf(ReferralValidationError);
    await expect(svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_a' })).rejects.toBeInstanceOf(ReferralValidationError);
    await svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_b' });
    await expect(svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_b' })).rejects.toBeInstanceOf(ReferralValidationError);
  });
  it('marks a referral rewarded with a cents amount', async () => {
    const repo = new InMemoryReferralsRepository([], codes);
    const svc = new ReferralsService(repo);
    const row = await svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_b' });
    const rewarded = await svc.reward(ctx(), row.id, 2000);
    expect(rewarded.status).toBe('rewarded');
    expect(rewarded.rewardCents).toBe(2000);
    const state = await svc.getState(ctx());
    expect(state.kpis.rewardedReferrals).toBe(1);
    expect(state.kpis.rewardValueCents).toBe(2000);
  });
  it('rejects a negative reward', async () => {
    const repo = new InMemoryReferralsRepository([], codes);
    const svc = new ReferralsService(repo);
    const row = await svc.record(ctx(), { code: 'ALICE10', referredCustomerId: 'cust_b' });
    await expect(svc.reward(ctx(), row.id, -5)).rejects.toBeInstanceOf(ReferralValidationError);
  });
});
