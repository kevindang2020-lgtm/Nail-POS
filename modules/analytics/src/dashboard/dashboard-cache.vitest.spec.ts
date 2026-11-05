// Verifies DashboardService integrates the read-through cache: with a cache, the underlying aggregate is computed once
// and served from cache on repeat; without a cache, it always computes (passthrough). Also confirms two tenants never
// share a cached aggregate.
import { describe, it, expect, vi } from 'vitest';
import { DashboardService, type TenantContext } from './dashboard.service';
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

const tc = (tenantId: string): TenantContext => ({ tenantId, branchId: null, userId: 'u1', role: 'OWNER', permissions: [] });

// Minimal repo stub counting getAggregate calls.
function countingRepo() {
  const calls: string[] = [];
  return {
    calls,
    repo: { getAggregate: vi.fn(async (scope: any) => { calls.push(scope.tenantId); return { tenantId: scope.tenantId } as any; }) },
  };
}

describe('DashboardService — read-through cache', () => {
  it('computes the aggregate once and serves the cache on repeat', async () => {
    const { repo } = countingRepo();
    const svc = new DashboardService(repo as any, new RedisTenantCache(fakeRedis()));
    await svc.getState(tc('t1'));
    await svc.getState(tc('t1'));
    expect(repo.getAggregate).toHaveBeenCalledTimes(1); // second call cached
  });

  it('without a cache, always computes (passthrough)', async () => {
    const { repo } = countingRepo();
    const svc = new DashboardService(repo as any); // no cache
    await svc.getState(tc('t1'));
    await svc.getState(tc('t1'));
    expect(repo.getAggregate).toHaveBeenCalledTimes(2);
  });

  it('two tenants never share a cached aggregate', async () => {
    const { repo, calls } = countingRepo();
    const svc = new DashboardService(repo as any, new RedisTenantCache(fakeRedis()));
    await svc.getState(tc('tenantA'));
    await svc.getState(tc('tenantB'));
    await svc.getState(tc('tenantA')); // cached
    expect(repo.getAggregate).toHaveBeenCalledTimes(2); // once per distinct tenant
    expect(calls).toEqual(['tenantA', 'tenantB']);
  });
});
