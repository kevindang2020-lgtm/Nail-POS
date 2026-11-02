// Verifies OverviewService reads the aggregate through the cache (Roadmap Phase 2). Because every slice endpoint
// projects from the same aggregate, one cached aggregate serves getState + all slices within the TTL. Also confirms
// tenant isolation and passthrough with no cache. The realtime board (OverviewBoardService) is separate and uncached.
import { describe, it, expect, vi } from 'vitest';
import { OverviewService, type TenantContext } from './overview.service';
import { RedisTenantCache, type CacheRedis } from '@aipowersalon/cache';

function fakeRedis(): CacheRedis {
  const store = new Map<string, string>();
  return {
    async get(k) { return store.has(k) ? store.get(k)! : null; },
    async set(k, v) { store.set(k, v); return 'OK'; },
    async del(...keys) { keys.forEach((k) => store.delete(k)); return keys.length; },
    async scan() { return ['0', [...store.keys()]]; },
  };
}

const tc = (tenantId: string): TenantContext => ({ tenantId, branchId: 'br1', userId: 'u1', role: 'OWNER', permissions: ['pos.overview.view'] });

function countingRepo() {
  const repo = { getAggregate: vi.fn(async (scope: any) => ({ tenantId: scope.tenantId, analytics: { revenueTrend: [], topServices: [], topTechnicians: [] } } as any)) };
  return repo;
}

describe('OverviewService — read-through cache', () => {
  it('computes the aggregate once and serves getState + a slice from cache', async () => {
    const repo = countingRepo();
    const svc = new OverviewService(repo as any, new RedisTenantCache(fakeRedis()));
    await svc.getState(tc('t1'));
    await svc.getRevenueTrend(tc('t1')); // projects the same aggregate
    expect(repo.getAggregate).toHaveBeenCalledTimes(1); // second served from cache
  });

  it('without a cache, always computes (passthrough)', async () => {
    const repo = countingRepo();
    const svc = new OverviewService(repo as any);
    await svc.getState(tc('t1'));
    await svc.getState(tc('t1'));
    expect(repo.getAggregate).toHaveBeenCalledTimes(2);
  });

  it('two tenants never share a cached aggregate', async () => {
    const repo = countingRepo();
    const svc = new OverviewService(repo as any, new RedisTenantCache(fakeRedis()));
    await svc.getState(tc('tenantA'));
    await svc.getState(tc('tenantB'));
    await svc.getState(tc('tenantA')); // cached
    expect(repo.getAggregate).toHaveBeenCalledTimes(2); // once per distinct tenant
  });
});
