// ai-checkout-upsell-core.vitest.spec.ts — the pure recommendation core. Covers the safety/honesty invariants: never
// invents a price, never surfaces out-of-stock, excludes existing members, no fabricated savings, never invents loyalty
// points, suppresses rebooking when a future appointment exists, and enforces fatigue caps.
import { describe, it, expect } from 'vitest';
import {
  recommendAddOns, applyFatigueLimits, recommendProducts, recommendMembership,
  recommendLoyaltyEnrollment, recommendLoyaltyRedemption, recommendGiftCard, recommendNextAppointment,
  type AddOnCandidate, type RecommendationCard,
} from './ai-checkout-upsell-core';

const addon = (id: string, name: string, dur: number, active = true): AddOnCandidate =>
  ({ addOnId: id, name, priceCents: 1200, durationDeltaMinutes: dur, isTaxable: false, isActive: active, sourceServiceId: 's1', sourceServiceName: 'Gel Manicure' });

describe('add-on recommender (§11/§12)', () => {
  it('excludes inactive + in-cart + duplicate ids, ranks by time impact, never invents price', () => {
    const r = recommendAddOns({ candidates: [addon('a', 'Nail Art', 20), addon('b', 'Cuticle', 10), addon('c', 'Off', 5, false), addon('a', 'dup', 20), addon('d', 'Gel Removal', 15)], cartAddOnIds: ['b'], sameVisitFeasible: true, maxAddOns: 3, ticketSubtotalCents: 10000 });
    expect(r.some((x) => x.targetId === 'c')).toBe(false);
    expect(r.some((x) => x.targetId === 'b')).toBe(false);
    expect(r.filter((x) => x.targetId === 'a').length).toBe(1);
    expect(r[0].targetId).toBe('d'); // 15 min before 20 min
    expect(r.every((x) => x.priceCents === 1200)).toBe(true);
  });
  it('marks an add-on ineligible for the current cart once the service is complete (§11)', () => {
    const r = recommendAddOns({ candidates: [addon('x', 'Paraffin', 10)], cartAddOnIds: [], sameVisitFeasible: false, maxAddOns: 3, ticketSubtotalCents: 10000 });
    expect(r[0].eligible).toBe(false);
    expect(r[0].reason).toMatch(/next visit/i);
  });
});

describe('product recommender (§13/§14)', () => {
  it('excludes out-of-stock + inactive, ranks aftercare first, makes no medical claim', () => {
    const r = recommendProducts({ candidates: [
      { productId: 'p1', name: 'Cuticle Oil', priceCents: 1200, isActive: true, sellable: true, stockStatus: 'in_stock', aftercareForServiceName: 'Gel Manicure' },
      { productId: 'p2', name: 'Top Coat', priceCents: 900, isActive: true, sellable: true, stockStatus: 'out_of_stock' },
      { productId: 'p4', name: 'Discontinued', priceCents: 500, isActive: false, sellable: true, stockStatus: 'in_stock' },
    ], max: 5 });
    expect(r.some((x) => x.targetId === 'p2')).toBe(false);
    expect(r.some((x) => x.targetId === 'p4')).toBe(false);
    expect(r[0].title).toBe('Cuticle Oil');
    expect(r.map((x) => x.reason).join(' ')).not.toMatch(/\b(cures|heals|treats|medical benefit|therapeutic)\b/i);
  });
});

describe('membership recommender (§15)', () => {
  it('excludes existing members + ineligible, gives honest caveated savings only from real prices', () => {
    const r = recommendMembership({ candidates: [
      { planId: 'gold', name: 'Gold', recurringPriceCents: 3900, billingFrequency: 'month', includedBenefit: 'One Gel Manicure monthly', eligibleToday: true, customerAlreadyHasActive: false, todayEligibleServicePriceCents: 5000 },
      { planId: 'silver', name: 'Silver', recurringPriceCents: 2900, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: true },
    ], max: 5 });
    expect(r.some((x) => x.targetId === 'silver')).toBe(false);
    expect(r[0].description).toMatch(/renews automatically/);
    expect(r[0].reason).toMatch(/may reduce.*\$11\.00\/month/);
    expect(r[0].reason).toMatch(/Actual value depends/);
    const noPrice = recommendMembership({ candidates: [{ planId: 'g', name: 'G', recurringPriceCents: 3900, billingFrequency: 'month', includedBenefit: 'x', eligibleToday: true, customerAlreadyHasActive: false }], max: 5 });
    expect(noPrice[0].reason).not.toMatch(/may reduce/);
  });
});

describe('loyalty + gift card + next appointment (§17-§21)', () => {
  it('never invents loyalty balances and only suggests affordable rewards', () => {
    expect(recommendLoyaltyEnrollment({ programActive: true, branchParticipates: true, alreadyEnrolled: true, eligible: true, programName: 'R' })).toBeNull();
    const redeem = recommendLoyaltyRedemption({ enrolled: true, balancePoints: 500, cartEligible: true, rewards: [{ rewardId: 'r5', label: '$5', pointsCost: 500, valueCents: 500 }, { rewardId: 'r10', label: '$10', pointsCost: 1000, valueCents: 1000 }] });
    expect(redeem!.targetId).toBe('r5');
    expect(recommendLoyaltyRedemption({ enrolled: true, balancePoints: 100, cartEligible: true, rewards: [{ rewardId: 'r5', label: '$5', pointsCost: 500, valueCents: 500 }] })).toBeNull();
  });
  it('gift card gated by enable; rebooking suppressed when a future appointment exists', () => {
    expect(recommendGiftCard({ enabled: false, allowedAmountsCents: [2500] })).toBeNull();
    expect(recommendNextAppointment({ hasEquivalentFutureAppointment: true, lastServiceName: 'Gel', suggestedReturnDays: 30 })).toBeNull();
    expect(recommendNextAppointment({ hasEquivalentFutureAppointment: false, lastServiceName: 'Gel Manicure', suggestedReturnDays: 30 })!.title).toBe('Book next Gel Manicure');
  });
});

describe('fatigue limits (§24)', () => {
  it('enforces category + global caps and drops dismissed cards', () => {
    const cards: RecommendationCard[] = [
      { type: 'service_addon', targetId: 'ao1', title: 'x', description: '', priceCents: 1, confidence: 'high', reason: '', eligible: true },
      { type: 'service_addon', targetId: 'ao2', title: 'x', description: '', priceCents: 1, confidence: 'high', reason: '', eligible: true },
      { type: 'product', targetId: 'p1', title: 'x', description: '', priceCents: 1, confidence: 'high', reason: '', eligible: true },
      { type: 'product', targetId: 'p2', title: 'x', description: '', priceCents: 1, confidence: 'high', reason: '', eligible: true },
    ];
    const out = applyFatigueLimits(cards, { maxTotal: 3, maxProduct: 1, maxAddOn: 2, maxMembership: 1 }, ['ao2']); // ao2 dismissed; p2 over the product cap — 2 survivors is the correct ceiling
    expect(out.some((c) => c.targetId === 'ao2')).toBe(false);
    expect(out.filter((c) => c.type === 'product').length).toBe(1);
    expect(out.length).toBe(2);
  });
});
