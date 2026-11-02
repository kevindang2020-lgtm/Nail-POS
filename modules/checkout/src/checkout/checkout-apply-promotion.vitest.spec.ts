// checkout-apply-promotion — BUILD_PLAN Phase 5: the coupon field ("apply-promotion") is a CODE through the deals engine.
// The code is never echoed back in full; a bad code is refused with the deals domain's reason.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';
import { FakeDealsPort } from './test-support/fake-deals-port';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'FRONT_DESK', permissions: ['pos.checkout.view', 'pos.deals.apply'] } as any;
const TK = 'tk_2041';
const port = () => new FakeDealsPort([{ id: 'C15', title: 'SAVE15', kind: 'coupon', rule: { type: 'percent', percent: 15 }, stackable: true, code: 'SAVE15' }]);

describe('checkout — a coupon code', () => {
  it('applies through the engine; the response shows only the code’s last four characters', async () => {
    const repo = new InMemoryCheckoutRepository();
    const r: any = await new CheckoutService(repo).useDeals(port()).applyPromotion(ctx, TK, 'save15');
    expect(r.promotion).toEqual({ code: '••••VE15', amountCents: 1050 });
    expect((await repo.ticket(ctx, TK) as any).discountSnapshot.applied[0]).toMatchObject({ category: 'coupon', appliedCents: 1050 });
  });
  it('an unknown code is refused with the reason (400)', async () => {
    await expect(new CheckoutService(new InMemoryCheckoutRepository()).useDeals(port()).applyPromotion(ctx, TK, 'NOPE')).rejects.toMatchObject({ name: 'DealRefusedError', status: 400, message: 'That code isn’t valid here.' });
  });
  it('a blank code never reaches the engine', async () => {
    await expect(new CheckoutService(new InMemoryCheckoutRepository()).useDeals(port()).applyPromotion(ctx, TK, '   ')).rejects.toBeInstanceOf(ValidationError);
  });
  it('needs pos.deals.apply', async () => {
    await expect(new CheckoutService(new InMemoryCheckoutRepository()).useDeals(port()).applyPromotion({ ...ctx, permissions: ['pos.checkout.view'] } as any, TK, 'SAVE15')).rejects.toBeTruthy();
  });
});
