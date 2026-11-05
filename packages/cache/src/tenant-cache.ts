// tenant-cache.ts — tenant-scoped read-through cache (Scaling Roadmap Phase 2).
//
// SECURITY INVARIANT (non-negotiable): every cache key embeds the tenant id (and branch where relevant). A cache
// entry written for tenant A must be physically unreachable by tenant B — a cross-tenant cache hit would be a
// data-isolation breach, so `getOrSet` derives the key prefix from the request Ctx and callers cannot bypass it.
//
// Opt-in, exactly like the realtime bus and login throttle: enabled only when CACHE_STORE=redis and a URL is set
// (CACHE_REDIS_URL || REDIS_URL). Otherwise this is a transparent passthrough that just calls the loader — so dev,
// tests, and single-node deployments are unaffected and never load ioredis. Redis errors NEVER surface to the caller:
// on any failure the loader runs and the result is returned uncached (fail-open to correctness, never to staleness).

export interface CacheCtx { tenantId: string; branchId?: string }

export interface TenantCache {
  /** Read-through: return the cached value for (tenant, key) or run `loader`, cache it for `ttlSeconds`, and return it. */
  getOrSet<T>(ctx: CacheCtx, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
  /** Invalidate one (tenant, key). Call after a write that changes what `key` would return. */
  invalidate(ctx: CacheCtx, key: string): Promise<void>;
  /** Invalidate every cached entry for a tenant (coarse bust-on-write). */
  invalidateTenant(ctx: CacheCtx): Promise<void>;
  readonly enabled: boolean;
}

const PREFIX = process.env.CACHE_PREFIX || 'aps:cache:';

// tenant_id (and branch) are ALWAYS part of the key — this is the isolation guarantee, not an option.
function scopedKey(ctx: CacheCtx, key: string): string {
  const tenant = ctx.tenantId || '_notenant_';
  const branch = ctx.branchId ? `:b=${ctx.branchId}` : '';
  return `${PREFIX}t=${tenant}${branch}:${key}`;
}
function tenantPattern(ctx: CacheCtx): string {
  return `${PREFIX}t=${ctx.tenantId || '_notenant_'}*`;
}

// ---- stampede protection: in-process single-flight ----------------------------------------------------------------
// When a hot key expires, many concurrent requests would otherwise all miss and hammer PostgreSQL at once (a
// thundering herd). single-flight coalesces concurrent calls for the SAME scoped key within one process: the first
// caller runs the loader; the rest await that same in-flight promise and share its result. This is bounded (the map
// entry is deleted as soon as the promise settles), never poisons the cache (a rejected loader rejects all waiters
// without caching), and needs no Redis round-trip. Across processes, the short TTL plus per-process coalescing keeps
// origin load low without a distributed lock's complexity/failure modes.
class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = (async () => fn())().finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p as Promise<T>;
  }
}

// Passthrough implementation — no Redis. getOrSet just runs the loader; invalidation is a no-op. This is the default.
// It still single-flights, so even without Redis a burst of identical requests collapses to one loader call.
export class NoopTenantCache implements TenantCache {
  readonly enabled = false;
  private readonly sf = new SingleFlight();
  async getOrSet<T>(ctx: CacheCtx, key: string, _ttl: number, loader: () => Promise<T>): Promise<T> {
    return this.sf.run(scopedKey(ctx, key), loader);
  }
  async invalidate(): Promise<void> { /* no-op */ }
  async invalidateTenant(): Promise<void> { /* no-op */ }
}

// Minimal ioredis surface this cache needs (kept narrow so it's trivially testable with a fake).
export interface CacheRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(cursor: string, matchToken: 'MATCH', pattern: string, countToken: 'COUNT', count: number): Promise<[string, string[]]>;
}

export class RedisTenantCache implements TenantCache {
  readonly enabled = true;
  private readonly sf = new SingleFlight();
  constructor(private readonly redis: CacheRedis) {}

  async getOrSet<T>(ctx: CacheCtx, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const k = scopedKey(ctx, key);
    try {
      const hit = await this.redis.get(k);
      if (hit != null) return JSON.parse(hit) as T;
    } catch { /* fall through to loader; a cache read failure must never fail the request */ }
    // Cache miss: coalesce concurrent rebuilds of the same key so only one loader runs (stampede protection).
    return this.sf.run(k, async () => {
      // Double-check the cache inside the single-flight window: an earlier coalesced caller may have just populated it.
      try {
        const hit2 = await this.redis.get(k);
        if (hit2 != null) return JSON.parse(hit2) as T;
      } catch { /* ignore; proceed to loader */ }
      const value = await loader();
      try {
        // Only cache defined values; never cache undefined (a miss shouldn't be memoized as a hit).
        if (value !== undefined) await this.redis.set(k, JSON.stringify(value), 'EX', Math.max(1, Math.trunc(ttlSeconds)));
      } catch { /* best-effort write; correctness already guaranteed by returning `value` */ }
      return value;
    });
  }

  async invalidate(ctx: CacheCtx, key: string): Promise<void> {
    try { await this.redis.del(scopedKey(ctx, key)); } catch { /* best-effort */ }
  }

  async invalidateTenant(ctx: CacheCtx): Promise<void> {
    try {
      const pattern = tenantPattern(ctx);
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch { /* best-effort */ }
  }
}

/** The DI token the API's CacheModule provides a TenantCache under. A plain string (like PROVIDER_SECRETS), so the
 *  token is the same value however many copies of this package a process loads. */
export const TENANT_CACHE = 'TENANT_CACHE';
