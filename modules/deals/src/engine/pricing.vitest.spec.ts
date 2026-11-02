// pricing.vitest.spec — the one promotional pricing engine (BUILD_PLAN Phase 5): policy, not call order, decides; the
// customer gets the best combination the policy allows; the floor holds; every cent is allocated to a line.
import { describe, it, expect } from 'vitest';
import { priceTicket, allocate, ruleDiscount, lineNetCents, type OfferRequest, type StackingPolicy } from './pricing';

const lines = [{ lineId: 'gel', priceCents: 5000 }, { lineId: 'pedi', priceCents: 3000 }];
const deal = (over: Partial<OfferRequest> = {}): OfferRequest => ({ id: 'deal-1', category: 'deal', description: 'Deal', rule: { type: 'percent', percent: 20 }, stackable: false, dealId: 'd1', ...over });
const coupon = (over: Partial<OfferRequest> = {}): OfferRequest => ({ id: 'coupon-1', category: 'coupon', description: 'Coupon', rule: { type: 'fixed', cents: 1000 }, stackable: true, dealId: 'c1', ...over });
const pol = (over: Partial<StackingPolicy> = {}): StackingPolicy => ({ mode: 'best_single', allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, ...over });
const ids = (r: ReturnType<typeof priceTicket>) => r.applied.map((a) => a.id).sort();

function permutations<T>(xs: T[]): T[][] { if (xs.length <= 1) return [xs]; return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])); }

describe('policy decides, not order (bug 3)', () => {
  const offers = [deal(), coupon(), coupon({ id: 'coupon-2', rule: { type: 'percent', percent: 5 }, dealId: 'c2' }), { id: 'manual-1', category: 'manual' as const, description: 'M', amountCents: 300 }];
  it.each(['best_single', 'stack_all', 'stack_groups', 'exclusive'] as const)('%s: every order of the same offers gives the same bill', (mode) => {
    const results = permutations(offers).map((p) => priceTicket(lines, p, pol({ mode })));
    for (const r of results) { expect(r.totalDiscountCents).toBe(results[0].totalDiscountCents); expect(ids(r)).toEqual(ids(results[0])); }
  });
  it('best_single: a $16 deal and a $10 coupon → only the deal (the customer’s better one)', () => {
    const r = priceTicket(lines, [coupon(), deal()], pol());
    expect(ids(r)).toEqual(['deal-1']);
    expect(r.totalDiscountCents).toBe(1600);
    expect(r.rejected).toEqual([expect.objectContaining({ id: 'coupon-1', reason: 'not_best' })]);
  });
  it('stack_all: stackable offers combine; a non-stackable one competes alone against them', () => {
    const r = priceTicket(lines, [coupon(), coupon({ id: 'coupon-2', rule: { type: 'fixed', cents: 900 }, dealId: 'c2' }), deal()], pol({ mode: 'stack_all' }));
    expect(ids(r)).toEqual(['coupon-1', 'coupon-2']);                 // 1900 beats the deal's 1600
    expect(r.rejected.find((x) => x.id === 'deal-1')?.reason).toBe('not_stackable');
  });
  it('stack_groups: two offers in the same group never combine', () => {
    const r = priceTicket(lines, [coupon({ stackGroup: 'spring' }), coupon({ id: 'coupon-2', stackGroup: 'spring', rule: { type: 'fixed', cents: 500 }, dealId: 'c2' }), coupon({ id: 'coupon-3', stackGroup: 'vip', rule: { type: 'fixed', cents: 200 }, dealId: 'c3' })], pol({ mode: 'stack_groups' }));
    expect(ids(r)).toEqual(['coupon-1', 'coupon-3']);
    expect(r.rejected.find((x) => x.id === 'coupon-2')?.reason).toBe('same_stack_group');
  });
  it('exclusive: a deal never combines with the member discount — the better of the two is kept', () => {
    const member: OfferRequest = { id: 'membership-benefit-1', category: 'membership', description: 'Member 10%', amountCents: 800 };
    const r = priceTicket(lines, [deal(), member], pol({ mode: 'exclusive', allowWithMembership: true }));
    expect(ids(r)).toEqual(['deal-1']);
    expect(r.rejected[0]).toMatchObject({ id: 'membership-benefit-1', reason: 'not_with_membership' });
  });
  it('a prepaid membership credit always applies, whatever the policy', () => {
    const credit: OfferRequest = { id: 'membership-r1', category: 'membership', description: 'Included pedicure', amountCents: 3000, lineIds: ['pedi'], prepaid: true };
    const r = priceTicket(lines, [deal(), credit], pol({ mode: 'exclusive' }));
    expect(ids(r)).toEqual(['deal-1', 'membership-r1']);
  });
  it('allowWithLoyalty=false: a deal and a reward are priced both ways, the customer keeps the better', () => {
    const reward: OfferRequest = { id: 'loyalty-1', category: 'loyalty', description: 'Reward', amountCents: 2500 };
    const r = priceTicket(lines, [deal(), reward], pol({ allowWithLoyalty: false }));
    expect(ids(r)).toEqual(['loyalty-1']);   // 2500 > 1600
  });
});

