import { describe, it, expect } from 'vitest';
import { validateLimits, validateRules, normalizeGating, validateTemplate } from './membership-controls-core';

describe('validateLimits', () => {
  it('accepts valid non-negative integers', () => {
    const r = validateLimits({ maxProgramsPerTenant: 25, maxActiveMembersPerTenant: 5000, maxBenefitsPerProgram: 12, maxTrialDays: 30 });
    expect(r.ok).toBe(true); expect(r.value.maxProgramsPerTenant).toBe(25);
  });
  it('rejects negatives / non-integers / out-of-range', () => {
    expect(validateLimits({ maxProgramsPerTenant: -1, maxActiveMembersPerTenant: 1, maxBenefitsPerProgram: 1, maxTrialDays: 1 }).ok).toBe(false);
    expect(validateLimits({ maxProgramsPerTenant: 1, maxActiveMembersPerTenant: 1, maxBenefitsPerProgram: 1, maxTrialDays: 9999 }).ok).toBe(false);
  });
});

describe('validateRules', () => {
  it('accepts a valid ruleset', () => {
    const r = validateRules({ allowedBillingIntervals: ['month', 'year'], allowTrials: true, allowFamily: false, requireAutoRenewConsent: true, maxDiscountPercent: 50 });
    expect(r.ok).toBe(true); expect(r.value.allowedBillingIntervals).toEqual(['month', 'year']); expect(r.value.allowFamily).toBe(false);
  });
  it('requires at least one valid interval and a 0..100 discount', () => {
    expect(validateRules({ allowedBillingIntervals: [], maxDiscountPercent: 10 }).ok).toBe(false);
    expect(validateRules({ allowedBillingIntervals: ['month'], maxDiscountPercent: 500 }).ok).toBe(false);
    expect(validateRules({ allowedBillingIntervals: ['nonsense'], maxDiscountPercent: 10 }).ok).toBe(false);
  });
});

describe('normalizeGating', () => {
  it('keeps only known plan codes and coerces booleans', () => {
    expect(normalizeGating({ starter: 0, growth: 1, bogus: true }, ['starter', 'growth', 'premium'])).toEqual({ starter: false, growth: true });
  });
});

describe('validateTemplate', () => {
  it('accepts a valid template and normalizes benefits', () => {
    const r = validateTemplate({ name: 'VIP', productType: 'premium', billingInterval: 'month', priceCents: 9900, trialDays: 14, benefits: [{ benefitType: 'product_discount', label: '10% off', percent: 10 }] }, 30, 12, 50);
    expect(r.ok).toBe(true); expect(r.value.benefits[0].percent).toBe(10);
  });
  it('rejects missing name, bad interval, and over-limit trial/discount', () => {
    expect(validateTemplate({ name: '', productType: 'premium', billingInterval: 'month', priceCents: 0 }).ok).toBe(false);
    expect(validateTemplate({ name: 'x', productType: 'premium', billingInterval: 'decade', priceCents: 0 }).ok).toBe(false);
    expect(validateTemplate({ name: 'x', productType: 'premium', billingInterval: 'month', priceCents: 0, trialDays: 99 }, 30).ok).toBe(false);
    expect(validateTemplate({ name: 'x', productType: 'premium', billingInterval: 'month', priceCents: 0, benefits: [{ benefitType: 'product_discount', percent: 90 }] }, 30, 12, 50).ok).toBe(false);
  });
});
