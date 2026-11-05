// auth-login-staff-role.vitest.spec.ts — Functional Decision 12, step 3: sign-in carries the staff member's role
// template — a subset of the base role — and falls back to the base-role defaults on anything unexpected.
import { describe, it, expect, beforeAll } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed, type MemUser } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';
import { permissionsFor, templatePermissions, findRoleTemplate } from '@aipowersalon/permissions';

const PW = 'Sup3rSecret!';
let seed: AuthSeed;
beforeAll(async () => {
  const hash = await hashPassword(PW);
  const mk = (o: Partial<MemUser> & Pick<MemUser, 'userId' | 'role' | 'tenantId'>): MemUser => ({ branchId: 'b1', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: null, email: null, normalizedPhone: null, ...o });
  seed = {
    tenants: [{ id: 'tA', tenantCode: 'PALACE', status: 'active' }],
    users: [mk({ userId: 'uAcct', tenantId: 'tA', role: 'MANAGER', email: 'acct@a.com' })],
    subscriptions: [{ tenantId: 'tA', status: 'active' }], branches: [{ tenantId: 'tA' }],
  };
});
const login = async (staffTemplatePermissions?: any) => {
  const repo: any = new InMemoryAuthUserRepository(seed);
  if (staffTemplatePermissions) repo.staffTemplatePermissions = staffTemplatePermissions;
  const r = await new LoginService(repo).attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'acct@a.com', password: PW });
  expect(r.outcome).toBe('SUCCESS');
  return r.principal!.permissions;
};

describe('Decision 12 step 3 — sign-in uses the role template', () => {
  it('an Accountant (on a Manager account) signs in with the Accountant set — no front-desk operations', async () => {
    const acct = templatePermissions(findRoleTemplate('ACCOUNTANT')!);
    const perms = await login(async () => acct);
    expect(perms.sort()).toEqual([...acct].sort());
    expect(perms).not.toContain('checkout.process_payment');
  });
  it('no template → the base-role defaults, unchanged', async () => {
    expect((await login(async () => null)).sort()).toEqual([...permissionsFor('MANAGER')].sort());
  });
  it('a resolver error → the base-role defaults (never a lock-out, never more)', async () => {
    expect((await login(async () => { throw new Error('db down'); })).sort()).toEqual([...permissionsFor('MANAGER')].sort());
  });
  it('even a bad resolver answer cannot grant beyond the base role', async () => {
    const perms = await login(async () => ['reports.view', 'subscription.manage', 'super_admin.tenants.manage']);
    expect(perms).toEqual(['reports.view']);
  });
});
