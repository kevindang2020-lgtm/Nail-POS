// keyed-rate-limit.vitest.spec — Constitution 12 §58 (finding M3): TOTP guesses and a voice key each have a budget.
import { describe, it, expect } from 'vitest';
import { RedisKeyedRateLimiter, NoopKeyedRateLimiter, mfaAttemptLimiter, voiceKeyLimiter, type KeyedRateLimitRedis } from '@aipowersalon/security';
import { VoiceKeyRateLimitGuard } from '@aipowersalon/security/nest';

function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const redis: KeyedRateLimitRedis = {
    zadd(key, score, member) { const m = sets.get(key) ?? new Map(); m.set(member, score); sets.set(key, m); return 1; },
    zremrangebyscore(key, min, max) {
      const m = sets.get(key); if (!m) return 0;
      const lo = Number(min), hi = max === '+inf' ? Infinity : Number(max);
      for (const [mem, sc] of m) if (sc >= lo && sc <= hi) m.delete(mem);
      return 0;
    },
    zcard(key) { return sets.get(key)?.size ?? 0; },
    pexpire() { return 1; },
  };
  return redis;
}

describe('RedisKeyedRateLimiter — the sliding window itself', () => {
  it('allows up to max, then blocks; a different key has its own budget', async () => {
    const lim = new RedisKeyedRateLimiter(fakeRedis(), { windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) expect((await lim.hit('u1')).allowed).toBe(true);
    expect((await lim.hit('u1')).allowed).toBe(false);
    expect((await lim.hit('u2')).allowed).toBe(true);
  });
  it('isBlocked is read-only: checking status never itself counts as an event', async () => {
    const lim = new RedisKeyedRateLimiter(fakeRedis(), { windowMs: 60_000, max: 1 });
    expect(await lim.isBlocked('u1')).toBe(false); expect(await lim.isBlocked('u1')).toBe(false); expect(await lim.isBlocked('u1')).toBe(false);
    expect((await lim.hit('u1')).allowed).toBe(true);            // the budget is untouched by the three checks above
    expect(await lim.isBlocked('u1')).toBe(true);
  });
  it('fails open on a Redis error — both hit() and isBlocked()', async () => {
    const down: KeyedRateLimitRedis = { zadd() { throw new Error('down'); }, zremrangebyscore() { throw new Error('down'); }, zcard() { throw new Error('down'); }, pexpire() { throw new Error('down'); } };
    const lim = new RedisKeyedRateLimiter(down, { max: 1 });
    expect((await lim.hit('u1')).allowed).toBe(true); expect((await lim.hit('u1')).allowed).toBe(true);
    expect(await lim.isBlocked('u1')).toBe(false);
  });
});

describe('the sliding window actually SLIDES — old entries expire, they are not kept forever', () => {
  it('an entry outside the window is pruned before counting, so the budget frees up over time', async () => {
    const redis = fakeRedis();
    const lim = new RedisKeyedRateLimiter(redis, { windowMs: 60_000, max: 2 });
    // Plant two hits, one of them already OUTSIDE the window (as if it happened long ago) — without pruning, the
    // fake never forgets anything, so a limiter that skipped zremrangebyscore would count it and wrongly block.
    await redis.zadd('aps:ratelimit:keyed:u1', Date.now() - 10 * 60_000, 'ancient');
    expect((await lim.hit('u1')).allowed).toBe(true);    // 1 fresh hit + the ancient one pruned away = under budget
    expect((await lim.hit('u1')).allowed).toBe(true);    // 2 fresh hits, still exactly at budget
    expect((await lim.hit('u1')).allowed).toBe(false);   // the THIRD fresh hit is what actually exceeds it
  });
  it('isBlocked also prunes before reading — a stale entry does not linger and falsely block', async () => {
    const redis = fakeRedis();
    const lim = new RedisKeyedRateLimiter(redis, { windowMs: 60_000, max: 1 });
    await redis.zadd('aps:ratelimit:keyed:u1', Date.now() - 10 * 60_000, 'ancient');
    expect(await lim.isBlocked('u1')).toBe(false);
  });
});

describe('NoopKeyedRateLimiter (default — no Redis configured)', () => {
  it('is disabled and always allows, never blocks', async () => {
    const n = new NoopKeyedRateLimiter();
    expect(n.enabled).toBe(false); expect((await n.hit('x')).allowed).toBe(true); expect(await n.isBlocked('x')).toBe(false);
  });
});

describe('§58 factories — the real budgets', () => {
  it('mfaAttemptLimiter: 10 per 15 minutes, keyed per user', async () => {
    const lim = mfaAttemptLimiter(fakeRedis());
    for (let i = 0; i < 10; i++) { expect(await lim.isBlocked('user-1')).toBe(false); await lim.hit('user-1'); }
    expect(await lim.isBlocked('user-1')).toBe(true);
    expect(await lim.isBlocked('user-2')).toBe(false);           // a different account is unaffected
  });
  it('voiceKeyLimiter: 120 per minute, keyed per key id', async () => {
    const lim = voiceKeyLimiter(fakeRedis());
    for (let i = 0; i < 120; i++) expect((await lim.hit('key-1')).allowed).toBe(true);
    expect((await lim.hit('key-1')).allowed).toBe(false);
  });
  it('with no Redis, both factories return a no-op', () => {
    expect(mfaAttemptLimiter(null).enabled).toBe(false); expect(voiceKeyLimiter(null).enabled).toBe(false);
  });
});

describe('VoiceKeyRateLimitGuard', () => {
  const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: () => undefined }) }) }) as any;
  it('passes through when the limiter is disabled (no Redis) or no key was resolved', async () => {
    expect(await new VoiceKeyRateLimitGuard(new NoopKeyedRateLimiter()).canActivate(ctx({}))).toBe(true);
    expect(await new VoiceKeyRateLimitGuard(voiceKeyLimiter(fakeRedis())).canActivate(ctx({}))).toBe(true);   // no voiceKeyId — VoiceAuthGuard already refused
  });
  it('throws 429 once the resolved key exceeds its budget; a different key is unaffected', async () => {
    const guard = new VoiceKeyRateLimitGuard(voiceKeyLimiter(fakeRedis()));
    for (let i = 0; i < 120; i++) expect(await guard.canActivate(ctx({ voiceKeyId: 'k1' }))).toBe(true);
    await expect(guard.canActivate(ctx({ voiceKeyId: 'k1' }))).rejects.toMatchObject({ status: 429 });
    expect(await guard.canActivate(ctx({ voiceKeyId: 'k2' }))).toBe(true);
  });
});
