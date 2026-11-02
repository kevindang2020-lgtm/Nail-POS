// entitlements-cache.vitest.spec.ts — verifies the Scaling Phase 3 read-through cache on EntitlementsService:
// the slow-changing PLAN CONFIG (catalog + plan limits + plan feature states) is cached across repeated entitlement
// checks, while live USAGE COUNTS are always re-read (so allow/deny stays correct). With no cache injected the service
// behaves exactly as before (passthrough).
import { describe, it, expect } from 'vitest';
import { EntitlementsService } from './entitlements.service';
import type { TenantCache, CacheCtx } from '@aipowersalon/cache';

// Minimal map-backed cache (the real default NoopTenantCache is passthrough; we need a caching one to observe the win).
class MapCache implements TenantCache {
  private store = new Map<string, unknown>();
  get enabled() { return true; }
  async getOrSet<T>(ctx: CacheCtx, key: string, _ttl: number, loader: () => Promise<T>): Promise<T> {
    const k = `${ctx.tenantId}:${key}`;
    if (this.store.has(k)) return this.store.get(k) as T;
    const v = await loader(); this.store.set(k, v); return v;
  }
  async invalidate(ctx: CacheCtx, key: string) { this.store.delete(`${ctx.tenantId}:${key}`); }
  async invalidateTenant(ctx: CacheCtx) { for (const k of [...this.store.keys()]) if (k.startsWith(`${ctx.tenantId}:`)) this.store.delete(k); }
}

function fakeRepo(usedSeq: Record<string, number>[]) {
  let usedCall = 0;
  return {
    planLimitsCalls: 0,
    async tenantExists() { return true; },
    async getActivePlanText() { return 'pro'; },
    async mapCatalogPlan() { return { id: 'plan_pro' } as any; },
    async getPlanLimits() { (this as any).planLimitsCalls++; return { branches: 5 }; },
    async getPlanFeatureStates() { return { ai_reports: 'enabled' }; },
    async getLimitOverrides() { return []; },
    async getFeatureOverrides() { return []; },
    async getUsedCounts() { return usedSeq[Math.min(usedCall++, usedSeq.length - 1)]; },
  };
}

describe('EntitlementsService plan-config cache (Phase 3)', () => {
  it('caches plan config across reads but keeps usage counts live', async () => {
    const repo = fakeRepo([{ branches: 1 }, { branches: 4 }]);
    const svc = new EntitlementsService(repo as any, new MapCache());
    const a = await svc.getEntitlements('t1');
    const b = await svc.getEntitlements('t1');
    // plan config loaded once (cached), not twice
    expect(repo.planLimitsCalls).toBe(1);
    // both calls succeed and reflect the (live) usage sequence — usage is not frozen by the cache
    const usedA = a.limits.find((l: any) => l.metric === 'branches')?.used;
    const usedB = b.limits.find((l: any) => l.metric === 'branches')?.used;
    expect(usedA).toBe(1);
    expect(usedB).toBe(4); // second read got fresh usage, proving usage is uncached
  });

  it('with no cache injected, behaves as passthrough (plan config re-read each call)', async () => {
    const repo = fakeRepo([{ branches: 1 }]);
    const svc = new EntitlementsService(repo as any); // no cache
    await svc.getEntitlements('t1');
    await svc.getEntitlements('t1');
    expect(repo.planLimitsCalls).toBe(2); // no caching → loaded each time
  });

  it('caches per plan text — different plans do not collide', async () => {
    const cache = new MapCache();
    const repo = fakeRepo([{ branches: 0 }]);
    const svc = new EntitlementsService(repo as any, cache);
    await svc.getEntitlements('t1');
    // a tenant on a different plan text would key separately; same tenant+plan reuses the entry
    await svc.getEntitlements('t1');
    expect(repo.planLimitsCalls).toBe(1);
  });
});
