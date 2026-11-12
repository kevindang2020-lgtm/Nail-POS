import { describe, it, expect } from 'vitest';
import { stackingMatrix, stackingLimits, stackingMode } from './stackingExplorer';

const v = (s: Parameters<typeof stackingMatrix>[0]) => Object.fromEntries(stackingMatrix(s).map((r) => [r.pair, r.verdict + ':' + r.reason]));

describe('stackingMatrix — mirrors the pricing engine rules for the current settings', () => {
  it('best_single (also the default for a missing/unknown policy): one deal/coupon; loyalty default on, membership off', () => {
    const m = v({ stackingPolicy: 'best_single', allowStackMembership: false, allowStackLoyalty: true });
    expect(m.deal_deal).toBe('blocked:one_offer');
    expect(m.deal_coupon).toBe('blocked:one_offer');
    expect(m.promo_code).toBe('blocked:one_offer');
    expect(m.with_membership).toBe('blocked:better_of_two');
    expect(m.with_loyalty).toBe('allowed:setting_on');
    expect(m.membership_loyalty).toBe('allowed:no_deal');
    expect(m.prepaid_credit).toBe('allowed:prepaid');
    expect(stackingMode({ stackingPolicy: 'nonsense' })).toBe('best_single');
    expect(v({}).with_loyalty).toBe('allowed:setting_on'); // never saved → engine default allows loyalty
  });
  it('stack_all / stack_groups: combinable offers stack, groups add the different-group condition; non-combinable competes alone', () => {
    const a = v({ stackingPolicy: 'stack_all', allowStackMembership: true, allowStackLoyalty: false });
    expect(a.deal_deal).toBe('conditional:both_combinable');
    expect(a.non_combinable).toBe('blocked:competes_alone');
    expect(a.with_membership).toBe('allowed:setting_on');
    expect(a.with_loyalty).toBe('blocked:better_of_two');
    expect(v({ stackingPolicy: 'stack_groups' }).deal_coupon).toBe('conditional:both_combinable_other_group');
  });
  it('exclusive overrides both membership and loyalty settings', () => {
    const e = v({ stackingPolicy: 'exclusive', allowStackMembership: true, allowStackLoyalty: true });
    expect(e.with_membership).toBe('blocked:exclusive');
    expect(e.with_loyalty).toBe('blocked:exclusive');
    expect(e.deal_deal).toBe('blocked:one_offer');
  });
  it('limits: only the floor/cap the salon actually set', () => {
    expect(stackingLimits({ priceFloorPercent: 0, maxTotalDiscountPercent: null })).toEqual({ floorPercent: null, maxPercent: null });
    expect(stackingLimits({ priceFloorPercent: 20, maxTotalDiscountPercent: 50 })).toEqual({ floorPercent: 20, maxPercent: 50 });
  });
});
