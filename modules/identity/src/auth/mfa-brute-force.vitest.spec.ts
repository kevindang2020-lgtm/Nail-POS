// mfa-brute-force.vitest.spec — Constitution 12 §58 (finding M3): a correct password is not enough to brute-force TOTP.
import { describe, it, expect } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';
import { RedisKeyedRateLimiter, type KeyedRateLimitRedis } from '@aipowersalon/security';
import { totpCode } from './totp';

const PASSWORD = 'Correct-Horse-9!';
function fakeRedis(): KeyedRateLimitRedis {
  const sets = new Map<string, Map<string, number>>();
  return {
    zadd(key, score, member) { const m = sets.get(key) ?? new Map(); m.set(member, score); sets.set(key, m); return 1; },
    zremrangebyscore(key, min, max) { const m = sets.get(key); if (!m) return 0; const lo = Number(min), hi = max === '+inf' ? Infinity : Number(max); for (const [mem, sc] of m) if (sc >= lo && sc <= hi) m.delete(mem); return 0; },
    zcard(key) { return sets.get(key)?.size ?? 0; },
    pexpire() { return 1; },
  };
}
async function svcWithMfaOwner() {
  const hash = await hashPassword(PASSWORD);
  const user: MemUser = { userId: 'owner-1', tenantId: 'tA', branchId: 'bA', role: 'OWNER', email: 'own@brute.test', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: 'Own', totpSecret: 'JBSWY3DPEHPK3PXP' } as any;
  const repo = new InMemoryAuthUserRepository({ tenants: [{ tenantId: 'tA', tenantCode: 'TA', status: 'active' }], users: [user] } as any);
  (repo as any).findOwnerForLogin = async (id: any) => (id?.value === 'own@brute.test' || id?.raw === 'own@brute.test')
    ? { user: { userId: 'owner-1', tenantId: 'tA', branchId: 'bA', role: 'OWNER', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: 'Own', totpSecret: 'JBSWY3DPEHPK3PXP' }, salons: [{ tenantId: 'tA', branchId: 'bA', salonName: 'A', tenantStatus: 'active' as const, isPrimaryOwner: true }] }
    : null;
  return { repo, limiter: new RedisKeyedRateLimiter(fakeRedis(), { windowMs: 15 * 60_000, max: 10, prefix: 'test:mfa:' }) };
}
const login = (svc: LoginService, code: string) => svc.attempt({ portal: 'owner', identifier: 'own@brute.test', password: PASSWORD, mfaCode: code } as any);

describe('§58 TOTP guesses during login are budgeted', () => {
  it('after 10 wrong codes, even the ACTUAL correct code is refused — proving the block, not just another wrong guess', async () => {
    const { repo, limiter } = await svcWithMfaOwner();
    const svc = new LoginService(repo, undefined, undefined, undefined, limiter);
    for (let i = 0; i < 10; i++) { const r = await login(svc, '000000'); expect(r.outcome).toBe('MFA_REQUIRED'); }
    // Without the lockout, THIS would be SUCCESS — it is the real code for the real secret at the real time. A test
    // that used another wrong code here could not tell "locked out" from "just another bad guess"; this can.
    const r = await login(svc, totpCode('JBSWY3DPEHPK3PXP', Date.now()));
    expect(r.outcome).toBe('MFA_REQUIRED');
  });
  it('a correct code succeeds and never counts against the budget', async () => {
    const { repo, limiter } = await svcWithMfaOwner();
    const svc = new LoginService(repo, undefined, undefined, undefined, limiter);
    const r = await login(svc, totpCode('JBSWY3DPEHPK3PXP', Date.now()));
    expect(r.outcome).toBe('SUCCESS');
    expect(await limiter.isBlocked('owner-1')).toBe(false);   // the success spent no budget
  });
  it('with a budget of exactly 1, a single SUCCESSFUL login still leaves the budget untouched', async () => {
    // max:10 above cannot tell "successes are (wrongly) recorded too" from "they are not" — one hit out of ten looks
    // the same either way. A budget of 1 makes the very first success decisive: if it were recorded, isBlocked()
    // would flip true immediately after.
    const { repo } = await svcWithMfaOwner();
    const tight = new RedisKeyedRateLimiter(fakeRedis(), { windowMs: 15 * 60_000, max: 1, prefix: 'test:tight:' });
    const svc = new LoginService(repo, undefined, undefined, undefined, tight);
    const r = await login(svc, totpCode('JBSWY3DPEHPK3PXP', Date.now()));
    expect(r.outcome).toBe('SUCCESS');
    expect(await tight.isBlocked('owner-1')).toBe(false);
  });

  it('without a limiter wired (the old behaviour), unlimited guesses are still refused individually but never locked out', async () => {
    const { repo } = await svcWithMfaOwner();
    const svc = new LoginService(repo);   // no mfaLimiter arg — exactly the pre-fix constructor shape
    for (let i = 0; i < 15; i++) expect((await login(svc, '000000')).outcome).toBe('MFA_REQUIRED');
  });
  it('lockout is per USER — a different account is unaffected by one account\'s guesses', async () => {
    const { repo, limiter } = await svcWithMfaOwner();
    for (let i = 0; i < 10; i++) await limiter.hit('owner-1');
    expect(await limiter.isBlocked('owner-1')).toBe(true);
    expect(await limiter.isBlocked('someone-else')).toBe(false);
  });
});
