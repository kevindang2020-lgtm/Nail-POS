// owner-portal-login.vitest.spec.ts — the Owner App sign-in.
//
// ── Why this portal exists ──
//
// The Owner App used to require a **Store Code**. An owner with three salons has three codes — so asking for one
// means asking *"which of your businesses do you want to be pinned to?"*, which is precisely the question the
// portfolio exists to answer. And if she typed the wrong one, she landed in the wrong salon.
//
// So she signs in with the credentials she actually has — **email or phone + password** — and the session opens at
// her **primary salon**, with the whole portfolio available to switch through.
//
// ── The security line ──
//
// The lookup is role-filtered **in the SQL** (`where u.role = 'OWNER'`), so a manager, technician or customer is
// invisible to it. Even with correct credentials there is nothing for the Owner App login to find.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';
import type { OwnerLoginRecord, LoginUserRecord } from './auth-user.repository';

const PW = 'Owner-Passphrase-1!';
const T_LUXE = '11111111-1111-1111-1111-111111111111';
const T_BELLE = '22222222-2222-2222-2222-222222222222';

let hash: string;
beforeAll(async () => { hash = await hashPassword(PW); });

const owner = (over: Partial<LoginUserRecord> = {}): LoginUserRecord => ({
  userId: 'sophia', tenantId: T_LUXE, branchId: null, role: 'OWNER', status: 'active',
  passwordHash: hash, mfaEnabled: false, fullName: 'Sophia Nguyen',
  email: 'sophia@example.com', normalizedPhone: '+18565551234', ...over,
} as any);

const salon = (tenantId: string, name: string, over: any = {}) => ({
  tenantId, branchId: `b-${name}`, salonName: name, tenantStatus: 'active',
  subscriptionStatus: 'active', isPrimaryOwner: false, ...over,
});

/** A repo whose owner lookup honours the SQL's role filter. */
function repo(record: OwnerLoginRecord | null) {
  return {
    async findOwnerForLogin() {
      // mirrors `where u.role = 'OWNER'` — a non-owner can never come back from this query
      if (record && String((record.user as any).role).toUpperCase() !== 'OWNER') return null;
      return record;
    },
    async findTenantUserForLogin() { return { tenantFound: false, branchCount: 0 } as any; },
    async findSuperAdminForLogin() { return {}; },
    async markTotpStepUsed() { return true; },
  } as any;
}

const svc = (r: OwnerLoginRecord | null) => new LoginService(repo(r));
const login = (s: LoginService, identifier = 'sophia@example.com', password = PW) =>
  s.attempt({ portal: 'owner', identifier, password });

describe('NO Store Code — she signs in with what she actually has', () => {
  it('signs in by EMAIL, with no salonCode supplied at all', async () => {
    const r = await login(svc({ user: owner(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] }));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.role).toBe('OWNER');
  });

  it('signs in by PHONE, in any format', async () => {
    const s = svc({ user: owner(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] });
    for (const typed of ['(856) 555-1234', '856-555-1234', '+18565551234']) {
      expect((await login(s, typed)).outcome, typed).toBe('SUCCESS');
    }
  });

  it('the session opens at her PRIMARY salon — not an arbitrary one', async () => {
    const r = await login(svc({
      user: owner(),
      // the repository orders primary first; the service takes the first usable one
      salons: [salon(T_BELLE, 'Belle', { isPrimaryOwner: true }), salon(T_LUXE, 'Luxe')],
    }));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T_BELLE);
  });
});

