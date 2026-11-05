import { describe, it, expect } from 'vitest';
import { planDistribution, summarizeDistribution, statusForAction } from './product-distribution-core';

describe('product-distribution engine', () => {
  it('creates for new tenants, skips existing carriers, no-ops already-distributed', () => {
    const plan = planDistribution(['t1', 't2', 't3'], {
      alreadyDistributedTenantIds: new Set(['t3']),
      tenantsAlreadyCarrying: new Set(['t2']),
      skipExisting: true,
    });
    expect(plan).toEqual([
      { tenantId: 't1', action: 'create' },
      { tenantId: 't2', action: 'skip_existing' },
      { tenantId: 't3', action: 'already_distributed' },
    ]);
  });

  it('duplicates a carrier when skipExisting is false (explicit new tenant product)', () => {
    const plan = planDistribution(['t2'], { alreadyDistributedTenantIds: new Set(), tenantsAlreadyCarrying: new Set(['t2']), skipExisting: false });
    expect(plan[0].action).toBe('create');
  });

  it('de-dupes repeated tenant ids in the request (idempotent input)', () => {
    const plan = planDistribution(['t1', 't1', 't1'], { alreadyDistributedTenantIds: new Set(), tenantsAlreadyCarrying: new Set(), skipExisting: true });
    expect(plan).toHaveLength(1);
  });

  it('summarizes and maps action → status', () => {
    const plan = planDistribution(['t1', 't2', 't3'], { alreadyDistributedTenantIds: new Set(['t3']), tenantsAlreadyCarrying: new Set(['t2']), skipExisting: true });
    expect(summarizeDistribution(plan)).toEqual({ total: 3, created: 1, skippedExisting: 1, alreadyDistributed: 1 });
    expect(statusForAction('create')).toBe('distributed');
    expect(statusForAction('skip_existing')).toBe('skipped_existing');
  });
});
