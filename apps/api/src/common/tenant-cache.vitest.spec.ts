// Verifies the tenant-scoped read-through cache (Roadmap Phase 2). The properties that matter:
//  1. Passthrough (no Redis) runs the loader every time — dev/tests/single-node unaffected.
//  2. Read-through caches a miss and serves subsequent hits without re-running the loader.
//  3. TENANT ISOLATION: two tenants asking for the same logical key hit DIFFERENT physical keys — a cross-tenant
//     hit is impossible by construction. This is the security-critical property.
//  4. Fail-open: any Redis error falls back to the loader; a cache fault never fails or corrupts a request.
import { describe, it, expect, vi } from 'vitest';
import { RedisTenantCache, type CacheRedis } from '@aipowersalon/cache';
import { makeTenantCache } from './cache.module';

// A tiny in-memory fake of the narrow CacheRedis surface, capturing keys so we can assert isolation.
function fakeRedis() {
  const store = new Map<string, string>();
  const sets: string[] = [];
  const redis: CacheRedis = {
    async get(k) { return store.has(k) ? store.get(k)! : null; },
    async set(k, v) { store.set(k, v); sets.push(k); return 'OK'; },
    async del(...keys) { keys.forEach((k) => store.delete(k)); return keys.length; },
    async scan(_cursor, _m, pattern, _c, _n) {
      const rx = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : '\\' + m)) + '$');
      return ['0', [...store.keys()].filter((k) => rx.test(k))];
    },
  };
  return { redis, store, sets };
}

describe('tenant-cache — passthrough (default, no Redis)', () => {
  it('makeTenantCache returns a disabled passthrough when CACHE_STORE is not redis', () => {
    const c = makeTenantCache();
    expect(c.enabled).toBe(false);
  });

  it('passthrough runs the loader every call', async () => {
    const c = makeTenantCache();
    const loader = vi.fn(async () => 42);
    expect(await c.getOrSet({ tenantId: 't1' }, 'k', 30, loader)).toBe(42);
    expect(await c.getOrSet({ tenantId: 't1' }, 'k', 30, loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(2); // not memoized
  });
});

describe('tenant-cache — Redis read-through', () => {
  it('caches a miss then serves the hit without re-running the loader', async () => {
    const { redis } = fakeRedis();
    const c = new RedisTenantCache(redis);
    const loader = vi.fn(async () => ({ v: 1 }));
    const a = await c.getOrSet({ tenantId: 't1' }, 'dash', 30, loader);
    const b = await c.getOrSet({ tenantId: 't1' }, 'dash', 30, loader);
    expect(a).toEqual({ v: 1 });
    expect(b).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('ISOLATION: two tenants with the same logical key never collide', async () => {
    const { redis, sets } = fakeRedis();
    const c = new RedisTenantCache(redis);
    await c.getOrSet({ tenantId: 'tenantA' }, 'dashboard:state:{}', 30, async () => 'A-data');
    await c.getOrSet({ tenantId: 'tenantB' }, 'dashboard:state:{}', 30, async () => 'B-data');
    // distinct physical keys, each embedding its tenant id
    expect(sets.length).toBe(2);
    expect(sets[0]).not.toBe(sets[1]);
    expect(sets[0]).toContain('t=tenantA');
    expect(sets[1]).toContain('t=tenantB');
    // and a hit for A returns A-data, never B-data
    expect(await c.getOrSet({ tenantId: 'tenantA' }, 'dashboard:state:{}', 30, async () => 'should-not-run')).toBe('A-data');
  });

  it('branch is part of the key when present', async () => {
    const cap = fakeRedis();
    const c = new RedisTenantCache(cap.redis);
    await c.getOrSet({ tenantId: 't1', branchId: 'b9' }, 'k', 30, async () => 1);
    expect(cap.sets[0]).toContain('t=t1');
    expect(cap.sets[0]).toContain('b=b9');
  });

  it('invalidateTenant removes every key for that tenant only', async () => {
    const cap = fakeRedis();
    const c = new RedisTenantCache(cap.redis);
    await c.getOrSet({ tenantId: 't1' }, 'a', 30, async () => 1);
    await c.getOrSet({ tenantId: 't1' }, 'b', 30, async () => 2);
    await c.getOrSet({ tenantId: 't2' }, 'a', 30, async () => 3);
    await c.invalidateTenant({ tenantId: 't1' });
    // t1 entries gone, t2 survives
    expect(await c.getOrSet({ tenantId: 't2' }, 'a', 30, async () => 999)).toBe(3);
    const reran = vi.fn(async () => 111);
    await c.getOrSet({ tenantId: 't1' }, 'a', 30, reran);
    expect(reran).toHaveBeenCalledTimes(1); // had to reload — it was invalidated
  });

  it('FAIL-OPEN: a Redis get error falls back to the loader', async () => {
    const brokenRedis: CacheRedis = {
      get: async () => { throw new Error('redis down'); },
      set: async () => { throw new Error('redis down'); },
      del: async () => 0,
      scan: async () => ['0', []],
    };
    const c = new RedisTenantCache(brokenRedis);
    const loader = vi.fn(async () => 'from-db');
    expect(await c.getOrSet({ tenantId: 't1' }, 'k', 30, loader)).toBe('from-db');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('tenant-cache — stampede protection (single-flight)', () => {
  it('coalesces concurrent misses on the same key: loader runs ONCE for a burst', async () => {
    const { redis } = fakeRedis();
    const c = new RedisTenantCache(redis);
    let running = 0, maxConcurrent = 0;
    const loader = vi.fn(async () => {
      running++; maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 10));
      running--; return { v: 7 };
    });
    // 20 concurrent requests for the same (tenant, key) all miss at once.
    const results = await Promise.all(Array.from({ length: 20 }, () => c.getOrSet({ tenantId: 't1' }, 'hot', 30, loader)));
    expect(results.every((r) => (r as any).v === 7)).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);   // the herd collapsed to a single DB load
    expect(maxConcurrent).toBe(1);             // never two loaders in flight for the same key
  });

  it('does NOT coalesce across different keys or tenants', async () => {
    const { redis } = fakeRedis();
    const c = new RedisTenantCache(redis);
    const loader = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return 1; });
    await Promise.all([
      c.getOrSet({ tenantId: 't1' }, 'a', 30, loader),
      c.getOrSet({ tenantId: 't1' }, 'b', 30, loader),   // different key
      c.getOrSet({ tenantId: 't2' }, 'a', 30, loader),   // different tenant
    ]);
    expect(loader).toHaveBeenCalledTimes(3); // three distinct scoped keys → three loads
  });

  it('a failed loader rejects all waiters and does NOT poison the cache', async () => {
    const { redis, sets } = fakeRedis();
    const c = new RedisTenantCache(redis);
    const boom = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('db fail'); });
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => c.getOrSet({ tenantId: 't1' }, 'k', 30, boom)));
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(boom).toHaveBeenCalledTimes(1);   // still coalesced
    expect(sets).toHaveLength(0);            // nothing cached — no poisoning
    // a subsequent call re-attempts (the in-flight entry was cleared)
    const ok = vi.fn(async () => 5);
    expect(await c.getOrSet({ tenantId: 't1' }, 'k', 30, ok)).toBe(5);
  });

  it('passthrough (no Redis) also coalesces a concurrent burst', async () => {
    const c = makeTenantCache(); // NoopTenantCache
    const loader = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return 3; });
    await Promise.all(Array.from({ length: 8 }, () => c.getOrSet({ tenantId: 't1' }, 'k', 30, loader)));
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
