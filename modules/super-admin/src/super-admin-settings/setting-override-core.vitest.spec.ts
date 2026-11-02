import { describe, it, expect } from 'vitest';
import { resolveEffectiveSetting, overridePolicyAllows, classifyAdoption } from './setting-override-core';

describe('resolveEffectiveSetting — precedence', () => {
  it('follows mandatory > tenant > branch > platform default > app fallback', () => {
    const all = { mandatory: { value: 'M' }, tenantOverride: { value: 'T' }, branchOverride: { value: 'B' }, platformDefault: { value: 'P' }, appFallback: { value: 'F' } };
    expect(resolveEffectiveSetting(all)).toEqual({ value: 'M', source: 'mandatory' });
    expect(resolveEffectiveSetting({ ...all, mandatory: null })).toEqual({ value: 'T', source: 'tenant_override' });
    expect(resolveEffectiveSetting({ ...all, mandatory: null, tenantOverride: null })).toEqual({ value: 'B', source: 'branch_override' });
    expect(resolveEffectiveSetting({ platformDefault: { value: 'P' }, appFallback: { value: 'F' } })).toEqual({ value: 'P', source: 'platform_default' });
    expect(resolveEffectiveSetting({ appFallback: { value: 'F' } })).toEqual({ value: 'F', source: 'app_fallback' });
    expect(resolveEffectiveSetting({})).toEqual({ value: undefined, source: 'none' });
  });

  it("a mandatory-policy setting ignores tenant and branch overrides (platform default wins)", () => {
    const r = resolveEffectiveSetting({ tenantOverride: { value: 'T' }, branchOverride: { value: 'B' }, platformDefault: { value: 'P' }, policy: 'mandatory' });
    expect(r).toEqual({ value: 'P', source: 'platform_default' });
  });

  it("a tenant_only-policy setting honors tenant overrides but ignores branch overrides", () => {
    expect(resolveEffectiveSetting({ tenantOverride: { value: 'T' }, branchOverride: { value: 'B' }, policy: 'tenant_only' })).toEqual({ value: 'T', source: 'tenant_override' });
    expect(resolveEffectiveSetting({ branchOverride: { value: 'B' }, platformDefault: { value: 'P' }, policy: 'tenant_only' })).toEqual({ value: 'P', source: 'platform_default' });
  });

  it('a changed platform default never displaces an explicit override', () => {
    // tenant override present → changing the platform default from P to P2 keeps the tenant value
    const before = resolveEffectiveSetting({ tenantOverride: { value: 'T' }, platformDefault: { value: 'P' } });
    const after = resolveEffectiveSetting({ tenantOverride: { value: 'T' }, platformDefault: { value: 'P2' } });
    expect(before.value).toBe('T');
    expect(after.value).toBe('T');
  });
});

describe('overridePolicyAllows', () => {
  it('gates override writes by policy + level', () => {
    expect(overridePolicyAllows('mandatory', 'tenant')).toBe(false);
    expect(overridePolicyAllows('mandatory', 'branch')).toBe(false);
    expect(overridePolicyAllows('tenant_only', 'tenant')).toBe(true);
    expect(overridePolicyAllows('tenant_only', 'branch')).toBe(false);
    expect(overridePolicyAllows('overridable', 'tenant')).toBe(true);
    expect(overridePolicyAllows('overridable', 'branch')).toBe(true);
  });
});

describe('classifyAdoption', () => {
  it('classifies fully / partially / not adopted', () => {
    expect(classifyAdoption(10, 0)).toBe('fully_adopted');
    expect(classifyAdoption(10, 10)).toBe('not_adopted');
    expect(classifyAdoption(10, 4)).toBe('partially_adopted');
    expect(classifyAdoption(0, 0)).toBe('fully_adopted');
  });
});
