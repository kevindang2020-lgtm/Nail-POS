import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

const PW = 'Sup3rSecret!';
let repo: InMemoryAuthUserRepository;
let svc: LoginService;

beforeAll(async () => {
  const hash = await hashPassword(PW);
  const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({
    branchId: null, status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null,
    email: null, normalizedPhone: null, ...o,
  });
  const seed: AuthSeed = {
    tenants: [
      { id: 'tA', tenantCode: 'PALACE', status: 'active' },
      { id: 'tM', tenantCode: 'MULTI', status: 'active' },
      { id: 'tS', tenantCode: 'SUSREST', status: 'suspended' },
      { id: 'tP', tenantCode: 'PASTDUE', status: 'active' },
    ],
    users: [
      mk({ userId: 'uOwnerA', tenantId: 'tA', role: 'OWNER', email: 'owner@a.com', branchId: 'bA1' }),
      mk({ userId: 'uMfaA', tenantId: 'tA', role: 'OWNER', email: 'mfa@a.com', branchId: 'bA1', mfaEnabled: true }),
      mk({ userId: 'uOffA', tenantId: 'tA', role: 'FRONT_DESK', email: 'off@a.com', status: 'suspended' }),
      mk({ userId: 'uInvitedA', tenantId: 'tA', role: 'FRONT_DESK', email: 'invited@a.com', branchId: 'bA1', status: 'invited' }),
      mk({ userId: 'uMulti', tenantId: 'tM', role: 'OWNER', email: 'm@m.com', branchId: null }),
      mk({ userId: 'uSus', tenantId: 'tS', role: 'OWNER', email: 's@s.com' }),
      mk({ userId: 'uPast', tenantId: 'tP', role: 'OWNER', email: 'p@p.com' }),
      mk({ userId: 'uRoot', tenantId: null, role: 'SUPER_ADMIN', email: 'root@aips.com' }),
    ],
    subscriptions: [
      { tenantId: 'tA', status: 'active' }, { tenantId: 'tM', status: 'active' },
      { tenantId: 'tS', status: 'active' }, { tenantId: 'tP', status: 'past_due' },
    ],
    branches: [{ tenantId: 'tA' }, { tenantId: 'tM' }, { tenantId: 'tM' }, { tenantId: 'tS' }, { tenantId: 'tP' }],
  };
  repo = new InMemoryAuthUserRepository(seed);
  svc = new LoginService(repo);
});

describe('LoginService.attempt — tenant portal', () => {
  it('SUCCESS with correct credentials yields a principal + RBAC permissions', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@a.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.userId).toBe('uOwnerA');
    expect(r.principal?.tenantId).toBe('tA');
    expect(r.principal?.branchId).toBe('bA1');
    expect(Array.isArray(r.principal?.permissions)).toBe(true);
    expect((r.principal?.permissions.length ?? 0)).toBeGreaterThan(0);
  });

  it('INVALID_CREDENTIALS on wrong password (no principal, generic message)', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@a.com', password: 'nope' });
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
    expect(r.principal).toBeUndefined();
  });

  it('INVALID_CREDENTIALS on unknown identifier', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'ghost@a.com', password: PW });
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
  });

  it('TENANT_NOT_FOUND on unknown salon code', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'NOPE', identifier: 'owner@a.com', password: PW });
    expect(r.outcome).toBe('TENANT_NOT_FOUND');
  });

  it('TENANT_SUSPENDED only after credentials verify', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'SUSREST', identifier: 's@s.com', password: PW });
    expect(r.outcome).toBe('TENANT_SUSPENDED');
    expect(r.principal).toBeUndefined();
  });

  it('USER_DISABLED for a suspended user', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'off@a.com', password: PW });
    expect(r.outcome).toBe('USER_DISABLED');
  });

  it('SUBSCRIPTION_BLOCKED when subscription is past_due', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PASTDUE', identifier: 'p@p.com', password: PW });
    expect(r.outcome).toBe('SUBSCRIPTION_BLOCKED');
  });

  it('MFA_REQUIRED without a code, then SUCCESS with a valid code', async () => {
    const noCode = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'mfa@a.com', password: PW });
    expect(noCode.outcome).toBe('MFA_REQUIRED');
    expect(noCode.principal).toBeUndefined();
    const withCode = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'mfa@a.com', password: PW, mfaCode: '123456' });
    expect(withCode.outcome).toBe('SUCCESS');
    expect(withCode.principal?.userId).toBe('uMfaA');
  });

  it('activates an invited user on valid password login and returns SUCCESS', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'invited@a.com', password: PW });
    expect(r.outcome).toBe('SUCCESS');
    expect(r.principal?.userId).toBe('uInvitedA');
    // Verify status was updated in repo
    const lookup = await repo.findTenantUserForLogin('PALACE', { kind: 'email', value: 'invited@a.com' });
    expect(lookup.user?.status).toBe('active');
  });

  it('BRANCH_SELECTION_REQUIRED for a multi-branch tenant (principal flagged, branchId null)', async () => {
    const r = await svc.attempt({ portal: 'tenant', salonCode: 'MULTI', identifier: 'm@m.com', password: PW });
    expect(r.outcome).toBe('BRANCH_SELECTION_REQUIRED');
    expect(r.principal?.needsBranchSelection).toBe(true);
    expect(r.principal?.branchId).toBeNull();
  });
});

describe('LoginService.attempt — super-admin portal', () => {
  it('requires MFA (SUPER_ADMIN is MFA-required) then SUCCESS with a code', async () => {
    const noCode = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW });
    expect(noCode.outcome).toBe('MFA_REQUIRED');
    const ok = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW, mfaCode: '654321' });
    expect(ok.outcome).toBe('SUCCESS');
    expect(ok.principal?.role).toBe('SUPER_ADMIN');
    expect(ok.principal?.tenantId).toBeNull();
  });

  it('INVALID_CREDENTIALS for a bad super-admin password', async () => {
    const r = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: 'nope', mfaCode: '654321' });
    expect(r.outcome).toBe('INVALID_CREDENTIALS');
  });
});
