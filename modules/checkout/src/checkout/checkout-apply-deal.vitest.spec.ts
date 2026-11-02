// checkout-apply-deal — BUILD_PLAN Phase 5: deals and coupons on a ticket go through the deals domain (the
// CheckoutDealsPort) and the ONE pricing engine. The redeemer-callback API is gone (bug 9 was an object passed where
// that callback belonged). Here: applying by deal, by booked appointment, by code; refusals carry reasons; the same
// deal twice is one application; removing it gives everything back; nothing is redeemed until payment.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError, ForbiddenError } from './checkout.service';
import { FakeDealsPort } from './test-support/fake-deals-port';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'RECEPTION', permissions: ['pos.checkout.view', 'pos.deals.apply', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'] } as any;
const TK = 'tk_2041'; // l1 5500 + l2 1500 = 7000
const deals = () => new FakeDealsPort([
  { id: 'D20', title: '20% off', rule: { type: 'percent', percent: 20 } },
  { id: 'GEL5', title: '$5 off gel', rule: { type: 'fixed', cents: 500 }, lineIds: ['l2'] },
  { id: 'BOOKED', title: 'Booked $10', rule: { type: 'fixed', cents: 1000 }, booked: true },
  { id: 'C15', title: 'SAVE15', kind: 'coupon', rule: { type: 'percent', percent: 15 }, stackable: true, code: 'SAVE15' },
]);
const setup = (port = deals()) => { const repo = new InMemoryCheckoutRepository(); return { repo, port, svc: new CheckoutService(repo).useDeals(port) }; };

describe('checkout — deals on a ticket (Phase 5)', () => {
  it('a receptionist applies a deal: priced by the engine, persisted per line, NOT redeemed yet', async () => {
    const { repo, port, svc } = setup();
    const r: any = await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    expect(r).toMatchObject({ applied: true, dealId: 'D20', discountCents: 1400 });
    const t: any = await repo.ticket(ctx, TK);
    expect(t.discountCents).toBe(1400);
    expect(t.discountSnapshot.version).toBe(2);
    expect(t.discountSnapshot.applied[0]).toMatchObject({ category: 'deal', appliedCents: 1400, dealId: 'D20', redemptionId: 'r1' });
    expect(t.discountSnapshot.lines.find((l: any) => l.lineId === 'l1')).toMatchObject({ discountCents: 1100, netCents: 4400 });
    expect(port.apps[0]).toMatchObject({ status: 'applied', discountCents: 1400 });
  });
  it('a deal on one service is taken off that line only', async () => {
    const { repo, svc } = setup();
    await svc.applyOffer(ctx, TK, { dealId: 'GEL5' });
    const t: any = await repo.ticket(ctx, TK);
    expect(t.discountSnapshot.lines.find((l: any) => l.lineId === 'l2')).toMatchObject({ discountCents: 500, netCents: 1000 });
    expect(t.discountSnapshot.lines.find((l: any) => l.lineId === 'l1')).toMatchObject({ discountCents: 0 });
  });
  it('the same deal twice is ONE application', async () => {
    const { port, svc } = setup();
    await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    const again: any = await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    expect(again.alreadyApplied).toBe(true);
    expect(port.apps.filter((a) => a.status === 'applied')).toHaveLength(1);
  });
  it('best_single: a better deal replaces the one on the ticket (its place given back); a worse one is refused with the reason', async () => {
    const { repo, port, svc } = setup();
    await svc.applyOffer(ctx, TK, { dealId: 'GEL5' });
    const r: any = await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    expect(r.replaced).toBe(1);
    expect(port.apps.find((a) => a.dealId === 'GEL5')!.status).toBe('released');
    expect((await repo.ticket(ctx, TK) as any).discountCents).toBe(1400);
    await expect(svc.applyOffer(ctx, TK, { dealId: 'GEL5' })).rejects.toMatchObject({ name: 'DealRefusedError', status: 409, message: 'A better offer is already on this ticket.' });
  });
  it('a refusal from the deals domain (sold out) changes nothing', async () => {
    const { repo, port, svc } = setup();
    port.soldOut.add('D20');
    await expect(svc.applyOffer(ctx, TK, { dealId: 'D20' })).rejects.toMatchObject({ status: 409 });
    expect((await repo.ticket(ctx, TK) as any).discountCents).toBe(0);
  });
  it('apply-deal (the booked appointment) is non-fatal: applied:false with the reason when there is none', async () => {
    const { svc } = setup(new FakeDealsPort([]));
    expect(await svc.applyDeal(ctx, TK)).toMatchObject({ applied: false, reason: 'No deal reserved for this appointment.' });
    const ok: any = await setup().svc.applyDeal(ctx, TK);
    expect(ok).toMatchObject({ applied: true, dealId: 'BOOKED', discountCents: 1000 });
  });
  it('removing it gives the place back and the price returns', async () => {
    const { repo, port, svc } = setup();
    const r: any = await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    await svc.removeOffer(ctx, TK, r.redemptionId);
    expect(port.apps[0].status).toBe('released');
    expect((await repo.ticket(ctx, TK) as any).discountCents).toBe(0);
    await expect(svc.removeOffer(ctx, TK, r.redemptionId)).rejects.toBeInstanceOf(ValidationError);
  });
  it('paying the ticket redeems what is on it (bug 4: at payment, not at selection)', async () => {
    const { port, svc } = setup();
    await svc.applyOffer(ctx, TK, { dealId: 'D20' });
    expect(port.paid).toEqual([]);
    const due = (await svc.recalculate(ctx, TK, 'cash') as any).totalDueCents;
    await svc.payCash(ctx, TK, { amountReceivedCents: due } as any);
    expect(port.paid).toEqual([TK]);
    expect(port.apps[0].status).toBe('redeemed');
  });
  it('without pos.deals.apply → Forbidden; without the deals domain → an honest "not available"', async () => {
    const { svc } = setup();
    await expect(svc.applyOffer({ ...ctx, permissions: ['pos.checkout.view'] } as any, TK, { dealId: 'D20' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CheckoutService(new InMemoryCheckoutRepository()).applyOffer(ctx, TK, { dealId: 'D20' })).rejects.toThrow(/not available/);
  });
});
