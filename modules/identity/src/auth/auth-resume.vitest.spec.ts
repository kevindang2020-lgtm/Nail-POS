// auth-resume.vitest.spec.ts — BUILD_PLAN Phase 13 D: LoginService.authorizeResume, the re-authorization a biometric
// sign-in goes through (never trusts a stored permission list).
import { describe, it, expect } from 'vitest';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository } from './auth-user.repository';
import { permissionsFor } from '@aipowersalon/permissions';

const svc = (repo: any = new InMemoryAuthUserRepository({ tenants: [], users: [], subscriptions: [], branches: [] })) => new LoginService(repo);

describe('authorizeResume', () => {
  it('a platform account never resumes by biometrics', async () => {
    expect(await svc().authorizeResume({ userId: 'u', role: 'SUPER_ADMIN' })).toEqual({ ok: false, reason: 'realm_not_allowed' });
  });
  it('a customer gets the CUSTOMER role defaults', async () => {
    expect(await svc().authorizeResume({ userId: 'u', role: 'CUSTOMER', tenantId: 't' })).toEqual({ ok: true, permissions: permissionsFor('CUSTOMER' as any) });
  });
  it('staff: the account’s CURRENT state decides — a moved / suspended account is refused', async () => {
    const repo: any = new InMemoryAuthUserRepository({ tenants: [], users: [], subscriptions: [], branches: [] });
    repo.userStateForRefresh = async () => ({ role: 'MANAGER', tenantId: 't', status: 'active' });
    expect(await svc(repo).authorizeResume({ userId: 'u', role: 'TECHNICIAN', tenantId: 't' })).toEqual({ ok: false, reason: 'role_changed' });
    repo.userStateForRefresh = async () => ({ role: 'TECHNICIAN', tenantId: 't', status: 'suspended' });
    expect(await svc(repo).authorizeResume({ userId: 'u', role: 'TECHNICIAN', tenantId: 't' })).toEqual({ ok: false, reason: 'account_inactive' });
    repo.userStateForRefresh = async () => ({ role: 'TECHNICIAN', tenantId: 't', status: 'active' });
    const r: any = await svc(repo).authorizeResume({ userId: 'u', role: 'TECHNICIAN', tenantId: 't' });
    expect(r.ok).toBe(true); expect(r.permissions).toEqual(permissionsFor('TECHNICIAN' as any));
  });
});
