import { describe, it, expect } from 'vitest';
import { CustomerService } from './customer.service';
import type { CustomerDataPort } from './customer.repository';

const ctx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'CUSTOMER', permissions: [] };
const make = (over: Record<string, any>) => new CustomerService({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => 'c1', ...over } as unknown as CustomerDataPort);

describe('CustomerService — addresses / deals / referral', () => {
  it('addAddress requires a street line', async () => {
    const svc = make({ createAddress: async (_c: any, _i: any, b: any) => ({ id: 'x', label: b.label ?? null, line1: b.line1, line2: null, city: null, state: null, zip: null, isDefault: false }) });
    await expect(svc.addAddress(ctx, { line1: '   ' } as any)).rejects.toMatchObject({ code: 'invalid' });
    const ok = await svc.addAddress(ctx, { line1: '9 Oak Ave' } as any);
    expect(ok.line1).toBe('9 Oak Ave');
  });
  it('returns [] addresses for a non-customer session', async () => {
    const svc = make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null, listAddresses: async () => [{ id: 'x' } as any] });
    expect(await svc.getAddresses(ctx)).toEqual([]);
  });
  it('referral returns the real code + a share message containing it; null without a customer', async () => {
    const svc = make({ getOrCreateReferralCode: async () => 'REFABC123' });
    const r = await svc.getReferral(ctx);
    expect(r?.code).toBe('REFABC123');
    expect(r?.shareMessage).toContain('REFABC123');
    expect(await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).getReferral(ctx)).toBeNull();
  });
  it('Refer a Friend (Nov 5 2026): the share text promises money only for a live, funded salon offer', async () => {
    const live = make({ getOrCreateReferralCode: async () => 'REFX', referralOffer: async () => ({ salonName: 'Lux Nails', offer: { friendRewardCents: 1000, referrerRewardCents: 1500, minSpendCents: 3000, expiryDays: 90 } }) });
    const r = await live.getReferral(ctx);
    expect(r).toMatchObject({ salonName: 'Lux Nails', offer: { friendRewardCents: 1000, referrerRewardCents: 1500 } });
    expect(r?.shareMessage).toBe('Get $10 off your first visit at Lux Nails (minimum spend $30)! Use my code REFX when you sign up.');
    const none = await make({ getOrCreateReferralCode: async () => 'REFX', referralOffer: async () => ({ salonName: 'Lux Nails', offer: null }) }).getReferral(ctx);
    expect(none?.offer).toBeNull();
    expect(none?.shareMessage).not.toMatch(/\$/);
  });
  it('getProfile returns the record; null without a customer', async () => {
    const svc = make({ profile: async () => ({ fullName: 'A', email: 'a@e.com', phone: '5', smsOptIn: true, emailOptIn: false }) });
    expect((await svc.getProfile(ctx))?.email).toBe('a@e.com');
    expect(await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).getProfile(ctx)).toBeNull();
  });
  it('checkIn returns the repo result for a customer; refuses without one', async () => {
    const svc = make({ checkInAppointment: async () => ({ ok: true, queueItemId: 'q1' }) });
    expect((await svc.checkIn(ctx, 'ap1')).ok).toBe(true);
    expect((await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).checkIn(ctx, 'ap1')).ok).toBe(false);
  });
  it('getRewards returns the repo view; empty without a customer', async () => {
    const svc = make({ listRewards: async () => ({ points: 100, rewards: [{ id: 'r1', title: 'X', description: '', pointsCost: 50, affordable: true }] }) });
    expect((await svc.getRewards(ctx)).points).toBe(100);
    expect((await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).getRewards(ctx)).rewards.length).toBe(0);
  });
  it('redeemReward passes through; refuses without a customer', async () => {
    const svc = make({ redeemReward: async () => ({ ok: true, code: 'RDMX', pointsBalance: 50 }) });
    expect((await svc.redeemReward(ctx, 'r1')).code).toBe('RDMX');
    expect((await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).redeemReward(ctx, 'r1')).ok).toBe(false);
  });
});
