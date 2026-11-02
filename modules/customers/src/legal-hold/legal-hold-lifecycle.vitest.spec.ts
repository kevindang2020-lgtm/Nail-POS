import { describe, it, expect } from 'vitest';
import { validateApplyHold, validateReleaseHold, deletionBlockedByHold, type HoldLike } from './legal-hold-lifecycle';

describe('legal-hold lifecycle', () => {
  it('requires tenant, matter ref, reason, and (for customer scope) a customer', () => {
    expect(validateApplyHold({}).ok).toBe(false);
    expect(validateApplyHold({ tenantId: 't1', matterRef: 'M-1', reason: 'litigation', scope: 'customer', customerId: 'c1' }).ok).toBe(true);
    const noCustomer = validateApplyHold({ tenantId: 't1', matterRef: 'M-1', reason: 'r', scope: 'customer' });
    expect(noCustomer.ok).toBe(false);
    expect(noCustomer.errors.join(' ')).toMatch(/customer is required/i);
  });

  it('accepts a tenant-scoped hold without a customer', () => {
    expect(validateApplyHold({ tenantId: 't1', matterRef: 'M-2', reason: 'audit', scope: 'tenant' }).ok).toBe(true);
  });

  it('rejects an unknown scope', () => {
    expect(validateApplyHold({ tenantId: 't1', matterRef: 'M', reason: 'r', scope: 'galaxy' }).ok).toBe(false);
  });

  it('release requires a reason and an active hold', () => {
    expect(validateReleaseHold('active', { reason: 'matter closed' }).ok).toBe(true);
    expect(validateReleaseHold('active', {}).ok).toBe(false);
    expect(validateReleaseHold('released', { reason: 'x' }).ok).toBe(false);
  });

  it('an active customer-scoped hold blocks deletion of that customer', () => {
    const holds: HoldLike[] = [{ status: 'active', scope: 'customer', customerId: 'c1', tenantId: 't1' }];
    expect(deletionBlockedByHold(holds, { tenantId: 't1', customerId: 'c1' })).toBe(true);
    expect(deletionBlockedByHold(holds, { tenantId: 't1', customerId: 'c2' })).toBe(false);
  });

  it('a tenant-scoped hold blocks deletion of any customer in that tenant', () => {
    const holds: HoldLike[] = [{ status: 'active', scope: 'tenant', customerId: null, tenantId: 't1' }];
    expect(deletionBlockedByHold(holds, { tenantId: 't1', customerId: 'cANY' })).toBe(true);
    expect(deletionBlockedByHold(holds, { tenantId: 't2', customerId: 'cANY' })).toBe(false); // isolation: other tenant unaffected
  });

  it('a released hold does not block deletion', () => {
    const holds: HoldLike[] = [{ status: 'released', scope: 'customer', customerId: 'c1', tenantId: 't1' }];
    expect(deletionBlockedByHold(holds, { tenantId: 't1', customerId: 'c1' })).toBe(false);
  });
});
