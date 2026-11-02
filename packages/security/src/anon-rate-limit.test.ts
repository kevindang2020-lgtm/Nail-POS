// anon-rate-limit.test.ts — Security Deep Scan §28 / §43 / §44: the per-IP store behind @AnonRateLimit (fixed clock).
import { describe, it, expect } from 'vitest';
import { InMemoryAnonRateLimitStore, RedisAnonRateLimitStore, anonRateLimitEnabled, anonRateLimitKey, describeAnonRateLimit } from './anon-rate-limit';
import { anonLoopbackExempt } from './nest/anon-rate-limit.guard';

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);

describe('InMemoryAnonRateLimitStore', () => {
  it('admits max per window per key, refuses the next with a Retry-After to the oldest hit leaving, then admits again', async () => {
    let t = T0; const s = new InMemoryAnonRateLimitStore(() => t);
    for (let i = 0; i < 3; i++) { expect((await s.hit('k|1.2.3.4', 3, 60_000)).allowed).toBe(true); t += 1_000; }
    const refused = await s.hit('k|1.2.3.4', 3, 60_000);
    expect(refused.allowed).toBe(false); expect(refused.retryAfterMs).toBe(57_000);
    expect((await s.hit('k|5.6.7.8', 3, 60_000)).allowed).toBe(true);           // another address has its own budget
    t = T0 + 60_001;
    expect((await s.hit('k|1.2.3.4', 3, 60_000)).allowed).toBe(true);
  });
  it('a refused hit is not recorded (a client that backs off gets back in)', async () => {
    let t = T0; const s = new InMemoryAnonRateLimitStore(() => t);
    await s.hit('k', 1, 10_000);
    for (let i = 0; i < 5; i++) expect((await s.hit('k', 1, 10_000)).allowed).toBe(false);
    t += 10_001; expect((await s.hit('k', 1, 10_000)).allowed).toBe(true);
  });
});

describe('RedisAnonRateLimitStore', () => {
  const fakeRedis = () => {
    const z = new Map<string, Array<[number, string]>>();
    return {
      z,
      zadd: (k: string, sc: number, m: string) => { (z.get(k) ?? z.set(k, []).get(k)!).push([sc, m]); },
      zremrangebyscore: (k: string, min: number, max: number) => { z.set(k, (z.get(k) ?? []).filter(([sc]) => sc < Number(min) || sc > Number(max))); },
      zcard: (k: string) => (z.get(k) ?? []).length,
      pexpire: () => 1,
    };
  };
  it('the same sliding window over a sorted set, shared across replicas', async () => {
    let t = T0; const r = fakeRedis();
    const a = new RedisAnonRateLimitStore(r, 'p:', () => t), b = new RedisAnonRateLimitStore(r, 'p:', () => t);
    expect((await a.hit('x', 2, 60_000)).allowed).toBe(true);
    expect((await b.hit('x', 2, 60_000)).allowed).toBe(true);                     // second replica, same budget
    expect((await a.hit('x', 2, 60_000)).allowed).toBe(false);
    t += 60_001; expect((await b.hit('x', 2, 60_000)).allowed).toBe(true);
  });
  it('FAIL-OPEN on a Redis error', async () => {
    const broken = { zadd: () => { throw new Error('down'); }, zremrangebyscore: () => { throw new Error('down'); }, zcard: () => 0, pexpire: () => 0 };
    expect((await new RedisAnonRateLimitStore(broken).hit('x', 1, 1_000)).allowed).toBe(true);
  });
});

describe('keys, switches, descriptions', () => {
  it('keys on bucket + address; unknown addresses share one bucket', () => {
    expect(anonRateLimitKey('auth-refresh', '203.0.113.9')).toBe('auth-refresh|203.0.113.9');
    expect(anonRateLimitKey('auth-refresh', null)).toBe('auth-refresh|unknown');
  });
  it('ANON_RATE_LIMIT=off is the kill switch; anything else is on', () => {
    expect(anonRateLimitEnabled({})).toBe(true);
    expect(anonRateLimitEnabled({ ANON_RATE_LIMIT: 'OFF' })).toBe(false);
  });
  it('loopback is exempt only outside production', () => {
    expect(anonLoopbackExempt('127.0.0.1', { NODE_ENV: 'development' })).toBe(true);
    expect(anonLoopbackExempt('::1', { NODE_ENV: 'test' })).toBe(true);
    expect(anonLoopbackExempt('127.0.0.1', { NODE_ENV: 'production' })).toBe(false);
    expect(anonLoopbackExempt('203.0.113.9', { NODE_ENV: 'development' })).toBe(false);
  });
  it('describes a spec for the attack surface', () => {
    expect(describeAnonRateLimit({ max: 600, windowMs: 5 * 60_000, bucket: 'auth-refresh' })).toBe('AnonRateLimit 600 / 5 min per IP (bucket auth-refresh)');
    expect(describeAnonRateLimit({ max: 20, windowMs: 3_600_000 })).toBe('AnonRateLimit 20 / 1 h per IP');
  });
});
