// cache.vitest.spec.ts — the cache seam. InMemoryCache TTL + namespace-versioned invalidation, and RedisCache proving
// cross-instance behaviour: two RedisCache instances sharing ONE fake Redis (= two API nodes) — a write on one node is
// read on the other, and an invalidate on one node is seen by the other.
import { describe, it, expect } from 'vitest';
import { InMemoryCache } from './cache-port';
import { RedisCache, FakeCacheRedis } from './cache-redis';

describe('InMemoryCache', () => {
  it('stores + returns a value, and misses after TTL', async () => {
    const c = new InMemoryCache();
    await c.set('ns', 'k', 'v1', 10_000);
    expect(await c.get('ns', 'k')).toBe('v1');
    await c.set('ns', 'k2', 'v2', -1);           // already expired
    expect(await c.get('ns', 'k2')).toBeNull();
  });
  it('invalidate(namespace) drops all keys under it', async () => {
    const c = new InMemoryCache();
    await c.set('t1', 'a', '1', 10_000);
    await c.set('t1', 'b', '2', 10_000);
    await c.set('t2', 'a', '9', 10_000);
    await c.invalidate('t1');
    expect(await c.get('t1', 'a')).toBeNull();
    expect(await c.get('t1', 'b')).toBeNull();
    expect(await c.get('t2', 'a')).toBe('9');     // other namespace untouched
  });
});

describe('RedisCache cross-instance (two nodes, one shared Redis)', () => {
  it('a write on node A is visible on node B', async () => {
    const shared = new FakeCacheRedis();
    const nodeA = new RedisCache(shared);
    const nodeB = new RedisCache(shared);
    await nodeA.set('copilot:ten_1', '', JSON.stringify({ confirmBeforeSend: true }), 30_000);
    expect(JSON.parse((await nodeB.get('copilot:ten_1', ''))!)).toEqual({ confirmBeforeSend: true });
  });
  it('an invalidate on node A is seen by node B (stale read cleared)', async () => {
    const shared = new FakeCacheRedis();
    const nodeA = new RedisCache(shared);
    const nodeB = new RedisCache(shared);
    await nodeA.set('copilot:ten_1', '', 'old', 30_000);
    expect(await nodeB.get('copilot:ten_1', '')).toBe('old');
    await nodeA.invalidate('copilot:ten_1');       // e.g. settings patched on node A
    expect(await nodeB.get('copilot:ten_1', '')).toBeNull();
  });
});
