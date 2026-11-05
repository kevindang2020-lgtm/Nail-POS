// refresh-authorization.vitest.spec.ts — Phase 1 (BUILD_PLAN_2026-10-06): a token refresh carries what the account may
// do NOW. Before Oct 6 2026 /auth/refresh re-signed the expired token's claims unchanged, so a demotion, a narrowed role
// template, a removed technician permission or a suspended account kept working until the session ended (12 h, or
// 30 days with "remember me").
import { describe, it, expect } from 'vitest';
import { LoginService } from './auth-login.service';

const T = 't-1';
function svc(state: { role: string; tenantId: string | null; status: string } | null, template: string[] | null = null, overrides: { permission: string; allowed: boolean }[] = []) {
  const repo: any = {
    async userStateForRefresh() { return state; },
    async staffTemplatePermissions() { return template; },
    async techPermissionOverrides() { return overrides; },
    async platformRoleOf() { return 'PLATFORM_SUPPORT'; },
  };
  return new LoginService(repo);
}

describe('currentAuthorization — what a refreshed token may carry', () => {
  it('an active manager gets the CURRENT template set, not what they held at sign-in', async () => {
    const narrowed = ['pos.login', 'reports.view'];
    const r = await svc({ role: 'MANAGER', tenantId: T, status: 'active' }, narrowed).currentAuthorization({ userId: 'u', role: 'MANAGER', tenantId: T });
    expect(r).toEqual({ ok: true, permissions: narrowed });
  });
  it('a technician whose permission was switched off loses it on the next refresh', async () => {
    const key = 'pos.tech.view_earnings';
    const on: any = await svc({ role: 'TECHNICIAN', tenantId: T, status: 'active' }, null, [{ permission: key, allowed: true }]).currentAuthorization({ userId: 'u', role: 'TECHNICIAN', tenantId: T });
    expect(on.permissions).toContain(key);
    const off: any = await svc({ role: 'TECHNICIAN', tenantId: T, status: 'active' }, null, [{ permission: key, allowed: false }]).currentAuthorization({ userId: 'u', role: 'TECHNICIAN', tenantId: T });
    expect(off.ok).toBe(true);
    expect(off.permissions).not.toContain(key);
  });
  it('a suspended, removed, demoted or moved account ends the session', async () => {
    const claims = { userId: 'u', role: 'MANAGER', tenantId: T };
    expect(await svc({ role: 'MANAGER', tenantId: T, status: 'suspended' }).currentAuthorization(claims)).toEqual({ ok: false, reason: 'account_inactive' });
    expect(await svc(null).currentAuthorization(claims)).toEqual({ ok: false, reason: 'account_gone' });
    expect(await svc({ role: 'FRONT_DESK', tenantId: T, status: 'active' }).currentAuthorization(claims)).toEqual({ ok: false, reason: 'role_changed' });
    expect(await svc({ role: 'MANAGER', tenantId: 't-2', status: 'active' }).currentAuthorization(claims)).toEqual({ ok: false, reason: 'role_changed' });
  });
  it('a platform account is re-derived from its CURRENT platform role', async () => {
    const r: any = await svc({ role: 'SUPER_ADMIN', tenantId: null, status: 'active' }).currentAuthorization({ userId: 'sa', role: 'SUPER_ADMIN', tenantId: null });
    expect(r.ok).toBe(true);
    expect(r.permissions.length).toBeGreaterThan(0);
    expect(r.permissions.every((p: string) => p.startsWith('super_admin.'))).toBe(true);
  });
  it('customers are unchanged (no staff permissions to re-derive); a repository that cannot answer leaves the refresh as before', async () => {
    expect(await svc({ role: 'CUSTOMER', tenantId: T, status: 'active' }).currentAuthorization({ userId: 'c', role: 'CUSTOMER', tenantId: T })).toBeNull();
    expect(await new LoginService({} as any).currentAuthorization({ userId: 'u', role: 'MANAGER', tenantId: T })).toBeNull();
  });
});

describe('BUILD_PLAN Phase 9 — a refresh re-checks the session\'s branch', () => {
  const repo = (allowed: string[] | null): any => ({
    async userStateForRefresh() { return { role: 'FRONT_DESK', tenantId: T, status: 'active' }; },
    async staffTemplatePermissions() { return null; },
    async enterableBranchesFor() { return allowed; },
  });
  it('a branch the person may no longer enter ends the session; an allowed one (or no confinement) refreshes', async () => {
    const claims = { userId: 'u', role: 'FRONT_DESK', tenantId: T, branchId: 'b2' };
    expect(await new LoginService(repo(['b1'])).currentAuthorization(claims)).toEqual({ ok: false, reason: 'branch_access_changed' });
    expect((await new LoginService(repo(['b1', 'b2'])).currentAuthorization(claims) as any).ok).toBe(true);
    expect((await new LoginService(repo(null)).currentAuthorization(claims) as any).ok).toBe(true);
  });
  it('the refreshed token carries the CURRENT versions', async () => {
    const r: any = { ...repo(null), async authorizationVersions() { return { av: 9, tv: 4 }; } };
    expect(await new LoginService(r).authorizationVersions({ userId: 'u', role: 'FRONT_DESK', tenantId: T })).toEqual({ av: 9, tv: 4 });
    expect(await new LoginService(r).authorizationVersions({ userId: 'c', role: 'CUSTOMER', tenantId: T })).toBeNull();
  });
});
