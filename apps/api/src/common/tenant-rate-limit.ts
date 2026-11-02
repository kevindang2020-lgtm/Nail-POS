// tenant-rate-limit.ts — per-tenant API rate limiting (Scaling Roadmap Phase 3; ON by default since BUILD_PLAN Phase 11).
//
// Protects against the noisy-neighbor problem: one busy or misbehaving salon must not exhaust shared capacity and
// degrade every other tenant. Sliding window per key — one Redis sorted set per key across API nodes when Redis is
// configured, an in-process sliding log otherwise.
//
// Design invariants:
//   • ON BY DEFAULT (Constitution 4 §12, Phase 11). TENANT_RATE_LIMIT=off turns it off (and the older
//     TENANT_RATE_LIMIT_GUARD_DISABLED=true still does). Store: Redis when RATE_LIMIT_REDIS_URL || REDIS_URL is set
//     (shared across replicas), else in-memory (per process — exact for one instance, per-instance with several, which
//     is why production-config requires REDIS_URL when the API runs more than one process). RATE_LIMIT_STORE=memory
//     forces the in-memory store.
//   • FAIL-OPEN: any Redis error allows the request. A rate-limiter outage must never take the API down; the worst
//     case is that limiting is temporarily not enforced, never that good traffic is rejected.
//   • KEYED PER LOCATION: the guard keys on tenant + branch, so a ten-location group gets ten locations' budget and a
//     single location's runaway client cannot starve the group's other locations or any other salon.
//   • THE BUDGET IS SIZED FROM THE POS's OWN LOAD, not guessed: tenant-rate-limit.vitest.spec.ts derives a busy
//     location's request rate from the platform's refresh cadences (SYNC_POLICY, display / kiosk heartbeats, tech
//     messaging polls, realtime fan-out) and asserts the default leaves ≥ 2× headroom over it. The old 600/min/tenant
//     default was below that model for one busy location — turning it on unchanged would have 429'd real checkouts.

//   • TWO BUDGETS (M4 200-technician scale, Oct 24 2026). The location budget used to be the only one (3,000 / min). A
//     200-technician location's steady peak is ~10,000 / min (the spec's load model, read from the apps' own cadences:
//     200 Tech Apps × a 15 s safety sync of 3 reads + throttled realtime re-reads, 6 POS desks, 3 managers, displays) —
//     the old default 429'd it, and it let ONE runaway client spend the location's whole 3,000. Now:
//       – per CLIENT (one signed-in session — a POS desk, one technician's phone): 2,000 / min. The busiest single device
//         (a POS desk at a 200-technician peak) models at ~310 / min (6× headroom, room for a desk's bursts — opening the
//         board, paging 17 technician pages); a runaway or scripted client is cut at 2,000 instead of being able to
//         spend the whole location budget (3,000 before M4) alone.
//       – per LOCATION: 24,000 / min, 2.4× the 200-technician model (10,030 / min). A small salon cannot get near it: it is bounded
//         by its own number of signed-in devices × 2,000 first. It remains the noisy-neighbour ceiling for the platform.
//     RATE_LIMIT_MAX_PER_TENANT / RATE_LIMIT_MAX_PER_CLIENT override either; RATE_LIMIT_WINDOW_MS applies to both.

/** Default window budget per location: 24,000 requests / 60 s (400 rps). See the load model in the spec (2.4× a 200-technician peak). */
export const DEFAULT_RATE_LIMIT_MAX = 24_000;
/** Default window budget per client (one signed-in session) inside a location: 2,000 requests / 60 s. */
export const DEFAULT_CLIENT_RATE_LIMIT_MAX = 2_000;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimitDecision { allowed: boolean; remaining: number; limit: number; retryAfterMs: number }

export interface TenantRateLimiter {
  /** Record one request for `tenantId` and decide whether it's within the per-window budget. */
  hit(tenantId: string): Promise<RateLimitDecision>;
  readonly enabled: boolean;
}

// The narrow Redis surface this needs (same shape family as the login throttle), so it unit-tests with a fake.
export interface RateLimitRedis {
  zadd(key: string, score: number, member: string): Promise<unknown> | unknown;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown> | unknown;
  zcard(key: string): Promise<number> | number;
  pexpire(key: string, ms: number): Promise<unknown> | unknown;
}

export interface RateLimitOptions { windowMs?: number; max?: number; prefix?: string }

// Always-allow limiter (TENANT_RATE_LIMIT=off). No Redis, no library load.
class NoopRateLimiter implements TenantRateLimiter {
  readonly enabled = false;
  async hit(): Promise<RateLimitDecision> { return { allowed: true, remaining: Infinity, limit: Infinity, retryAfterMs: 0 }; }
}

export class RedisTenantRateLimiter implements TenantRateLimiter {
  readonly enabled = true;
  private readonly windowMs: number;
  private readonly max: number;
  private readonly prefix: string;
  constructor(private readonly redis: RateLimitRedis, opts: RateLimitOptions = {}) {
    this.windowMs = opts.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.max = opts.max ?? DEFAULT_RATE_LIMIT_MAX;
    this.prefix = opts.prefix ?? 'aps:ratelimit:tenant:';
  }
  private k(tenantId: string): string { return this.prefix + (tenantId || '_notenant_'); }

  async hit(tenantId: string): Promise<RateLimitDecision> {
    const key = this.k(tenantId);
    const now = Date.now();
    const windowStart = now - this.windowMs;
    try {
      await this.redis.zremrangebyscore(key, 0, windowStart - 1);            // drop out-of-window hits
      const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;    // unique even within one ms
      await this.redis.zadd(key, now, member);
      await this.redis.pexpire(key, this.windowMs);                          // idle keys self-expire
      const count = await this.redis.zcard(key);
      const allowed = count <= this.max;
      return {
        allowed,
        remaining: Math.max(0, this.max - count),
        limit: this.max,
        retryAfterMs: allowed ? 0 : this.windowMs,
      };
    } catch {
      // FAIL-OPEN: never reject good traffic because the limiter is unavailable.
      return { allowed: true, remaining: this.max, limit: this.max, retryAfterMs: 0 };
    }
  }
}

