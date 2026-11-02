// authorization-state.vitest.spec.ts — BUILD_PLAN Phase 9: the request-path decision about a session (pure) and the cache.
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@aipowersalon/permissions';
import { authorizeSession, isStale, narrowByBranchRole, AuthorizationStateCache, type AuthorizationState, type SessionAuthzClaims } from './authorization-state';

const T = 't1'; const B1 = 'b1'; const B2 = 'b2';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const state = (over: Partial<AuthorizationState> = {}): AuthorizationState => ({
  userId: 'u', tenantId: T, member: true, crossSalon: false, role: 'MANAGER', status: 'active', homeBranchId: B1, platformRole: null,
  userVersion: 5, tenantVersion: 2, templateKey: null, scope: 'TENANT', grant: permissionsFor('MANAGER'), branchGrants: [], branchRoles: {}, overrides: [], ...over,
});
const claims = (over: Partial<SessionAuthzClaims> = {}): SessionAuthzClaims => ({ userId: 'u', role: 'MANAGER', tenantId: T, branchId: B1, permissions: permissionsFor('MANAGER'), av: 5, tv: 2, ...over });

describe('isStale', () => {
  it('user or salon version moved, or a token without versions → stale', () => {
    expect(isStale({ av: 5, tv: 2 }, state())).toBe(false);
    expect(isStale({ av: 4, tv: 2 }, state())).toBe(true);
    expect(isStale({ av: 5, tv: 1 }, state())).toBe(true);
    expect(isStale({}, state())).toBe(true);
    expect(isStale({ av: 5 }, state({ tenantId: null, tenantVersion: null }))).toBe(false);   // a platform account has no salon version
  });
});

