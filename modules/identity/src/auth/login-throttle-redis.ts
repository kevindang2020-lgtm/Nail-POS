// login-throttle-redis.ts — a SHARED, cross-instance store for the login brute-force lockout, behind the same
// LoginThrottlePort the in-memory store implements (auth-login.service.ts). The in-memory store is per-process, so
// with multiple API nodes an attacker's failed attempts spread across nodes never accumulate to a lock. This keeps
// the failure timestamps in Redis so every node sees the same recent-failure history for a key.
//
// Storage: one sorted set per key — score = failure time (epoch ms), member = "<ts>:<rand>" (unique per failure).
// recentFailures prunes out-of-window entries (ZREMRANGEBYSCORE) and returns the in-window timestamps; recordFailure
// adds one and refreshes a TTL so idle keys self-expire; clear deletes the key. The pure lockout decision still lives
// in security.rateLimitDecision — this only supplies/records the timestamps it scores.
//
// Redis is abstracted behind ThrottleRedis so the store is unit-tested with an in-memory fake (two store instances
// sharing one fake = two API nodes) — no live Redis required. makeThrottleRedis() wires real ioredis.
import { InMemoryLoginThrottle, type LoginThrottlePort } from './auth-login.service';

export interface ThrottleRedis {
  zadd(key: string, score: number, member: string): Promise<unknown> | unknown;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> | string[];
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown> | unknown;
  pexpire(key: string, ms: number): Promise<unknown> | unknown;
  del(key: string): Promise<unknown> | unknown;
}

export class RedisLoginThrottle implements LoginThrottlePort {
  private readonly windowMs: number;
  private readonly prefix: string;
  constructor(private readonly redis: ThrottleRedis, opts: { windowMs?: number; prefix?: string } = {}) {
    this.windowMs = opts.windowMs ?? 15 * 60_000;
    this.prefix = opts.prefix ?? 'aps:login:throttle:';
  }
  private k(key: string): string { return this.prefix + key; }

  // BUILD_PLAN Phase 11 DR drill (redis-loss): a Redis outage used to turn every sign-in into a 500. The throttle is a
  // defence against credential stuffing, not the authentication itself — when its store is unreachable it fails OPEN
  // (no history, writes dropped) and says so once per minute, and the per-process IP limiter still applies.
  private lastWarn = 0;
  private failOpen(op: string, e: unknown): void {
    const now = Date.now();
    if (now - this.lastWarn > 60_000) { this.lastWarn = now; console.warn(`[login-throttle] redis ${op} failed — failing open: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }

  async recentFailures(key: string): Promise<number[]> {
    const rk = this.k(key);
    const cutoff = Date.now() - this.windowMs;
    try {
      await this.redis.zremrangebyscore(rk, 0, cutoff - 1);                 // drop attempts outside the window
      const members = await this.redis.zrangebyscore(rk, cutoff, '+inf');
      return (members || [])
        .map((m) => Number(String(m).split(':')[0]))
        .filter((n) => Number.isFinite(n));
    } catch (e) { this.failOpen('read', e); return []; }
  }

  async recordFailure(key: string): Promise<void> {
    const rk = this.k(key);
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;   // unique even if two failures share a ms
    try {
      await this.redis.zadd(rk, now, member);
      await this.redis.zremrangebyscore(rk, 0, now - this.windowMs - 1);
      await this.redis.pexpire(rk, this.windowMs);                          // idle keys self-expire (no manual GC)
    } catch (e) { this.failOpen('write', e); }
  }

  async clear(key: string): Promise<void> {
    try { await this.redis.del(this.k(key)); } catch (e) { this.failOpen('clear', e); }
  }
}

// Real ioredis client exposing exactly the ThrottleRedis surface. Only called when LOGIN_THROTTLE_STORE=redis and a
// URL is configured. ioredis is loaded lazily via the shared helper so non-Redis deployments never load it.
export function makeThrottleRedis(url: string): ThrottleRedis {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
  const client = makeIoredis(url, 'throttle');
  return {
    zadd: (key, score, member) => client.zadd(key, score, member),
    zrangebyscore: (key, min, max) => client.zrangebyscore(key, min as never, max as never),
    zremrangebyscore: (key, min, max) => client.zremrangebyscore(key, min as never, max as never),
    pexpire: (key, ms) => client.pexpire(key, ms),
    del: (key) => client.del(key),
  };
}

// Env selector for AuthModule: a shared Redis store when configured, else the per-process in-memory store (default).
export function makeLoginThrottle(): LoginThrottlePort {
  const url = process.env.LOGIN_THROTTLE_REDIS_URL || process.env.REDIS_URL;
  if ((process.env.LOGIN_THROTTLE_STORE || '').toLowerCase() === 'redis' && url) {
    return new RedisLoginThrottle(makeThrottleRedis(url), { prefix: process.env.LOGIN_THROTTLE_PREFIX || 'aps:login:throttle:' });
  }
  return new InMemoryLoginThrottle();
}
