// keyed-rate-limit.ts — the pure keyed rate limiter (Constitution 12 §57; Constitution 13 §81): a decision per key per
// window, Redis-backed over an INJECTED client or a passthrough. The Nest guard is behind './nest'; the env-driven
// factories (which store, which URL) are the API's (common/keyed-rate-limit.ts).
// keyed-rate-limit.ts — Constitution 12 §58 (audit finding M3): rate limiting beyond "per tenant".
//
// TenantRateLimitGuard (Scaling Roadmap Phase 3) keys by tenant only, and is off by default. The login throttle keys
// by (portal, salon, identifier, ip) but stops at a correct PASSWORD — a second factor, once required, had no limit
// of its own. And nothing outside a salon session (a leaked API-style key) had any budget at all.
//
// This is the SAME sliding-window technique as tenant-rate-limit.ts and login-throttle-redis.ts (one Redis sorted
// set per key; score = attempt time; members pruned outside the window) generalised to an arbitrary key, so a new
// dimension is a new key prefix, not a new algorithm. Same invariants: OPT-IN (a no-op limiter unless Redis is
// configured — tests and single-node dev need nothing), FAIL-OPEN (a Redis error allows the request; a limiter
// outage must never take the platform down), and it never limits SUPER_ADMIN or a request with no key to bind to.
//
// APPLIED AT TWO CONCRETE SITES (below), not as a blanket policy — a limiter with no real site to protect is a
// module, not a fix:
//   • TOTP verification during login (auth-login.service.ts): a correct password no longer means the 6-digit second
//     factor can be guessed without limit. Keyed per userId; failures only count, since a fast typist should never
//     be limited by their own speed.
//   • The public AI-receptionist voice gateway (VoiceAuthGuard): the only surface today where an external caller
//     authenticates with a bearer credential instead of a session (§138–140's tenant_api_keys has no inbound
//     authentication path yet — nothing to key a limit on until one exists). Keyed per resolved voice-key id, so a
//     leaked key has a budget instead of an open account with the platform's AI providers.

export interface KeyedLimitDecision { allowed: boolean; remaining: number; retryAfterMs: number }
export interface KeyedRateLimiter {
  readonly enabled: boolean;
  /** Record ONE event against `key` and decide whether the budget still allows more. Use for the event that should
   *  count (e.g. one failed guess) — never call this merely to check status, or checking becomes an event itself. */
  hit(key: string): Promise<KeyedLimitDecision>;
  /** Read-only: is `key` currently over budget, with no side effect. Use to refuse BEFORE spending a guess. */
  isBlocked(key: string): Promise<boolean>;
}
export interface KeyedRateLimitRedis {
  zadd(key: string, score: number, member: string): Promise<unknown> | unknown;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown> | unknown;
  zcard(key: string): Promise<number> | number;
  pexpire(key: string, ms: number): Promise<unknown> | unknown;
}
export interface KeyedRateLimitOptions { windowMs?: number; max?: number; prefix?: string }

export class NoopKeyedRateLimiter implements KeyedRateLimiter {
  readonly enabled = false;
  async hit(): Promise<KeyedLimitDecision> { return { allowed: true, remaining: Infinity, retryAfterMs: 0 }; }
  async isBlocked(): Promise<boolean> { return false; }
}

export class RedisKeyedRateLimiter implements KeyedRateLimiter {
  readonly enabled = true;
  private readonly windowMs: number; private readonly max: number; private readonly prefix: string;
  constructor(private readonly redis: KeyedRateLimitRedis, opts: KeyedRateLimitOptions = {}) {
    this.windowMs = opts.windowMs ?? 60_000; this.max = opts.max ?? 30; this.prefix = opts.prefix ?? 'aps:ratelimit:keyed:';
  }
  async hit(key: string): Promise<KeyedLimitDecision> {
    const k = this.prefix + (key || '_none_'); const now = Date.now(); const windowStart = now - this.windowMs;
    try {
      await this.redis.zremrangebyscore(k, 0, windowStart - 1);
      const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
      await this.redis.zadd(k, now, member);
      await this.redis.pexpire(k, this.windowMs);
      const count = await this.redis.zcard(k);
      if (count > this.max) return { allowed: false, remaining: 0, retryAfterMs: this.windowMs };
      return { allowed: true, remaining: Math.max(0, this.max - count), retryAfterMs: 0 };
    } catch { return { allowed: true, remaining: Infinity, retryAfterMs: 0 }; }        // fail-open: never block on a limiter outage
  }
  async isBlocked(key: string): Promise<boolean> {
    const k = this.prefix + (key || '_none_');
    try {
      await this.redis.zremrangebyscore(k, 0, Date.now() - this.windowMs - 1);
      return (await this.redis.zcard(k)) >= this.max;
    } catch { return false; }                                                          // fail-open
  }
}

/** For MFA verification: 10 failed second-factor attempts per user per 15 minutes. Correct codes are never counted. */
export function mfaAttemptLimiter(redis: KeyedRateLimitRedis | null): KeyedRateLimiter {
  return redis ? new RedisKeyedRateLimiter(redis, { windowMs: 15 * 60_000, max: 10, prefix: 'aps:ratelimit:mfa:' }) : new NoopKeyedRateLimiter();
}
/** For the voice gateway: 120 requests per key per minute — generous for a live call, a real budget for a leaked key. */
export function voiceKeyLimiter(redis: KeyedRateLimitRedis | null): KeyedRateLimiter {
  return redis ? new RedisKeyedRateLimiter(redis, { windowMs: 60_000, max: 120, prefix: 'aps:ratelimit:voicekey:' }) : new NoopKeyedRateLimiter();
}


/** The DI token the API's RateLimitModule provides the MFA attempt limiter under (a string token: the same value
 *  however many copies of this package a process loads). Identity injects it; it never builds the limiter itself. */
export const MFA_ATTEMPT_LIMITER = 'MFA_ATTEMPT_LIMITER';
