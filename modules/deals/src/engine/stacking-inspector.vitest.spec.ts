// stacking-inspector.vitest.spec — Extras · Coupons & Promotions 06: the inspector's answer for every policy agrees with
// what the ONE pricing engine actually does with the same offers (it is checked against priceTicket, not restated).
import { describe, it, expect } from 'vitest';
import { priceTicket, STACKING_MODES, type OfferRequest, type StackingPolicy } from './pricing';
import { stackingInspector } from './stacking-inspector';

const lines = [{ lineId: 'gel', priceCents: 5000 }, { lineId: 'pedi', priceCents: 3000 }];
const pol = (over: Partial<StackingPolicy> = {}): StackingPolicy => ({ mode: 'best_single', allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null, ...over });
const offer = (o: Partial<OfferRequest> = {}): OfferRequest => ({ id: 'me', category: 'coupon', description: 'C', rule: { type: 'fixed', cents: 1000 }, stackable: true, dealId: 'me', ...o });
const row = (r: ReturnType<typeof stackingInspector>, b: string) => r.rows.find((x) => x.benefit === b)!;

describe('stacking inspector agrees with priceTicket', () => {
  const policies: StackingPolicy[] = STACKING_MODES.flatMap((mode) => [true, false].flatMap((m) => [true, false].map((l) => pol({ mode, allowWithMembership: m, allowWithLoyalty: l }))));
  for (const stackable of [true, false]) for (const p of policies) {
    it(`${p.mode} · membership ${p.allowWithMembership} · loyalty ${p.allowWithLoyalty} · stackable ${stackable}`, () => {
      const me = offer({ stackable, stackGroup: 'spring' });
      const ins = stackingInspector(p, { stackable, stackGroup: 'spring' });
      // another combinable offer in a DIFFERENT group: "no" → the engine never keeps both; "conditional" → it does
      const both = priceTicket(lines, [me, offer({ id: 'other', dealId: 'other', stackGroup: 'vip', rule: { type: 'fixed', cents: 900 } })], p);
      expect(both.applied.length === 2).toBe(row(ins, 'other_offer').combines !== 'no');
      // same group under stack_groups: the inspector says so, and the engine refuses the pair
      if (p.mode === 'stack_groups' && stackable) {
        expect(row(ins, 'other_offer').reason).toBe('other_stackable_other_group');
        expect(priceTicket(lines, [me, offer({ id: 'g2', dealId: 'g2', stackGroup: 'spring', rule: { type: 'fixed', cents: 900 } })], p).applied).toHaveLength(1);
      }
      const member: OfferRequest = { id: 'membership-1', category: 'membership', description: 'Member', amountCents: 800 };
      expect(priceTicket(lines, [me, member], p).applied.length === 2).toBe(row(ins, 'membership_discount').combines === 'yes');
      const loyalty: OfferRequest = { id: 'loyalty-1', category: 'loyalty', description: 'Reward', amountCents: 500 };
      expect(priceTicket(lines, [me, loyalty], p).applied.length === 2).toBe(row(ins, 'loyalty_reward').combines === 'yes');
      expect(row(ins, 'membership_credit').combines).toBe('yes');
      expect(row(ins, 'gift_card_tender')).toMatchObject({ combines: 'yes', reason: 'payment_not_discount' });
    });
  }
  it('price floor and total cap are reported as limits with their values (and "none" when unset)', () => {
    const r = stackingInspector(pol({ mode: 'stack_all', priceFloorPercent: 40, maxTotalDiscountPercent: 30 }), { stackable: true, stackGroup: null });
    expect(row(r, 'price_floor')).toMatchObject({ combines: 'limit', value: 40 });
    expect(row(r, 'discount_cap')).toMatchObject({ combines: 'limit', value: 30 });
    // the engine really trims to the cap: 30 % of 8000 = 2400 even though the offers would take 1900 + 1600
    const priced = priceTicket(lines, [offer(), offer({ id: 'b', dealId: 'b', rule: { type: 'percent', percent: 20 } })], pol({ mode: 'stack_all', maxTotalDiscountPercent: 30 }));
    expect(priced.totalDiscountCents).toBeLessThanOrEqual(2400);
    const none = stackingInspector(pol(), { stackable: false, stackGroup: null });
    expect(row(none, 'price_floor')).toMatchObject({ combines: 'none', value: null });
    expect(row(none, 'discount_cap')).toMatchObject({ combines: 'none', value: null });
    expect(row(none, 'other_offer').reason).toBe('policy_one_offer');
  });
});
