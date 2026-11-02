import { describe, it, expect } from 'vitest';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { normalizeIdentifier } from '@aipowersalon/auth';

const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({
  branchId: null, status: 'active', passwordHash: 'scrypt$16384$8$1$x$y', mfaEnabled: false, fullName: null,
  email: null, normalizedPhone: null, ...o,
});

const seed: AuthSeed = {
  tenants: [
    { id: 'tA', tenantCode: 'PALACE', status: 'active' },
    { id: 'tB', tenantCode: 'CHERRY', status: 'suspended' },
  ],
  users: [
    mk({ userId: 'uOwnerA', tenantId: 'tA', role: 'OWNER', email: 'owner@a.com', branchId: 'bA1' }),
    mk({ userId: 'uTechA', tenantId: 'tA', role: 'TECHNICIAN', normalizedPhone: '+15551234567' }),
    mk({ userId: 'uDupA', tenantId: 'tA', role: 'MANAGER', email: 'dup@x.com' }),
    mk({ userId: 'uDupB', tenantId: 'tB', role: 'OWNER', email: 'dup@x.com' }),
    mk({ userId: 'uRoot', tenantId: null, role: 'SUPER_ADMIN', email: 'root@aips.com' }),
  ],
  subscriptions: [
    { tenantId: 'tA', status: 'active' },
    { tenantId: 'tB', status: 'past_due' },
  ],
  branches: [{ tenantId: 'tA' }, { tenantId: 'tA' }, { tenantId: 'tB' }],
};
const repo = new InMemoryAuthUserRepository(seed);

describe('auth-user.repository (in-memory)', () => {
  it('resolves a tenant + user by email with subscription and branch count', async () => {
    const r = await repo.findTenantUserForLogin('PALACE', normalizeIdentifier('owner@a.com'));
    expect(r.tenantFound).toBe(true);
    expect(r.tenantStatus).toBe('active');
    expect(r.user?.userId).toBe('uOwnerA');
    expect(r.user?.role).toBe('OWNER');
    expect(r.subscriptionStatus).toBe('active');
    expect(r.branchCount).toBe(2);
  });

  it('resolves a user by phone (E.164 normalized)', async () => {
    const r = await repo.findTenantUserForLogin('PALACE', normalizeIdentifier('555-123-4567'));
    expect(r.user?.userId).toBe('uTechA');
    expect(r.user?.role).toBe('TECHNICIAN');
  });

  it('returns tenantFound=false for an unknown salon code', async () => {
    const r = await repo.findTenantUserForLogin('NOPE', normalizeIdentifier('owner@a.com'));
    expect(r.tenantFound).toBe(false);
    expect(r.user).toBeUndefined();
    expect(r.branchCount).toBe(0);
  });

  it('returns no user when the email is not in that tenant (tenant still found)', async () => {
    const r = await repo.findTenantUserForLogin('PALACE', normalizeIdentifier('ghost@a.com'));
    expect(r.tenantFound).toBe(true);
    expect(r.user).toBeUndefined();
  });

  it('isolates duplicate emails across tenants', async () => {
    const a = await repo.findTenantUserForLogin('PALACE', normalizeIdentifier('dup@x.com'));
    const b = await repo.findTenantUserForLogin('CHERRY', normalizeIdentifier('dup@x.com'));
    expect(a.user?.userId).toBe('uDupA');
    expect(a.user?.tenantId).toBe('tA');
    expect(b.user?.userId).toBe('uDupB');
    expect(b.user?.tenantId).toBe('tB');
    expect(b.tenantStatus).toBe('suspended');
  });

  it('does not return a SUPER_ADMIN via the tenant lookup, but does via the super-admin lookup', async () => {
    const viaTenant = await repo.findTenantUserForLogin('PALACE', normalizeIdentifier('root@aips.com'));
    expect(viaTenant.user).toBeUndefined();
    const viaSa = await repo.findSuperAdminForLogin(normalizeIdentifier('root@aips.com'));
    expect(viaSa.user?.userId).toBe('uRoot');
    expect(viaSa.user?.tenantId).toBeNull();
  });
});