describe('STAFF CANNOT SIGN IN THROUGH THE OWNER APP', () => {
  it('a MANAGER with correct credentials is refused', async () => {
    const r = await login(svc({ user: owner({ role: 'MANAGER' } as any), salons: [salon(T_LUXE, 'Luxe')] }));
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
    expect(r.message).not.toMatch(/manager|staff|wrong app/i);   // and it does not explain why
  });

  it('a TECHNICIAN, RECEPTION and CUSTOMER are all refused', async () => {
    for (const role of ['TECHNICIAN', 'RECEPTION', 'FRONT_DESK', 'CUSTOMER']) {
      const r = await login(svc({ user: owner({ role } as any), salons: [salon(T_LUXE, 'Luxe')] }));
      expect(r.outcome, `${role} must not be able to sign in`).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('safe failures', () => {
  it('an unknown owner and a wrong password are INDISTINGUISHABLE', async () => {
    const unknown = await login(svc(null));
    const wrongPw = await login(svc({ user: owner(), salons: [salon(T_LUXE, 'Luxe')] }), 'sophia@example.com', 'nope');

    expect(unknown.outcome).toBe(wrongPw.outcome);
    expect(unknown.message).toBe(wrongPw.message);
    expect(unknown.message).not.toMatch(/no account|not found|unknown/i);
  });

  it('a FAILED login returns no salon data at all', async () => {
    const r = await login(svc({ user: owner(), salons: [salon(T_LUXE, 'Luxe')] }), 'sophia@example.com', 'nope');
    const dump = JSON.stringify(r);
    expect(dump).not.toContain(T_LUXE);
    expect(dump).not.toContain('Luxe');
  });
});

describe('account and salon state still apply', () => {
  it('a DISABLED owner cannot sign in', async () => {
    const r = await login(svc({ user: owner({ status: 'disabled' as any }), salons: [salon(T_LUXE, 'Luxe')] }));
    expect(r.outcome).toBe('USER_DISABLED');
  });

  it('a SUSPENDED salon does not block her from the others', async () => {
    const r = await login(svc({
      user: owner(),
      salons: [salon(T_LUXE, 'Luxe', { tenantStatus: 'suspended', isPrimaryOwner: true }), salon(T_BELLE, 'Belle')],
    }));
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.tenantId).toBe(T_BELLE);      // opens at the one that works
  });

  it('when EVERY salon is suspended it says so — it does NOT report a wrong password', async () => {
    const r = await login(svc({
      user: owner(),
      salons: [salon(T_LUXE, 'Luxe', { tenantStatus: 'suspended' })],
    }));
    expect(r.outcome).toBe('TENANT_SUSPENDED');
    // Reporting INVALID_CREDENTIALS would have her retyping a password that is correct.
    expect(r.outcome).not.toBe('INVALID_CREDENTIALS');
  });
});

// The Owner Access Code is an OPTIONAL second factor. These cover the login-time ENFORCEMENT (the provisioning side —
// setting/hashing/removing the code — is covered in owner/owner-access-code.vitest.spec.ts). Behaviour under test:
// enforced only when the owner has one configured; a wrong or missing code is indistinguishable from a bad password.
describe('OWNER ACCESS CODE — second factor, enforced server-side, only when configured', () => {
  const CODE = 'VAULT-77';
  let codeHash: string;
  beforeAll(async () => { codeHash = await hashPassword(CODE); });
  const withCode = () => owner({ accessCodeHash: codeHash } as any);
  const attempt = (s: LoginService, over: any = {}) =>
    s.attempt({ portal: 'owner', identifier: 'sophia@example.com', password: PW, ...over });

  it('accepts the CORRECT code and opens the session', async () => {
    const r = await attempt(svc({ user: withCode(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] }), { ownerAccessCode: CODE });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.role).toBe('OWNER');
  });

  it('rejects a WRONG code — indistinguishable from a bad password (no enumeration)', async () => {
    const s = svc({ user: withCode(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] });
    const wrongCode = await attempt(s, { ownerAccessCode: 'NOT-THE-CODE' });
    const badPassword = await attempt(s, { password: 'not-the-password' });
    expect(wrongCode.outcome).toBe('INVALID_CREDENTIALS');
    expect(wrongCode.message).toBe(badPassword.message);   // same generic message — leaks nothing
  });

  it('rejects when a configured code is MISSING from the request', async () => {
    const r = await attempt(svc({ user: withCode(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] }));
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
  });

  it('an owner with NO code configured is unaffected — a stray code is ignored, not an error', async () => {
    const r = await attempt(svc({ user: owner(), salons: [salon(T_LUXE, 'Luxe', { isPrimaryOwner: true })] }), { ownerAccessCode: 'anything' });
    expect(r.outcome).toBe('SUCCESS');
  });
});

// ── Constitution 7 §19: a suspended salon's owner ────────────────────────────────────────────────────────────────────
describe('suspended salons in the Owner App sign-in', () => {
  it('an ACTIVE salon still wins: she opens there normally, even if another salon is suspended', async () => {
    const r = await login(svc({ user: owner(), salons: [salon(T_BELLE, 'Belle', { isPrimaryOwner: true, tenantStatus: 'suspended', suspensionReasonCode: 'BILLING' }), salon(T_LUXE, 'Luxe')] }));
    expect(r).toMatchObject({ outcome: 'SUCCESS', principal: { tenantId: T_LUXE } });
    expect((r.principal as any).restriction).toBeUndefined();
  });
  it('only a BILLING-suspended salon: a billing-only session opens there', async () => {
    const r = await login(svc({ user: owner(), salons: [salon(T_BELLE, 'Belle', { isPrimaryOwner: true, tenantStatus: 'suspended', suspensionReasonCode: 'BILLING', subscriptionStatus: 'past_due' })] }));
    expect(r).toMatchObject({ outcome: 'SUCCESS', principal: { tenantId: T_BELLE, restriction: 'SUSPENDED_BILLING_ONLY' } });
  });
  it('only a FRAUD-suspended salon: refused, as before', async () => {
    const r = await login(svc({ user: owner(), salons: [salon(T_BELLE, 'Belle', { isPrimaryOwner: true, tenantStatus: 'suspended', suspensionReasonCode: 'FRAUD' })] }));
    expect(r.outcome).toBe('TENANT_SUSPENDED');
    expect(r.principal).toBeUndefined();
  });
});
