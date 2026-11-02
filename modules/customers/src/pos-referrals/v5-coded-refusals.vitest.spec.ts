// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): referral refusals carry their registry code (withCode).
import { describe, it, expect } from 'vitest';
import { ReferralsService } from './pos-referrals.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.referrals.manage'] };
describe('V-5: referral refusals carry their registry code', () => {
  it('an unknown code → REFERRAL_CODE_UNKNOWN; self-referral → SELF_REFERRAL', async () => {
    const input = { code: 'ABC123', referredCustomerId: 'c1' } as any;
    expect(await fails(new (ReferralsService as any)(stub()).record(ctx, input))).toMatchObject({ apiCode: 'REFERRAL_CODE_UNKNOWN', message: 'No referral code matches that code' });
    const repo = { findCodeOwner: async () => ({ customerId: 'c1' }), hasReferred: async () => false } as any;
    expect(await fails(new (ReferralsService as any)(repo).record(ctx, input))).toMatchObject({ apiCode: 'SELF_REFERRAL' });
  });
});