describe('authorizeSession', () => {
  it('fresh: the session grant stands, overrides are applied for this request', () => {
    const a: any = authorizeSession(claims({ permissions: ['pos.login', 'reports.view'] }), state({ overrides: [{ permission: 'reports.export', effect: 'ALLOW', expiresAt: NOW + 1000 }] }), NOW);
    expect(a.ok && !a.stale).toBe(true);
    expect(a.permissions).toEqual(['pos.login', 'reports.export', 'reports.view']);
    expect(a.authz.grant).toEqual(['pos.login', 'reports.view']);
  });
  it('a temporary grant expires AT decision time (no sweep needed)', () => {
    const a: any = authorizeSession(claims({ permissions: ['pos.login'] }), state({ overrides: [{ permission: 'reports.export', effect: 'ALLOW', expiresAt: NOW - 1 }] }), NOW);
    expect(a.permissions).toEqual(['pos.login']);
  });
  it('stale: re-authorized from the CURRENT grant — the stale claims are never used', () => {
    const narrowed = ['pos.login', 'reports.view'];
    const a: any = authorizeSession(claims(), state({ userVersion: 6, templateKey: 'ACCOUNTANT', grant: narrowed }), NOW);
    expect(a).toMatchObject({ ok: true, stale: true, permissions: narrowed });
    expect(a.permissions).not.toContain('checkout.process_payment');
    expect(a.authz).toMatchObject({ reauthorized: true, templateKey: 'ACCOUNTANT', userVersion: 6 });
  });
  it('stale with a role change that keeps pos.login: the new role is used for this request', () => {
    const a: any = authorizeSession(claims(), state({ userVersion: 6, role: 'FRONT_DESK', grant: permissionsFor('FRONT_DESK'), scope: 'BRANCH' }), NOW);
    expect(a).toMatchObject({ ok: true, role: 'FRONT_DESK' });
    expect(a.permissions).not.toContain('reports.export');
  });
  it('inactive / gone → every session of the user ends; a salon the account no longer belongs to → this session ends', () => {
    expect(authorizeSession(claims(), state({ status: 'inactive' }), NOW)).toEqual({ ok: false, reason: 'account_inactive', revoke: 'user' });
    expect(authorizeSession(claims(), state({ status: 'suspended', userVersion: 5 }), NOW)).toMatchObject({ ok: false, revoke: 'user' });
    expect(authorizeSession(claims(), null, NOW)).toEqual({ ok: false, reason: 'account_gone', revoke: 'user' });
    expect(authorizeSession(claims(), state({ member: false }), NOW)).toMatchObject({ ok: false, reason: 'role_changed', revoke: 'session' });
    expect(authorizeSession(claims(), state({ role: 'CUSTOMER', userVersion: 6 }), NOW)).toMatchObject({ ok: false, revoke: 'user' });
    expect(authorizeSession(claims(), state({ role: 'SUPER_ADMIN', userVersion: 6 }), NOW)).toMatchObject({ ok: false, reason: 'role_changed' });
  });
  it('stale and the current grant (or a DENY) no longer includes pos.login → every session ends', () => {
    expect(authorizeSession(claims(), state({ userVersion: 6, grant: ['reports.view'] }), NOW)).toEqual({ ok: false, reason: 'access_removed', revoke: 'user' });
    expect(authorizeSession(claims(), state({ userVersion: 6, overrides: [{ permission: 'pos.login', effect: 'DENY' }] }), NOW)).toMatchObject({ ok: false, reason: 'access_removed' });
  });
  it('stale and the session\'s branch is no longer enterable → this session ends', () => {
    expect(authorizeSession(claims({ branchId: B2 }), state({ userVersion: 6, scope: 'BRANCH', homeBranchId: B1 }), NOW)).toEqual({ ok: false, reason: 'branch_access_changed', revoke: 'session' });
    expect(authorizeSession(claims({ branchId: B2 }), state({ userVersion: 6, scope: 'BRANCH', branchGrants: [B1, B2] }), NOW).ok).toBe(true);
    expect(authorizeSession(claims({ branchId: B2 }), state({ userVersion: 6, scope: 'TENANT' }), NOW).ok).toBe(true);
  });
  it('a token minted without versions is re-checked but never WIDENED (a password-reset session with no permissions stays empty)', () => {
    const a: any = authorizeSession(claims({ av: undefined, tv: undefined, permissions: [] }), state(), NOW);
    expect(a).toMatchObject({ ok: true, stale: false, permissions: [] });   // no x-authorization-changed for a legacy token
    const b: any = authorizeSession(claims({ av: undefined, permissions: ['pos.login', 'checkout.process_payment'] }), state({ grant: ['pos.login'] }), NOW);
    expect(b.permissions).toEqual(['pos.login']);
  });
  it('a branch role row narrows the request in that branch only, never adds', () => {
    const st = state({ role: 'FRONT_DESK', grant: permissionsFor('FRONT_DESK'), branchRoles: { [B2]: 'TECHNICIAN', [B1]: 'MANAGER' } });
    const c = claims({ role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') });
    const inB2: any = authorizeSession({ ...c, branchId: B2 }, st, NOW);
    expect(inB2.permissions).not.toContain('checkout.process_payment');
    const inB1: any = authorizeSession({ ...c, branchId: B1 }, st, NOW);
    expect(inB1.permissions).not.toContain('reports.export');               // a MANAGER row never widens a front desk
    expect(inB1.permissions.length).toBe(permissionsFor('FRONT_DESK').length);
    expect(narrowByBranchRole(['a', 'pos.login'], 'FRONT_DESK', 'BOGUS')).toEqual(['a', 'pos.login']);
  });
  it('a platform account follows its CURRENT platform role; salon overrides never apply to it', () => {
    const st = state({ tenantId: null, role: 'SUPER_ADMIN', tenantVersion: null, userVersion: 3, grant: ['super_admin.users.view'], overrides: [{ permission: 'reports.view', effect: 'ALLOW' }] });
    const a: any = authorizeSession({ userId: 'u', role: 'SUPER_ADMIN', tenantId: null, branchId: null, permissions: ['super_admin.users.view', 'super_admin.system.manage'], av: 2 }, st, NOW);
    expect(a).toMatchObject({ ok: true, stale: true, permissions: ['super_admin.users.view'] });
  });
});

describe('AuthorizationStateCache', () => {
  it('serves ≤ ttl, reloads after, drops a user / a salon at once; a load error is thrown, never cached', async () => {
    let loads = 0; let fail = false; let clock = 0;
    const port = { async load(u: string, t: string | null) { loads++; if (fail) throw new Error('db'); return state({ userId: u, tenantId: t }); }, async revokeUserSessions() { return 2; } };
    const c = new AuthorizationStateCache(port, 30_000, () => clock);
    await c.get('u', T); await c.get('u', T); expect(loads).toBe(1);
    clock = 30_001; await c.get('u', T); expect(loads).toBe(2);
    c.invalidateUser('u'); await c.get('u', T); expect(loads).toBe(3);
    c.invalidateTenant(T); await c.get('u', T); expect(loads).toBe(4);
    c.invalidateUser('u'); fail = true; await expect(c.get('u', T)).rejects.toThrow('db');
    fail = false; await c.get('u', T); expect(loads).toBe(6);
    expect(await c.revokeUserSessions('u')).toBe(2);
  });
  it('a session minted with a NEWER version than the cached state reloads (the cache is behind), an equal / older one does not', async () => {
    let loads = 0; let uv = 3;
    const port = { async load(u: string, t: string | null) { loads++; return state({ userId: u, tenantId: t, userVersion: uv }); }, async revokeUserSessions() { return 0; } };
    const c = new AuthorizationStateCache(port, 30_000, () => 0);
    expect((await c.get('u', T, { av: 3 }))!.userVersion).toBe(3); expect(loads).toBe(1);
    await c.get('u', T, { av: 3 }); await c.get('u', T, { av: 2 }); expect(loads).toBe(1);
    uv = 4;                                            // the DB moved on; a refresh minted av 4 within the TTL
    expect((await c.get('u', T, { av: 4 }))!.userVersion).toBe(4); expect(loads).toBe(2);
  });
});
