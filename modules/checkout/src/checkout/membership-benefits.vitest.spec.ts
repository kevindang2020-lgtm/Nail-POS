// membership-benefits.vitest.spec.ts — Decision 15 membership step: dollar credits at their real value, percent/fixed
// member discounts on uncovered service lines, never on retail, scoped benefits only where they apply, best one only.
import { describe, it, expect } from 'vitest';
import { membershipDiscountRequests, type MemberLine } from './membership-benefits';

const L = (id: string, price: number, over: Partial<MemberLine> = {}): MemberLine => ({ serviceLineId: id, serviceName: id, serviceId: 'svc_' + id, categoryName: 'Nails', isRetail: false, priceCents: price, ...over });
const lines = [L('gel', 6000), L('pedi', 5000, { categoryName: 'Pedicure' }), L('oil', 1500, { isRetail: true, serviceId: null, categoryName: null })];

describe('membershipDiscountRequests', () => {
  it('an included service comes off at its standard value (capped at the line price)', () => {
    const r = membershipDiscountRequests(lines, [{ redemptionId: 'r1', serviceLineId: 'gel', standardValueCents: 6000, upgradeChargeCents: 0, benefitType: 'included_service' }], []);
    expect(r).toEqual([expect.objectContaining({ id: 'membership-r1', category: 'membership', amountCents: 6000 })]);
  });
  it('BUG FIXED: a $25 dollar credit on a $60 service takes $25 off, not $60', () => {
    const r = membershipDiscountRequests(lines, [{ redemptionId: 'r2', serviceLineId: 'gel', standardValueCents: 6000, upgradeChargeCents: 0, benefitType: 'dollar_credit', allocatedValueCents: 2500 }], []);
    expect(r.map((d) => d.amountCents)).toEqual([2500]);
  });
  it('an upgrade charge reduces what the redemption takes off', () => {
    const r = membershipDiscountRequests(lines, [{ redemptionId: 'r3', serviceLineId: 'gel', standardValueCents: 6000, upgradeChargeCents: 1000 }], []);
    expect(r[0].amountCents).toBe(5000);
  });
  it('GAP FIXED: a 10% member discount applies to service lines, not retail', () => {
    const r = membershipDiscountRequests(lines, [], [{ benefitId: 'b1', benefitType: 'percent_discount', label: '10% off', percent: 10, valueCents: 0, serviceId: null, categoryName: null }]);
    expect(r).toEqual([expect.objectContaining({ id: 'membership-benefit-b1', amountCents: 1100 })]);   // 10% of $60 + $50, not the $15 oil
  });
  it('a line already covered by a redemption is not discounted again', () => {
    const r = membershipDiscountRequests(lines, [{ redemptionId: 'r1', serviceLineId: 'gel', standardValueCents: 6000, upgradeChargeCents: 0 }],
      [{ benefitId: 'b1', benefitType: 'percent_discount', label: '10% off', percent: 10, valueCents: 0, serviceId: null, categoryName: null }]);
    expect(r.map((d) => [d.id, d.amountCents])).toEqual([['membership-r1', 6000], ['membership-benefit-b1', 500]]);
  });
  it('a benefit scoped to a category or service applies only there', () => {
    const cat = membershipDiscountRequests(lines, [], [{ benefitId: 'b2', benefitType: 'percent_discount', label: '20% pedicures', percent: 20, valueCents: 0, serviceId: null, categoryName: 'pedicure' }]);
    expect(cat[0].amountCents).toBe(1000);
    const svc = membershipDiscountRequests(lines, [], [{ benefitId: 'b3', benefitType: 'fixed_discount', label: '$5 off gel', percent: 0, valueCents: 500, serviceId: 'svc_gel', categoryName: null }]);
    expect(svc[0].amountCents).toBe(500);
  });
  it('several benefits → the best ONE for this ticket, never a stack (best listed first OR last)', () => {
    const b = [{ benefitId: 'small', benefitType: 'fixed_discount', label: '$5', percent: 0, valueCents: 500, serviceId: null, categoryName: null },
               { benefitId: 'big', benefitType: 'percent_discount', label: '20%', percent: 20, valueCents: 0, serviceId: null, categoryName: null }];
    for (const order of [b, [...b].reverse()]) {
      const r = membershipDiscountRequests(lines, [], order);
      expect(r.map((d) => d.id)).toEqual(['membership-benefit-big']);
      expect(r[0].amountCents).toBe(2200);
    }
  });
  it('a fixed discount never exceeds the eligible lines; nothing eligible → nothing', () => {
    expect(membershipDiscountRequests([L('gel', 300)], [], [{ benefitId: 'b', benefitType: 'fixed_discount', label: '$5', percent: 0, valueCents: 500, serviceId: null, categoryName: null }])[0].amountCents).toBe(300);
    expect(membershipDiscountRequests([L('oil', 1500, { isRetail: true })], [], [{ benefitId: 'b', benefitType: 'percent_discount', label: '10%', percent: 10, valueCents: 0, serviceId: null, categoryName: null }])).toEqual([]);
  });
});
