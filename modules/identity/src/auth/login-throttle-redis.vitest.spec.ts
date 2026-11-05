import { rateLimitDecision, hashPassword } from '@aipowersalon/auth';
import { describe, it, expect, beforeAll } from 'vitest';
import { RedisLoginThrottle, type ThrottleRedis } from './login-throttle-redis';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';

// In-memory ZSET stand-in for the throttle's Redis surface. SHARED by multiple RedisLoginThrottle instances to
// simulate multiple API nodes hitting one Redis — proving the failure history is global, not per-process.
class FakeThrottleRedis implements ThrottleRedis {
  private z = new Map<string, Array<{ score: number; member: string }>>();
  zadd(key: string, score: number, member: string) { const a = this.z.get(key) || []; a.push({ score, member }); this.z.set(key, a); return 1; }
  zrangebyscore(key: string, min: number | string, max: number | string) {
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    return (this.z.get(key) || []).filter((e) => e.score >= lo && e.score <= hi).sort((a, b) => a.score - b.score).map((e) => e.member);
  }
  zremrangebyscore(key: string, min: number | string, max: number | string) {
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    this.z.set(key, (this.z.get(key) || []).filter((e) => !(e.score >= lo && e.score <= hi)));
    return 1;
  }
  pexpire() { return 1; }
  del(key: string) { this.z.delete(key); return 1; }
  seed(key: string, score: number) { this.zadd(key, score, `${score}:seed`); } // test helper
}

const KEY = 'tenant|PALACE|u@a.com|1.2.3.4';

describe('RedisLoginThrottle — shared sliding-window store', () => {
  it('shares failure history across instances (node B locks from node A failures)', async () => {
    const redis = new FakeThrottleRedis();
    const nodeA = new RedisLoginThrottle(redis);
    const nodeB = new RedisLoginThrottle(redis);
    for (let i = 0; i < 5; i++) await nodeA.recordFailure(KEY);
    const seenByB = await nodeB.recentFailures(KEY);
    expect(seenByB.length).toBe(5);
    expect(rateLimitDecision(seenByB, Date.now()).allowed).toBe(false); // node B would lock
  });

  it('prunes attempts outside the 15-minute window', async () => {
    const redis = new FakeThrottleRedis();
    const t = new RedisLoginThrottle(redis, { prefix: 'p:' });
    const now = Date.now();
    redis.seed('p:' + KEY, now - 20 * 60_000); // 20 min ago → outside window
    redis.seed('p:' + KEY, now - 60_000);      // 1 min ago → inside
    const recent = await t.recentFailures(KEY);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toBe(now - 60_000);
  });

  it('clear() removes the lock for every node', async () => {
    const redis = new FakeThrottleRedis();
    const nodeA = new RedisLoginThrottle(redis);
    const nodeB = new RedisLoginThrottle(redis);
    for (let i = 0; i < 5; i++) await nodeA.recordFailure(KEY);
    await nodeB.clear(KEY);
    expect(await nodeA.recentFailures(KEY)).toEqual([]);
  });
});

describe('LoginService + shared throttle across nodes', () => {
  const PW = 'Sup3rSecret!';
  let repo: InMemoryAuthUserRepository;
  beforeAll(async () => {
    const hash = await hashPassword(PW);
    const seed: AuthSeed = {
      tenants: [{ id: 'tA', tenantCode: 'PALACE', status: 'active' }],
      users: [{ userId: 'uA', tenantId: 'tA', role: 'OWNER', branchId: 'bA1', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null, email: 'u@a.com', normalizedPhone: null } as MemUser],
      subscriptions: [{ tenantId: 'tA', status: 'active' }],
      branches: [{ tenantId: 'tA' }],
    };
    repo = new InMemoryAuthUserRepository(seed);
  });
  const base = { portal: 'tenant' as const, salonCode: 'PALACE', identifier: 'u@a.com' };

  it('5 wrong attempts on node A lock even the correct password on node B', async () => {
    const redis = new FakeThrottleRedis();
    const svcA = new LoginService(repo, new RedisLoginThrottle(redis));
    const svcB = new LoginService(repo, new RedisLoginThrottle(redis));
    for (let i = 0; i < 5; i++) {
      const r = await svcA.attempt({ ...base, password: 'wrong', ip: '1.2.3.4' });
      expect(r.outcome).toBe('INVALID_CREDENTIALS');
    }
    const onB = await svcB.attempt({ ...base, password: PW, ip: '1.2.3.4' });
    expect(onB.outcome).toBe('RATE_LIMITED'); // node B honors the lock set by node A's failures (shared store)
  });
});

// Phase 11 DR drill (redis-loss): with LOGIN_THROTTLE_STORE=redis, POST /auth/login answered 500 while Redis was down,
// because every Redis error propagated out of the throttle. A throttle outage must never stop sign-in: the store fails
// OPEN (no recent failures; a record/clear that cannot be written is dropped) and says so once in the log.
describe('RedisLoginThrottle fails open when Redis is down', () => {
  const dead: ThrottleRedis = {
    zadd: async () => { throw new Error('ECONNREFUSED'); }, zrangebyscore: async () => { throw new Error('ECONNREFUSED'); },
    zremrangebyscore: async () => { throw new Error('ECONNREFUSED'); }, pexpire: async () => { throw new Error('ECONNREFUSED'); }, del: async () => { throw new Error('ECONNREFUSED'); },
  } as any;
  it('recentFailures returns [] instead of throwing', async () => {
    const t = new RedisLoginThrottle(dead);
    await expect(t.recentFailures('k')).resolves.toEqual([]);
  });
  it('recordFailure and clear resolve instead of throwing', async () => {
    const t = new RedisLoginThrottle(dead);
    await expect(t.recordFailure('k')).resolves.toBeUndefined();
    await expect(t.clear('k')).resolves.toBeUndefined();
  });
});
