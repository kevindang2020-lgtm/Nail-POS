// checkout-stacking-order — BUILD_PLAN Phase 5, bug 3. Stacking used to depend on WHICH WAS APPLIED FIRST: the deal's
// redeemer refused to stack on a coupon already on the ticket, but a coupon applied AFTER the (non-stackable) deal was
// added on top of it — same ticket, same two offers, $30 off one way and $10 the other (recorded before the fix:
// scratchpad p5/before-money-bugs.txt). The salon's stacking POLICY now decides, through one engine, whatever the order.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { FakeDealsPort } from './test-support/fake-deals-port';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u', role: 'RECEPTION', permissions: ['pos.checkout.view', 'pos.deals.apply'] } as any;
const TK = 'tk_2042';   // one line, $65
const offers = () => [
  { id: 'DEAL20', title: '$20 off', rule: { type: 'fixed' as const, cents: 2000 }, stackable: false },
  { id: 'C10', title: '$10 coupon', kind: 'coupon' as const, rule: { type: 'fixed' as const, cents: 1000 }, stackable: true, code: 'TEN' },
  { id: 'C5', title: '$5 coupon', kind: 'coupon' as const, rule: { type: 'fixed' as const, cents: 500 }, stackable: true, code: 'FIVE' },
];
async function bill(order: string[], mode: any) {
  const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo).useDeals(new FakeDealsPort(offers(), mode));
  for (const o of order) { await svc.applyOffer(ctx, TK, o === 'DEAL20' ? { dealId: o } : { code: o === 'C10' ? 'TEN' : 'FIVE' }).catch(() => undefined); }
  const t: any = await repo.ticket(ctx, TK);
  return { cents: t.discountCents, ids: (t.discountSnapshot?.applied ?? []).map((a: any) => a.dealId).sort() };
}
const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

describe('stacking does not depend on the order things were applied', () => {
  it.each(['best_single', 'stack_all', 'stack_groups', 'exclusive'])('%s: every order gives the same bill', async (mode) => {
    const results = await Promise.all(perms(['DEAL20', 'C10', 'C5']).map((p) => bill(p, mode)));
    for (const r of results) expect(r).toEqual(results[0]);
  });
  it('best_single keeps the single best offer ($20)', async () => {
    expect(await bill(['C10', 'DEAL20'], 'best_single')).toEqual({ cents: 2000, ids: ['DEAL20'] });
  });
  it('stack_all: the two stackable coupons ($15) lose to the non-stackable $20 deal — the customer gets the better one', async () => {
    expect(await bill(['C10', 'C5', 'DEAL20'], 'stack_all')).toEqual({ cents: 2000, ids: ['DEAL20'] });
  });
});
