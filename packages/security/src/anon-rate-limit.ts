// anon-rate-limit.ts — Security Deep Scan §28 / §43 / §44: the per-IP limit for PUBLIC (anonymous) routes.
//
// WHAT WAS MISSING. TenantRateLimitGuard keys on the salon and skips every request without a session — so the public
// surface (refresh, biometric / passkey sign-in, customer registration, display pairing and device calls, deals, the
// technician directory, OAuth token, …) had no budget at all unless a route had grown its own in-process counter.
//
// THE LIMIT. A route declares `@AnonRateLimit(max, windowMs)` (packages/security/src/nest/anon-rate-limit.guard.ts); each
// request is one hit against the key `<bucket>|<clientIp>` — the bucket is the route (or a shared name several routes
// pass), the address is clientIp(req): the trusted-proxy resolution, never a raw X-Forwarded-For. Over budget → 429
// RATE_LIMITED + Retry-After. Budgets are per route family and sized for a salon's devices behind ONE address (see the
// call sites), so they stop scripted abuse without touching a real front desk.
//
// STORE: Redis (one sorted set per key, shared across replicas) when RATE_LIMIT_REDIS_URL / REDIS_URL is set and
// RATE_LIMIT_STORE is not "memory"; else an in-process sliding log (exact for one instance). FAIL-OPEN: a store error
// admits the request. ANON_RATE_LIMIT=off turns every such limit off (an operator kill switch).

export interface AnonLimitDecision { allowed: boolean; retryAfterMs: number; count: number }
export interface AnonRateLimitStore {
  readonly kind: 'redis' | 'memory';
  hit(key: string, max: number, windowMs: number): Promise<AnonLimitDecision>;
}
export interface AnonRateLimitRedis {
  zadd(key: string, score: number, member: string): Promise<unknown> | unknown;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown> | unknown;
  zcard(key: string): Promise<number> | number;
  zrange?(key: string, start: number, stop: number, withScores?: 'WITHSCORES'): Promise<string[]> | string[];
  pexpire(key: string, ms: number): Promise<unknown> | unknown;
}
/** A string DI token (the same value however many copies of the package load). The API's RateLimitModule provides it. */
export const ANON_RATE_LIMIT_STORE = 'ANON_RATE_LIMIT_STORE';
export interface AnonRateLimitSpec { max: number; windowMs: number; bucket?: string }

/** In-process sliding log. Only admitted hits are recorded; idle keys are swept; memory is bounded. */
export class InMemoryAnonRateLimitStore implements AnonRateLimitStore {
  readonly kind = 'memory' as const;
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;
  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 50_000) {}
  async hit(key: string, max: number, windowMs: number): Promise<AnonLimitDecision> {
    const t = this.now(); const from = t - windowMs;
    if (++this.sinceSweep >= 1_000) this.sweep(t);
    let log = this.hits.get(key);
    if (!log) { if (this.hits.size >= this.maxKeys) this.hits.clear(); log = []; this.hits.set(key, log); }
    let drop = 0; while (drop < log.length && log[drop] <= from) drop++;
    if (drop) log.splice(0, drop);
    if (log.length >= max) return { allowed: false, retryAfterMs: Math.max(1, log[0] + windowMs - t), count: log.length };
    log.push(t);
    return { allowed: true, retryAfterMs: 0, count: log.length };
  }
  private sweep(t: number): void {
    this.sinceSweep = 0;
    for (const [k, log] of this.hits) if (!log.length || log[log.length - 1] <= t - 3_600_000) this.hits.delete(k);
  }
  size(): number { return this.hits.size; }
}

/** Redis sliding window (same technique as the tenant / keyed limiters). Fail-open on any Redis error. */
export class RedisAnonRateLimitStore implements AnonRateLimitStore {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: AnonRateLimitRedis, private readonly prefix = 'aps:ratelimit:anon:', private readonly now: () => number = Date.now) {}
  async hit(key: string, max: number, windowMs: number): Promise<AnonLimitDecision> {
    const k = this.prefix + key; const t = this.now();
    try {
      await this.redis.zremrangebyscore(k, 0, t - windowMs);
      const count = Number(await this.redis.zcard(k));
      if (count >= max) return { allowed: false, retryAfterMs: windowMs, count };
      await this.redis.zadd(k, t, `${t}:${Math.random().toString(36).slice(2, 10)}`);
      await this.redis.pexpire(k, windowMs);
      return { allowed: true, retryAfterMs: 0, count: count + 1 };
    } catch { return { allowed: true, retryAfterMs: 0, count: 0 }; }
  }
}

export function anonRateLimitEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.ANON_RATE_LIMIT ?? '').trim().toLowerCase() !== 'off';
}

/** The limiter key: bucket + client address (unknown addresses share one bucket — they cannot dodge the limit). */
export function anonRateLimitKey(bucket: string, ip: string | null | undefined): string {
  return `${bucket}|${(ip && String(ip).slice(0, 64)) || 'unknown'}`;
}

/** Human description of a spec, for the generated attack surface ("AnonRateLimit 30 / 1 min per IP"). */
export function describeAnonRateLimit(spec: AnonRateLimitSpec): string {
  const w = spec.windowMs % 3_600_000 === 0 ? `${spec.windowMs / 3_600_000} h` : spec.windowMs % 60_000 === 0 ? `${spec.windowMs / 60_000} min` : `${Math.round(spec.windowMs / 1000)} s`;
  return `AnonRateLimit ${spec.max} / ${w} per IP${spec.bucket ? ` (bucket ${spec.bucket})` : ''}`;
}
