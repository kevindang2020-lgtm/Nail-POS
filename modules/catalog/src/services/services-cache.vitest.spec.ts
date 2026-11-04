// Verifies ServicesService caches the category list read-through and busts it on category writes (Roadmap Phase 2,
// "invalidate on write"). With a cache: repeated listCategories hits the repo once; after a create/update the cache
// is busted so the next read reflects the change. Without a cache: passthrough (always hits the repo).
import { describe, it, expect, vi } from 'vitest';
import { ServicesService } from './services.service';
import { InMemoryServicesRepository, type ServicesContext } from './services.repository';
import { RedisTenantCache, type CacheRedis } from '@aipowersalon/cache';

function fakeRedis(): CacheRedis {
  const store = new Map<string, string>();
  return {
    async get(k) { return store.has(k) ? store.get(k)! : null; },
    async set(k, v) { store.set(k, v); return 'OK'; },
    async del(...keys) { keys.forEach((k) => store.delete(k)); return keys.length; },
    async scan(_c, _m, pattern) {
      const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : '\\' + m)) + '$');
      return ['0', [...store.keys()].filter((k) => rx.test(k))];
    },
  };
}

const PERMS = ['pos.services.view', 'pos.services.edit'];
const owner = (over: Partial<ServicesContext> = {}): ServicesContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

describe('ServicesService — category list caching', () => {
  it('serves the category list from cache on repeat', async () => {
    const repo = new InMemoryServicesRepository();
    const spy = vi.spyOn(repo, 'listCategories');
    const svc = new ServicesService(repo, new RedisTenantCache(fakeRedis()));
    await svc.listCategories(owner());
    await svc.listCategories(owner());
    expect(spy).toHaveBeenCalledTimes(1); // second served from cache
  });

  it('busts the cache after createCategory so the next read reloads', async () => {
    const repo = new InMemoryServicesRepository();
    const spy = vi.spyOn(repo, 'listCategories');
    const svc = new ServicesService(repo, new RedisTenantCache(fakeRedis()));
    const before = await svc.listCategories(owner());
    await svc.createCategory(owner(), 'Waxing');           // write → bust
    const after = await svc.listCategories(owner());        // must reload, not serve stale
    // 1 cached read before + 1 uncached name-clash check inside createCategory (D3: never against a stale cache) + 1 reload
    expect(spy).toHaveBeenCalledTimes(3);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((c) => c.name === 'Waxing')).toBe(true);
  });

  it('two tenants keep independent category caches', async () => {
    const repo = new InMemoryServicesRepository();
    const svc = new ServicesService(repo, new RedisTenantCache(fakeRedis()));
    const a1 = await svc.listCategories(owner({ tenantId: 'luxe001' }));
    const b1 = await svc.listCategories(owner({ tenantId: 'other999' }));
    // different tenants: whatever their seed, tenant A's cache never serves tenant B
    expect(Array.isArray(a1)).toBe(true);
    expect(Array.isArray(b1)).toBe(true);
    await svc.createCategory(owner({ tenantId: 'luxe001' }), 'A-only');
    const b2 = await svc.listCategories(owner({ tenantId: 'other999' }));
    expect(b2.some((c) => c.name === 'A-only')).toBe(false); // A's write never leaks into B
  });

  it('without a cache, always reads through (passthrough)', async () => {
    const repo = new InMemoryServicesRepository();
    const spy = vi.spyOn(repo, 'listCategories');
    const svc = new ServicesService(repo); // no cache
    await svc.listCategories(owner());
    await svc.listCategories(owner());
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
