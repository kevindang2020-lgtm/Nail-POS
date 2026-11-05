import { describe, it, expect } from 'vitest';
import { normalizeCreatePlan, normalizePlanDetailsPatch, validatePricingChange, nextVersionNumber, normalizePlanLimitsUpdate, normalizeGrandfatherCreate } from './plan-mutations-core';

describe('normalizeGrandfatherCreate', () => {
  it('normalizes a valid assignment (locked price + dates optional)', () => {
    const r = normalizeGrandfatherCreate({ tenantId: 'T', planVersionId: 'V', lockedMonthlyPriceCents: 9900, reason: 'legacy deal', migrationTargetPlanCode: 'professional' });
    expect(r).toMatchObject({ tenantId: 'T', planVersionId: 'V', lockedMonthlyPriceCents: 9900, migrationTargetPlanCode: 'professional' });
    expect(r.effectiveFrom).toBeNull();
    // null locked price is allowed (service defaults to version price)
    expect(normalizeGrandfatherCreate({ tenantId: 'T', planVersionId: 'V', reason: 'x' }).lockedMonthlyPriceCents).toBeNull();
  });
  it('rejects missing ids/reason and bad values', () => {
    expect(() => normalizeGrandfatherCreate({ planVersionId: 'V', reason: 'x' })).toThrow(/tenantId/);
    expect(() => normalizeGrandfatherCreate({ tenantId: 'T', reason: 'x' })).toThrow(/planVersionId/);
    expect(() => normalizeGrandfatherCreate({ tenantId: 'T', planVersionId: 'V' })).toThrow(/reason/);
    expect(() => normalizeGrandfatherCreate({ tenantId: 'T', planVersionId: 'V', reason: 'x', lockedMonthlyPriceCents: -1 })).toThrow(/non-negative/);
    expect(() => normalizeGrandfatherCreate({ tenantId: 'T', planVersionId: 'V', reason: 'x', effectiveFrom: 'nope' })).toThrow(/valid date/);
  });
});

describe('normalizePlanLimitsUpdate', () => {
  it('validates metrics and coerces unlimited/null', () => {
    const r = normalizePlanLimitsUpdate({ reason: 'raise caps', changes: [
      { metric: 'customers', limitValue: 5000 },
      { metric: 'branches', limitValue: 'unlimited' },
      { metric: 'users', limitValue: null, enforcement: 'soft', overageAllowed: true, overagePriceCents: 1000 },
    ] });
    expect(r.changes[0]).toEqual({ metric: 'customers', limitValue: 5000 });
    expect(r.changes[1].limitValue).toBeNull();
    expect(r.changes[2]).toMatchObject({ limitValue: null, enforcement: 'soft', overageAllowed: true, overagePriceCents: 1000 });
  });

  it('rejects missing reason, empty changes, bad metric, duplicates, and bad values', () => {
    expect(() => normalizePlanLimitsUpdate({ changes: [{ metric: 'customers', limitValue: 1 }] })).toThrow(/reason/);
    expect(() => normalizePlanLimitsUpdate({ reason: 'x', changes: [] })).toThrow(/at least one/);
    expect(() => normalizePlanLimitsUpdate({ reason: 'x', changes: [{ metric: 'nope', limitValue: 1 }] })).toThrow(/unknown/);
    expect(() => normalizePlanLimitsUpdate({ reason: 'x', changes: [{ metric: 'users', limitValue: 1 }, { metric: 'users', limitValue: 2 }] })).toThrow(/duplicate/);
    expect(() => normalizePlanLimitsUpdate({ reason: 'x', changes: [{ metric: 'users', limitValue: -1 }] })).toThrow(/non-negative/);
  });
});


describe('normalizeCreatePlan', () => {
  it('normalizes a valid plan (code slug, defaults, limits, features)', () => {
    const n = normalizeCreatePlan({
      code: 'Growth-2026', name: 'Growth', monthlyPriceCents: 14900,
      limits: { customers: 3000, branches: null }, features: [{ featureKey: 'ai_insights', state: 'enabled' }],
    });
    expect(n.code).toBe('growth-2026');
    expect(n.plan_type).toBe('standard');
    expect(n.status).toBe('draft');
    expect(n.is_public).toBe(true);
    expect(n.monthly_price_cents).toBe(14900);
    expect(n.limits).toContainEqual({ metric: 'customers', limit_value: 3000 });
    expect(n.limits).toContainEqual({ metric: 'branches', limit_value: null });
    expect(n.features).toEqual([{ feature_key: 'ai_insights', state: 'enabled' }]);
  });

  it('rejects bad code, non-integer/negative cents, unknown metric, and bad enums', () => {
    expect(() => normalizeCreatePlan({ code: '99 bottles!', name: 'X', monthlyPriceCents: 0 })).toThrow(/slug/);
    expect(() => normalizeCreatePlan({ code: 'ok', name: 'X', monthlyPriceCents: 9.99 })).toThrow(/cents/);
    expect(() => normalizeCreatePlan({ code: 'ok', name: 'X', monthlyPriceCents: -1 })).toThrow(/cents/);
    expect(() => normalizeCreatePlan({ code: 'ok', name: 'X', monthlyPriceCents: 0, limits: { bogus: 1 } })).toThrow(/unknown limit metric/);
    expect(() => normalizeCreatePlan({ code: 'ok', name: 'X', monthlyPriceCents: 0, planType: 'wat' })).toThrow(/planType/);
    expect(() => normalizeCreatePlan({ code: 'ok', name: '', monthlyPriceCents: 0 })).toThrow(/name/);
  });
});

describe('normalizePlanDetailsPatch', () => {
  it('accepts non-pricing fields and rejects pricing fields', () => {
    expect(normalizePlanDetailsPatch({ name: 'New', status: 'active' })).toEqual({ name: 'New', status: 'active' });
    expect(() => normalizePlanDetailsPatch({ monthlyPriceCents: 100 })).toThrow(/pricing-change workflow/);
    expect(() => normalizePlanDetailsPatch({})).toThrow(/no editable fields/);
  });
});

describe('validatePricingChange', () => {
  it('requires confirm + reason and validates cents', () => {
    expect(() => validatePricingChange({ monthlyPriceCents: 100, reason: 'x' })).toThrow(/confirm/);
    expect(() => validatePricingChange({ monthlyPriceCents: 100, confirm: true })).toThrow(/reason/);
    expect(() => validatePricingChange({ monthlyPriceCents: 1.5, confirm: true, reason: 'x' })).toThrow(/cents/);
    const v = validatePricingChange({ monthlyPriceCents: 12900, confirm: true, reason: 'market adjustment' });
    expect(v.monthlyPriceCents).toBe(12900);
    expect(v.annualPriceCents).toBeNull();
    expect(v.effectiveFrom instanceof Date).toBe(true);
  });
});

describe('nextVersionNumber', () => {
  it('increments or starts at 1', () => {
    expect(nextVersionNumber(null)).toBe(1);
    expect(nextVersionNumber(3)).toBe(4);
  });
});
