// live-ops-branch-scope.vitest.spec — Live Operations 27-inch mandate (Oct 28 2026) §24: the Multi-Location Snapshot is
// limited to the branches the person may see (request authz.branchIds), and that set is part of the cache key — two
// people at the same branch with different branch grants never share a cached snapshot.
import { describe, it, expect, vi } from 'vitest';
import { DashboardService, type TenantContext } from './dashboard.service';
import { RedisTenantCache, type CacheRedis } from '@aipowersalon/cache';

function fakeRedis(): CacheRedis {
  const store = new Map<string, string>();
  return { async get(k) { return store.get(k) ?? null; }, async set(k, v) { store.set(k, v); return 'OK'; }, async del(...k) { k.forEach((x) => store.delete(x)); return k.length; }, async scan() { return ['0', [...store.keys()]]; } };
}
const tc = (branchIds: string[] | null): TenantContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [], branchIds });

describe('Live Operations — branch-scoped multi-location (§24)', () => {
  it('the repository receives the visible-branch set', async () => {
    const repo = { getAggregate: vi.fn(async (scope: any) => ({ scope }) as any) };
    await new DashboardService(repo as any).getState(tc(['b1', 'b2']));
    expect(repo.getAggregate.mock.calls[0][0]).toMatchObject({ tenantId: 't1', branchId: 'b1', branchIds: ['b1', 'b2'] });
  });
  it('different branch grants → different cache entries; the same grants share one', async () => {
    const repo = { getAggregate: vi.fn(async () => ({}) as any) };
    const svc = new DashboardService(repo as any, new RedisTenantCache(fakeRedis()));
    await svc.getState(tc(['b1'])); await svc.getState(tc(['b1', 'b2'])); await svc.getState(tc(['b2', 'b1'])); await svc.getState(tc(null));
    expect(repo.getAggregate).toHaveBeenCalledTimes(3);
  });
});
