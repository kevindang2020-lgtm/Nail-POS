import { describe, it, expect } from 'vitest';
import { ProductDistributionService } from './product-distribution.service';
import { InMemoryDistributionRepo } from './product-distribution.repository';

const svc = (opts?: any) => new ProductDistributionService(new InMemoryDistributionRepo(opts));

describe('ProductDistributionService', () => {
  it('rejects empty tenant selection and unknown master', async () => {
    expect((await svc().distribute({ masterProductId: 'PM-0001', tenantIds: [] })).ok).toBe(false);
    expect((await svc().distribute({ masterProductId: 'NOPE', tenantIds: ['t1'] })).ok).toBe(false);
  });

  it('creates tenant-owned products and skips tenants already carrying', async () => {
    // seed: PM-0001 exists; tenant t2 already carries it
    const res = await svc().distribute({ masterProductId: 'PM-0001', tenantIds: ['t1', 't2'], reason: 'launch' });
    expect(res.ok).toBe(true);
    expect(res.summary).toMatchObject({ total: 2, created: 1, skippedExisting: 1 });
    const created = res.results!.find((r) => r.tenantId === 't1')!;
    expect(created.action).toBe('create');
    expect(created.tenantProductId).toBeTruthy();     // tenant-owned product linked
    expect(res.results!.find((r) => r.tenantId === 't2')!.action).toBe('skip_existing');
  });

  it('is idempotent: retrying the same push creates no duplicate tenant products', async () => {
    const s = svc();
    await s.distribute({ masterProductId: 'PM-0001', tenantIds: ['t1'] });
    const second = await s.distribute({ masterProductId: 'PM-0001', tenantIds: ['t1'] });
    expect(second.summary).toMatchObject({ total: 1, created: 0, alreadyDistributed: 1 });
    const dists = await s.list({ masterProductId: 'PM-0001' });
    expect(dists.filter((d) => d.tenantId === 't1')).toHaveLength(1); // exactly one distribution row
  });

  it('can force a new tenant product for a carrier when skipExisting is false', async () => {
    const res = await svc().distribute({ masterProductId: 'PM-0001', tenantIds: ['t2'], skipExisting: false });
    expect(res.summary).toMatchObject({ created: 1, skippedExisting: 0 });
  });
});
