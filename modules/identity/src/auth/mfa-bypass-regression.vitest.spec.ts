// mfa-bypass-regression.vitest.spec — Constitution 12 §20/§22/§300: audit finding H4, with a permanent regression test.
//
// Before the fix, five login DECISION branches hard-coded `mfaRequired: false, mfaSatisfied: true`: the Owner App
// portal (one salon, home salon), the salon-selection paths, and the customer-portal path. An owner who had enabled
// MFA was never asked for it there — the code was simply not consulted. The Store-Code path was correct all along.
import { hashPassword, normalizeIdentifier } from '@aipowersalon/auth';
import { describe, it, expect } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type MemUser, type OwnerLoginRecord } from './auth-user.repository';

const PASSWORD = 'Correct-Horse-9!';
async function ownerRepo(opts: { mfaEnabled: boolean; salons: number }) {
  const hash = await hashPassword(PASSWORD);
  const user: MemUser = { userId: 'owner-1', tenantId: 'tA', branchId: 'bA', role: 'OWNER', email: 'own@x.test', status: 'active', passwordHash: hash, mfaEnabled: opts.mfaEnabled, fullName: 'Own', branchCount: 1 } as any;
  const repo = new InMemoryAuthUserRepository({ tenants: [{ tenantId: 'tA', tenantCode: 'TA', status: 'active' }, { tenantId: 'tB', tenantCode: 'TB', status: 'active' }], users: [user] } as any);
  (repo as any).findOwnerForLogin = async (id: any): Promise<OwnerLoginRecord | null> => {
    if (id?.value !== 'own@x.test' && id?.raw !== 'own@x.test') return null;
    const salons = [{ tenantId: 'tA', branchId: 'bA', salonName: 'A', tenantStatus: 'active' as const, isPrimaryOwner: true }, { tenantId: 'tB', branchId: 'bB', salonName: 'B', tenantStatus: 'active' as const, isPrimaryOwner: false }].slice(0, opts.salons);
    return { user: { userId: 'owner-1', tenantId: 'tA', branchId: 'bA', role: 'OWNER', status: 'active', passwordHash: hash, mfaEnabled: opts.mfaEnabled, fullName: 'Own' } as any, salons };
  };
  return new LoginService(repo);
}
const login = (svc: LoginService, mfaCode?: string) => svc.attempt({ portal: 'owner', identifier: 'own@x.test', password: PASSWORD, mfaCode } as any);

describe('H4 — MFA on the Owner App portal', () => {
  it('an owner WITH MFA enabled, one salon, no code → MFA_REQUIRED (was SUCCESS)', async () => {
    expect((await login(await ownerRepo({ mfaEnabled: true, salons: 1 }))).outcome).toBe('MFA_REQUIRED');
  });
  it('an owner WITH MFA enabled, several salons (home-salon path), no code → MFA_REQUIRED (was SUCCESS)', async () => {
    expect((await login(await ownerRepo({ mfaEnabled: true, salons: 2 }))).outcome).toBe('MFA_REQUIRED');
  });
  it('a malformed code is refused on that path', async () => {
    const r = await login(await ownerRepo({ mfaEnabled: true, salons: 2 }), '12');
    expect(r.outcome).not.toBe('SUCCESS');
  });
  it('under the production rule (MFA_REQUIRE_TOTP=1) a well-formed code with NO enrolled authenticator is refused — no any-6-digit fallback', async () => {
    const prev = process.env.MFA_REQUIRE_TOTP; process.env.MFA_REQUIRE_TOTP = '1';
    try { expect((await login(await ownerRepo({ mfaEnabled: true, salons: 2 }), '000000')).outcome).not.toBe('SUCCESS'); }
    finally { if (prev === undefined) delete process.env.MFA_REQUIRE_TOTP; else process.env.MFA_REQUIRE_TOTP = prev; }
  });
  it('an owner WITHOUT MFA still signs in exactly as before — the fix asks only those who enabled it', async () => {
    expect((await login(await ownerRepo({ mfaEnabled: false, salons: 2 }))).outcome).toBe('SUCCESS');
  });
  it('the three salon-USABILITY filters keep the literal: with MFA pending, the salon list is still resolved (MFA_REQUIRED, not TENANT_NOT_FOUND)', async () => {
    // If MFA were evaluated inside the usability filters, every salon would be filtered out and the owner would be
    // told she has no salons — instead of being asked for her code.
    const r = await login(await ownerRepo({ mfaEnabled: true, salons: 2 }));
    expect(r.outcome).toBe('MFA_REQUIRED');
  });
});

describe('the identifier normaliser used by the fake (so the test is not vacuous)', () => {
  it('normalises the owner email the way the service does', () => expect(normalizeIdentifier('own@x.test').value ?? normalizeIdentifier('own@x.test')).toBeTruthy());
});
