// Constitution 7 §34 — the Deals engine kill switch in DealsService.
import { describe, it, expect } from 'vitest';
import { DealsService } from './deals.service';

function svcWith(off: boolean | (() => boolean), clock = { t: 0 }) {
  const calls = { flag: 0 };
  const repo: any = {
    async dealsEngineDisabled() { calls.flag++; return typeof off === 'function' ? off() : off; },
    async nearbyActiveDealRows() { return [{ id: 'd1' }]; },
    async findConsumedHoldForAppointment() { return { dealId: 'd1' }; },
    async getDeal() { return null; },
  };
  return { svc: new DealsService(repo, () => clock.t), calls, clock };
}
const ctx: any = { userId: 'u', tenantId: 't' };

describe('Deals engine kill switch', () => {
  it('off: the public feed is empty, reservations are refused, checkout applies no deal (non-fatal)', async () => {
    const { svc } = svcWith(true);
    expect(await svc.nearbyDeals({})).toEqual([]);
    await expect(svc.reserveDeal(ctx, 'd1', 'c1', 'k1')).rejects.toThrow(/paused/);
    expect(await svc.redeemDealAtCheckout(ctx, 'a1', 5000, { customerId: 'c1' })).toEqual({ applied: false, reason: 'Deals are temporarily paused.' });
  });
  it('on: behaviour unchanged (checkout reaches the normal lookup)', async () => {
    const { svc } = svcWith(false);
    expect(await svc.redeemDealAtCheckout(ctx, 'a1', 5000, { customerId: 'c1' })).toEqual({ applied: false, reason: 'Deal not found.' });
  });
  it('the flag is read at most every 30 s', async () => {
    let off = false; const s = svcWith(() => off);
    await s.svc.nearbyDeals({}); off = true;
    expect(await s.svc.redeemDealAtCheckout(ctx, 'a1', 5000, { customerId: 'c1' })).toMatchObject({ reason: 'Deal not found.' });   // cached
    s.clock.t = 31_000;
    expect(await s.svc.redeemDealAtCheckout(ctx, 'a1', 5000, { customerId: 'c1' })).toMatchObject({ reason: 'Deals are temporarily paused.' });
    expect(s.calls.flag).toBe(2);
  });
});
