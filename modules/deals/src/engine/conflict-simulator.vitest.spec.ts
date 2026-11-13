// conflict-simulator.vitest.spec — Promotions Management 15: every staging fixture runs through the REAL engines
// (priceTicket, refundOutcome) and the outcome is pinned; the simulator itself writes nothing (pure).
import { describe, it, expect } from 'vitest';
import { simulateConflicts, CHECKOUT_CONFLICT_FIXTURES } from './conflict-simulator';
import { priceTicket } from './pricing';

const run = (name: string) => simulateConflicts(CHECKOUT_CONFLICT_FIXTURES.find((f) => f.name === name)!);
const codes = (name: string) => run(name).conflicts.map((c) => c.code + (c.offerId ? ':' + c.offerId : '') + (c.reason ? ':' + c.reason : '') + (c.cents != null ? ':' + c.cents : ''));

describe('Promotions 15 — checkout conflict simulator (staging fixtures)', () => {
  it('coupons and deals: alone, and best-single keeps the better one', () => {
    expect(run('coupon_alone_card')).toMatchObject({ dueCents: 6400, tenderedCents: 6400, conflicts: [] });
    expect(run('coupon_vs_deal_best_single').pricing.applied.map((a) => a.id)).toEqual(['coupon-20']);
    expect(codes('coupon_vs_deal_best_single')).toEqual(['offer_rejected:deal-10:not_best']);
  });
  it('membership: blocked or allowed by the salon policy', () => {
    // not combinable: the engine keeps the bigger benefit (the $16 coupon) and says why the $15 membership credit stayed off
    expect(codes('coupon_with_membership_blocked')).toEqual(['offer_rejected:member-15:not_with_membership']);
    expect(run('coupon_with_membership_blocked').dueCents).toBe(6400);
    const ok = run('coupon_with_membership_allowed');
    expect(ok.pricing.applied.map((a) => a.id).sort()).toEqual(['coupon-20', 'member-15']);
    expect(ok).toMatchObject({ dueCents: 5200, conflicts: [] });   // 20% of what the membership left: 8000 − 1500 = 6500 → −1300 → 5200
  });
  it('loyalty stacks after the coupon; a gift card + card split that adds up is clean, one that does not is reported', () => {
    expect(run('coupon_with_loyalty_split_gift_card')).toMatchObject({ dueCents: 5900, byTender: { gift_card: 2500, card: 3400, cash: 0 }, conflicts: [] });
    expect(codes('split_tenders_short')).toEqual(['tenders_short:400']);
  });
  it('the price floor stops a stack; refunds reverse or partly reverse the coupon by the ONE refund rule', () => {
    const floor = run('price_floor_caps_stack');
    expect(floor.pricing.totalDiscountCents).toBeLessThanOrEqual(1600);   // the customer always pays 80 %
    expect(floor.conflicts.some((c) => c.code === 'offer_rejected')).toBe(true);
    expect(codes('refund_one_line_partial')).toEqual(['refund_partial_offer:coupon-20:600']);
    expect(codes('refund_whole_ticket_reverses')).toEqual(['refund_reverses_offer:coupon-20:1600']);
  });
  it('every fixture prices exactly as the engine does, and the fixtures are not changed by a run', () => {
    for (const f of CHECKOUT_CONFLICT_FIXTURES) {
      const before = JSON.stringify(f);
      expect(simulateConflicts(f).pricing.totalDiscountCents).toBe(priceTicket(f.lines, f.offers, f.policy).totalDiscountCents);
      expect(JSON.stringify(f)).toBe(before);
    }
  });
});