describe('fixed calculation order and per-line allocation', () => {
  it('membership first, then the deal on what is left, then the coupon, then manual, then loyalty', () => {
    const r = priceTicket(lines, [
      { id: 'loyalty-1', category: 'loyalty', description: 'L', amountCents: 100 },
      { id: 'manual-1', category: 'manual', description: 'M', amountCents: 100 },
      coupon({ stackable: true }), deal({ stackable: true, rule: { type: 'percent', percent: 10 } }),
      { id: 'membership-r1', category: 'membership', description: 'credit', amountCents: 3000, lineIds: ['pedi'], prepaid: true },
    ], pol({ mode: 'stack_all', allowWithMembership: true }));
    expect(r.applied.map((a) => a.category)).toEqual(['membership', 'deal', 'coupon', 'manual', 'loyalty']);
    expect(r.applied.find((a) => a.id === 'deal-1')!.appliedCents).toBe(500);   // 10% of the $50 left after the credit
  });
  it('a deal on one service is allocated to that line only', () => {
    const r = priceTicket(lines, [deal({ lineIds: ['gel'] })], pol());
    expect(r.applied[0].lines).toEqual([{ lineId: 'gel', cents: 1000 }]);
    expect(r.lines).toEqual([{ lineId: 'gel', priceCents: 5000, discountCents: 1000, netCents: 4000 }, { lineId: 'pedi', priceCents: 3000, discountCents: 0, netCents: 3000 }]);
    expect(lineNetCents(r.snapshot, 'gel', 5000)).toBe(4000);
  });
  it('every applied cent is allocated to a line; allocations sum to the applied amount', () => {
    const r = priceTicket([{ lineId: 'a', priceCents: 333 }, { lineId: 'b', priceCents: 333 }, { lineId: 'c', priceCents: 334 }], [coupon({ rule: { type: 'fixed', cents: 100 } })], pol());
    expect(r.applied[0].lines.reduce((n, l) => n + l.cents, 0)).toBe(100);
    expect(r.lines.reduce((n, l) => n + l.discountCents, 0)).toBe(r.totalDiscountCents);
  });
  it('fixed_price: "Gel for $30" takes $20 off a $50 gel; never raises a cheaper price', () => {
    expect(ruleDiscount({ type: 'fixed_price', cents: 3000 }, 5000)).toBe(2000);
    expect(ruleDiscount({ type: 'fixed_price', cents: 3000 }, 2500)).toBe(0);
  });
  it('a percent deal honours its cap', () => {
    expect(ruleDiscount({ type: 'percent', percent: 50, maxCents: 1500 }, 8000)).toBe(1500);
  });
  it('allocate never gives a line more than it has', () => {
    expect(allocate(500, [{ lineId: 'a', cents: 100 }, { lineId: 'b', cents: 10_000 }]).find((x) => x.lineId === 'a')!.cents).toBeLessThanOrEqual(100);
  });
});

describe('price floor and caps', () => {
  it('a 30% floor: the customer always pays at least 30% — the LAST discount in order is trimmed', () => {
    const r = priceTicket(lines, [deal({ rule: { type: 'percent', percent: 60 }, stackable: true }), coupon({ rule: { type: 'fixed', cents: 2000 } })], pol({ mode: 'stack_all', priceFloorPercent: 30 }));
    expect(r.totalDiscountCents).toBe(5600);            // 8000 - 30% (2400)
    expect(r.applied.find((a) => a.id === 'deal-1')!.appliedCents).toBe(4800);
    expect(r.applied.find((a) => a.id === 'coupon-1')!.appliedCents).toBe(800);
  });
  it('a floor already reached: a further coupon is refused for the floor, not silently ignored', () => {
    const r = priceTicket(lines, [deal({ rule: { type: 'percent', percent: 100 }, stackable: true }), coupon()], pol({ mode: 'stack_all', priceFloorPercent: 10 }));
    expect(r.rejected.find((x) => x.id === 'coupon-1')?.reason).toBe('price_floor');
  });
  it('the total can never be negative and never exceed the subtotal', () => {
    const r = priceTicket(lines, [deal({ rule: { type: 'fixed', cents: 999_999 } })], pol());
    expect(r.totalDiscountCents).toBe(8000);
    expect(r.lines.every((l) => l.netCents >= 0)).toBe(true);
  });
  it('max total discount percent caps a stack', () => {
    const r = priceTicket(lines, [deal({ rule: { type: 'percent', percent: 50 }, stackable: true }), coupon({ rule: { type: 'fixed', cents: 3000 } })], pol({ mode: 'stack_all', maxTotalDiscountPercent: 40 }));
    expect(r.totalDiscountCents).toBe(3200);
  });
});

describe('robustness', () => {
  it('the same offer twice counts once', () => {
    expect(priceTicket(lines, [coupon(), coupon()], pol()).totalDiscountCents).toBe(1000);
  });
  it('no offers, no lines', () => {
    expect(priceTicket([], [], pol()).totalDiscountCents).toBe(0);
    expect(priceTicket(lines, [], pol()).lines.every((l) => l.discountCents === 0)).toBe(true);
  });
  it('an offer worth nothing on these services is rejected as such', () => {
    const r = priceTicket(lines, [deal({ lineIds: ['not-on-ticket'] })], pol());
    expect(r.rejected[0].reason).toBe('no_value');
  });
});
