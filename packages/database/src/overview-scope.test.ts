import { describe, it, expect } from 'vitest';
import { parseScope, isScoped, andTenant, tenantPred } from './overview-scope';

describe('overview-scope contract', () => {
  it('parseScope treats absent / empty / "all" as unscoped (platform-wide)', () => {
    expect(parseScope(undefined)).toEqual({});
    expect(parseScope('')).toEqual({});
    expect(parseScope('   ')).toEqual({});
    expect(parseScope('all')).toEqual({});
    expect(parseScope('ALL')).toEqual({});
  });

  it('parseScope captures a real tenant id (trimmed, first of array)', () => {
    expect(parseScope('t-42')).toEqual({ tenantId: 't-42' });
    expect(parseScope('  t-42  ')).toEqual({ tenantId: 't-42' });
    expect(parseScope(['t-7', 't-8'])).toEqual({ tenantId: 't-7' });
  });

  it('isScoped reflects whether a tenant is set', () => {
    expect(isScoped(parseScope('all'))).toBe(false);
    expect(isScoped(parseScope('t-1'))).toBe(true);
    expect(isScoped(undefined)).toBe(false);
  });

  it('SQL helpers return a fragment object whether scoped or not (no throw)', () => {
    // Unscoped -> no-op fragment; scoped -> predicate. Both must be RawBuilders the query can interpolate.
    expect(andTenant({})).toBeDefined();
    expect(andTenant({ tenantId: 't-1' }, 'q.tenant_id')).toBeDefined();
    expect(tenantPred({})).toBeDefined();
    expect(tenantPred({ tenantId: 't-1' })).toBeDefined();
  });
});