/**
 * In-process sliding log (the default when no Redis is configured). Only ALLOWED hits are recorded, so a client that
 * backs off after a 429 gets back in as soon as its oldest counted request leaves the window; memory is bounded by
 * `max` timestamps per active key, and idle keys are dropped.
 */
export class InMemoryTenantRateLimiter implements TenantRateLimiter {
  readonly enabled = true;
  private readonly windowMs: number;
  private readonly max: number;
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;
  constructor(opts: RateLimitOptions = {}, private readonly now: () => number = Date.now) {
    this.windowMs = opts.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.max = opts.max ?? DEFAULT_RATE_LIMIT_MAX;
  }
  async hit(key: string): Promise<RateLimitDecision> {
    const now = this.now();
    const from = now - this.windowMs;
    if (++this.sinceSweep >= 1_000) this.sweep(from);
    const k = key || '_notenant_';
    let log = this.hits.get(k);
    if (!log) { log = []; this.hits.set(k, log); }
    let drop = 0; while (drop < log.length && log[drop] <= from) drop++;
    if (drop) log.splice(0, drop);
    if (log.length >= this.max) {
      return { allowed: false, remaining: 0, limit: this.max, retryAfterMs: Math.max(1, log[0] + this.windowMs - now) };
    }
    log.push(now);
    return { allowed: true, remaining: this.max - log.length, limit: this.max, retryAfterMs: 0 };
  }
  /** Drop keys with nothing left in the window (bounded memory with many salons). */
  private sweep(from: number): void {
    this.sinceSweep = 0;
    for (const [k, log] of this.hits) if (!log.length || log[log.length - 1] <= from) this.hits.delete(k);
  }
  /** For tests / System Ops: how many keys are tracked. */
  size(): number { return this.hits.size; }
}

/** Is the per-tenant limiter on? ON unless TENANT_RATE_LIMIT=off (or the older TENANT_RATE_LIMIT_GUARD_DISABLED=true). */
export function tenantRateLimitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.TENANT_RATE_LIMIT ?? '').trim().toLowerCase() === 'off') return false;
  if (String(env.TENANT_RATE_LIMIT_GUARD_DISABLED ?? '').trim().toLowerCase() === 'true') return false;
  return true;
}

export function rateLimitOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  return { windowMs: Number(env.RATE_LIMIT_WINDOW_MS) || undefined, max: Number(env.RATE_LIMIT_MAX_PER_TENANT) || undefined };
}

export function clientRateLimitOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  return { windowMs: Number(env.RATE_LIMIT_WINDOW_MS) || undefined, max: Number(env.RATE_LIMIT_MAX_PER_CLIENT) || DEFAULT_CLIENT_RATE_LIMIT_MAX, prefix: 'aps:ratelimit:client:' };
}

function makeLimiter(env: NodeJS.ProcessEnv, opts: RateLimitOptions): TenantRateLimiter {
  if (!tenantRateLimitEnabled(env)) return new NoopRateLimiter();
  const url = env.RATE_LIMIT_REDIS_URL || env.REDIS_URL;
  if (url && (env.RATE_LIMIT_STORE || '').toLowerCase() !== 'memory') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
    return new RedisTenantRateLimiter(makeIoredis(url, 'ratelimit') as unknown as RateLimitRedis, opts);
  }
  return new InMemoryTenantRateLimiter(opts);
}

// Env selector, mirroring makeLoginThrottle / makeTenantCache.
export function makeTenantRateLimiter(env: NodeJS.ProcessEnv = process.env): TenantRateLimiter {
  return makeLimiter(env, rateLimitOptionsFromEnv(env));
}

/** The per-client limiter (one budget per signed-in session inside a location). Same store selection as the location one. */
export function makeClientRateLimiter(env: NodeJS.ProcessEnv = process.env): TenantRateLimiter {
  return makeLimiter(env, clientRateLimitOptionsFromEnv(env));
}

/** The guard's key: one budget per salon LOCATION (tenant + branch); a request with no branch shares the tenant's '*'. */
export function rateLimitKey(tenantId: string, branchId?: string | null): string {
  return `${tenantId}:${branchId || '*'}`;
}

/** The per-client key: one budget per signed-in session (its sid; the user id when a principal has no session id) at a
 *  location. A request with no client identity is counted against the location budget only. */
export function rateLimitClientKey(tenantId: string, branchId: string | null | undefined, client: string): string {
  return `${tenantId}:${branchId || '*'}:${client}`;
}

/** What System Operations shows about the limiter (no URLs, no secrets). */
export function rateLimiterDescription(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; store: 'redis' | 'memory' | 'off'; maxPerWindow: number; maxPerClient: number; windowMs: number; keyedBy: 'location' } {
  const opts = rateLimitOptionsFromEnv(env);
  const enabled = tenantRateLimitEnabled(env);
  const redis = !!(env.RATE_LIMIT_REDIS_URL || env.REDIS_URL) && (env.RATE_LIMIT_STORE || '').toLowerCase() !== 'memory';
  return { enabled, store: !enabled ? 'off' : redis ? 'redis' : 'memory', maxPerWindow: opts.max ?? DEFAULT_RATE_LIMIT_MAX, maxPerClient: clientRateLimitOptionsFromEnv(env).max ?? DEFAULT_CLIENT_RATE_LIMIT_MAX, windowMs: opts.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS, keyedBy: 'location' };
}
