import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';
import { generateSecret, totpCode } from './totp';

// RFC 6238 §5.2: a TOTP code must be single-use. These tests drive a real confirmed-factor login (totpSecret set) and
// assert that a valid code is accepted exactly once and rejected on replay within its validity window.
const PW = 'Sup3rSecret!';
const SECRET = generateSecret();

describe('LoginService — TOTP replay prevention', () => {
  let svc: LoginService;
  beforeAll(async () => {
    const hash = await hashPassword(PW);
    const seed: AuthSeed = {
      tenants: [{ id: 'tA', tenantCode: 'PALACE', status: 'active' }],
      users: [{ userId: 'uTotp', tenantId: 'tA', role: 'OWNER', branchId: 'bA1', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: null, email: 'totp@a.com', normalizedPhone: null, totpSecret: SECRET } as MemUser],
      subscriptions: [{ tenantId: 'tA', status: 'active' }],
      branches: [{ tenantId: 'tA' }],
    };
    svc = new LoginService(new InMemoryAuthUserRepository(seed));
  });
  const login = (mfaCode: string) => svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'totp@a.com', password: PW, mfaCode });

  it('accepts a valid code once, then rejects the SAME code (replay)', async () => {
    const code = totpCode(SECRET, Date.now());
    const first = await login(code);
    expect(first.outcome).toBe('SUCCESS');        // first presentation accepted
    const second = await login(code);
    expect(second.outcome).not.toBe('SUCCESS');    // identical code reused within the window -> rejected
  });

  it('rejects a wrong code outright', async () => {
    const r = await login('000000');
    expect(r.outcome).not.toBe('SUCCESS');
  });
});
