// cache-redis.ts — cross-instance CachePort backed by Redis, mirroring login-throttle-redis. The namespace version
// counter lives in Redis (INCR), so an invalidate on one node is immediately visible to every node; data keys embed the
// current version and carry a PX TTL so stale-version entries self-expire. Redis is abstracted behind CacheRedis so the
// implementation is unit-tested with an in-memory fake (two CacheStore instances sharing one fake = two API nodes) —
// no live Redis required. makeCacheRedis() wires real ioredis.
import type { CachePort } from './cache-port';

export interface CacheRedis {
  get(key: string): Promise<string | null> | string | null;
  setpx(key: string, value: string, ttlMs: number): Promise<unknown> | unknown;
  incr(key: string): Promise<number> | number;
}

export class RedisCache implements CachePort {
  private readonly prefix: string;
  constructor(private readonly redis: CacheRedis, opts: { prefix?: string } = {}) { this.prefix = opts.prefix ?? 'aps:cache:'; }
  private verKey(ns: string): string { return `${this.prefix}ver:${ns}`; }
  private async ver(ns: string): Promise<string> { return (await this.redis.get(this.verKey(ns))) ?? '0'; }
  private dataKey(ns: string, ver: string, key: string): string { return `${this.prefix}${ns}#v${ver}#${key}`; }

  async get(ns: string, key: string): Promise<string | null> {
    const ver = await this.ver(ns);
    return (await this.redis.get(this.dataKey(ns, ver, key))) ?? null;
  }
  async set(ns: string, key: string, value: string, ttlMs: number): Promise<void> {
    const ver = await this.ver(ns);
    await this.redis.setpx(this.dataKey(ns, ver, key), value, ttlMs);
  }
  async invalidate(ns: string): Promise<void> { await this.redis.incr(this.verKey(ns)); }
}

// In-memory fake of the CacheRedis primitives — used by tests to simulate ONE shared Redis behind multiple nodes.
export class FakeCacheRedis implements CacheRedis {
  private m = new Map<string, string>();
  get(key: string) { return this.m.has(key) ? (this.m.get(key) as string) : null; }
  setpx(key: string, value: string) { this.m.set(key, value); }   // TTL not simulated (tests assert version semantics)
  incr(key: string) { const n = Number(this.m.get(key) ?? '0') + 1; this.m.set(key, String(n)); return n; }
}

/** Wire a real ioredis client into the CacheRedis port. Call only when REDIS_URL is set. */
export function makeCacheRedis(client: { get: (k: string) => Promise<string | null>; set: (...a: any[]) => Promise<unknown>; incr: (k: string) => Promise<number> }): CacheRedis {
  return {
    get: (k) => client.get(k),
    setpx: (k, v, ms) => client.set(k, v, 'PX', ms),
    incr: (k) => client.incr(k),
  };
}
