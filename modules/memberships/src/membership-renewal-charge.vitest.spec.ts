import { describe, it, expect } from 'vitest';
import { renewalChargeFn, membershipAutobillEnabled } from './membership-renewal-charge';
import { CardPointeMembershipChargeAdapter } from './membership-billing.service';

// A tiny Kysely-shaped double: selectFrom('customer_payment_methods') … executeTakeFirst() → the saved card row (or none)
function dbWithCard(row: any) {
  const chain: any = { select: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, executeTakeFirst: async () => row };
  return { selectFrom: () => chain } as any;
}
const req = { tenantId: 't1', amountCents: 4900, currency: 'USD', customerId: 'c1', membershipId: 'm1', idempotencyKey: 'renew-m1-2026-10' };

describe('membership renewal charge (MEMBERSHIP_AUTOBILL_ENABLED)', () => {
  it('is off unless the flag is set', () => {
    expect(membershipAutobillEnabled({})).toBe(false);
    expect(membershipAutobillEnabled({ MEMBERSHIP_AUTOBILL_ENABLED: '1' })).toBe(true);
  });
  it("charges the member's saved card through the TENANT's gateway as a merchant-initiated, scheduled stored credential", async () => {
    const calls: any[] = [];
    const processor = { name: 'cardpointe', authorizeAndCapture: async (i: any) => { calls.push(i); return { approved: true, declined: false, retref: 'RR1', respstat: 'A', respText: 'Approval', amountCents: 4900 }; }, refund: async () => ({ ok: true, respstat: 'A', respText: '' }), voidTransaction: async () => ({ ok: true, respstat: 'A', respText: '' }) };
    const gateway = { resolve: async (tenantId: string) => ({ configured: tenantId === 't1', processor }) } as any;
    const charge = new CardPointeMembershipChargeAdapter(renewalChargeFn(dbWithCard({ token: '9418594164541111', exp_month: 12, exp_year: 2029, is_default: true }), gateway));
    const r = await charge.charge(req);
    expect(r).toMatchObject({ status: 'succeeded', processor: 'cardpointe', processorRef: 'RR1' });
    expect(calls[0]).toMatchObject({ account: '9418594164541111', expiry: '1229', amountCents: 4900, orderId: 'm1', idempotencyKey: 'renew-m1-2026-10', ecomind: 'E', cof: 'M', cofscheduled: 'Y' });
  });
  it('fails honestly, charging nothing, when the salon has no gateway or the member has no saved card', async () => {
    const processor = { name: 'cardpointe', authorizeAndCapture: async () => { throw new Error('must not be called'); } } as any;
    const noGateway = { resolve: async () => ({ configured: false }) } as any;
    expect((await new CardPointeMembershipChargeAdapter(renewalChargeFn(dbWithCard({ token: 'x' }), noGateway)).charge(req)).status).toBe('failed');
    const gateway = { resolve: async () => ({ configured: true, processor }) } as any;
    const r = await new CardPointeMembershipChargeAdapter(renewalChargeFn(dbWithCard(undefined), gateway)).charge(req);
    expect(r.status).toBe('failed');
    expect(r.declineReason).toMatch(/no saved card/i);
  });
});
