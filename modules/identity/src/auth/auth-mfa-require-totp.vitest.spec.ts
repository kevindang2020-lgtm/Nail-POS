import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

// A user whose role requires MFA but who has NOT enrolled a real TOTP factor. With the production flag the bare
// 6-digit fallback must be refused (they have to enroll); without it, dev/local stays permissive for easy testing.
const PW = 'Sup3rSecret!';
let repo: InMemoryAuthUserRepository;
let svc: LoginService;

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({
    branchId: null, status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null, email: null, normalizedPhone: null, ...o,
  });
  const seed: AuthSeed = {
    tenants: [{ id: 'tA', tenantCode: 'PALACE', status: 'active' }],
    users: [mk({ userId: 'uMfa', tenantId: 'tA', role: 'OWNER', email: 'mfa@a.com', branchId: 'bA1', mfaEnabled: true })],
    subscriptions: [{ tenantId: 'tA', status: 'active' }],
    branches: [{ tenantId: 'tA' }],
  };
  repo = new InMemoryAuthUserRepository(seed);
  svc = new LoginService(repo);
});

afterEach(() => { delete process.env.MFA_REQUIRE_TOTP; });

const attempt = (mfaCode?: string) => svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'mfa@a.com', password: PW, mfaCode });

describe('MFA fallback gating (MFA_REQUIRE_TOTP)', () => {
  it('dev/local default: an MFA user with no enrolled factor passes with any well-formed 6-digit code', async () => {
    delete process.env.MFA_REQUIRE_TOTP;
    const r = await attempt('123456');
    expect(r.outcome).toBe('SUCCESS');
  });

  it('production flag on: the same user is refused (must enroll a real authenticator)', async () => {
    process.env.MFA_REQUIRE_TOTP = '1';
    const r = await attempt('123456');
    expect(r.outcome).toBe('MFA_REQUIRED');
    expect(r.principal).toBeUndefined();
  });

  it('a malformed code is rejected regardless of the flag', async () => {
    delete process.env.MFA_REQUIRE_TOTP;
    const r = await attempt('12');
    expect(r.outcome).toBe('MFA_REQUIRED');
  });
});
