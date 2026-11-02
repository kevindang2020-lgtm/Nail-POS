// membership-enroll-core.vitest.spec.ts — pure enrollment/redemption helpers.
import { describe, it, expect } from 'vitest';
import { eligibleForBasis, commissionSnapshot, initialIssuedEntries, memberNumber } from './membership-enroll-core';

describe('eligibleForBasis', () => {
  it('picks the basis amount', () => {
    expect(eligibleForBasis('standard', 5000, 4000, 2000)).toBe(5000);
    expect(eligibleForBasis('fixed', 5000, 4000, 2000)).toBe(2000);
    expect(eligibleForBasis('allocated', 5000, 4000, 2000)).toBe(4000);
    expect(eligibleForBasis('weird', 5000, 4000, 2000)).toBe(4000); // defaults to allocated
  });
});

describe('commissionSnapshot', () => {
  it('freezes a split that reconciles exactly', () => {
    const s = commissionSnapshot('standard', 60, 5000, 4000, 0);
    expect(s.eligibleCents).toBe(5000);
    expect(s.techCents).toBe(3000);
    expect(s.ownerCents).toBe(2000);
    expect(s.techCents + s.ownerCents).toBe(s.eligibleCents);
  });
});

describe('initialIssuedEntries', () => {
  it('issues service credits and dollar credits, skips discounts', () => {
    const entries = initialIssuedEntries([
      { benefitId: 'b1', benefitType: 'service_credit', serviceId: 's1', creditsPerCycle: 2, valueCents: 0 },
      { benefitId: 'b2', benefitType: 'dollar_credit', serviceId: null, creditsPerCycle: 0, valueCents: 1500 },
      { benefitId: 'b3', benefitType: 'percent_discount', serviceId: null, creditsPerCycle: 0, valueCents: 0 },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ benefitId: 'b1', quantity: 2, amountCents: 0 });
    expect(entries[1]).toMatchObject({ benefitId: 'b2', quantity: 0, amountCents: 1500 });
  });
});

describe('memberNumber', () => {
  it('is prefixed and uppercased', () => {
    expect(memberNumber('abc123')).toMatch(/^M-[A-Z0-9]+$/);
  });
});
