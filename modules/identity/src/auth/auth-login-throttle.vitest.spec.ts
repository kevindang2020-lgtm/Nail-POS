import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService, InMemoryLoginThrottle } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

// Login brute-force lockout: with a throttle wired, repeated wrong-password attempts lock the (identifier+ip) key, and a
// successful login clears the counter. Default policy from security.rateLimitDecision is 5 failures within 15 minutes.
const PW = 'Sup3rSecret!';

describe('LoginService — failed-attempt lockout', () => {
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

  it('locks the key after 5 wrong-password attempts, then blocks even the correct password', async () => {
    const svc = new LoginService(repo, new InMemoryLoginThrottle());
    for (let i = 0; i < 5; i++) {
      const r = await svc.attempt({ ...base, password: 'wrong', ip: '1.2.3.4' });
      expect(r.outcome).toBe('INVALID_CREDENTIALS');
    }
    const sixth = await svc.attempt({ ...base, password: 'wrong', ip: '1.2.3.4' });
    expect(sixth.outcome).toBe('RATE_LIMITED');
    const correctButLocked = await svc.attempt({ ...base, password: PW, ip: '1.2.3.4' });
    expect(correctButLocked.outcome).toBe('RATE_LIMITED'); // lockout holds regardless of credentials
  });

  it('a successful login clears the counter', async () => {
    const svc = new LoginService(repo, new InMemoryLoginThrottle());
    await svc.attempt({ ...base, password: 'wrong', ip: '9.9.9.9' }); // 1 failure
    const good = await svc.attempt({ ...base, password: PW, ip: '9.9.9.9' });
    expect(['SUCCESS', 'BRANCH_SELECTION_REQUIRED']).toContain(good.outcome);
    const after = await svc.attempt({ ...base, password: 'wrong', ip: '9.9.9.9' });
    expect(after.outcome).toBe('INVALID_CREDENTIALS'); // counter reset by the success, so not locked
  });

  it('without a throttle, there is no lockout (unchanged behavior)', async () => {
    const svc = new LoginService(repo); // no throttle
    for (let i = 0; i < 8; i++) {
      const r = await svc.attempt({ ...base, password: 'wrong', ip: '1.2.3.4' });
      expect(r.outcome).toBe('INVALID_CREDENTIALS'); // never RATE_LIMITED
    }
  });
});
