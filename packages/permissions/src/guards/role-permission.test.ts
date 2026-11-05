// role-permission.test.ts — BUILD_PLAN Phase 9: the tenant permission guard answers with the decision object, records
// denials without ever blocking on the recording, and refuses UNKEYED staff handlers only when default deny is on.
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RolePermissionGuard, TENANT_DEFAULT_DENY, type AuthzDenialRecord } from './role-permission.guard';
import { permissionsFor } from '../rbac';

function exec(perm: string | undefined, req: any) {
  const handler = () => undefined;
  const reflector = { get: (k: string, h: any) => (k === 'perm' && h === handler ? perm : undefined) } as unknown as Reflector;
  return { reflector, context: { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as any };
}
const staff = (role: string, perms: string[] = permissionsFor(role as any), extra: any = {}) => ({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions: perms, ...extra });
const caught = (fn: () => unknown): any => { try { fn(); return null; } catch (e) { return e; } };

describe('RolePermissionGuard — the decision object', () => {
  it('allowed → true; refused → 403 PERMISSION_DENIED with the reason and the key, and the denial is recorded', () => {
    const recs: AuthzDenialRecord[] = [];
    const { reflector, context } = exec('reports.export', { ctx: staff('FRONT_DESK'), route: { path: '/pos/reports/export' } });
    const g = new RolePermissionGuard(reflector, { record: (d) => { recs.push(d); } });
    const e = caught(() => g.canActivate(context));
    expect(e?.getStatus?.()).toBe(403);
    expect(e.getResponse()).toEqual({ code: 'PERMISSION_DENIED', reason: 'missing_permission', permission: 'reports.export', message: 'Missing permission: reports.export' });
    expect(e.message).toBe('Missing permission: reports.export');
    expect(recs).toEqual([{ tenantId: 't', userId: 'u', role: 'FRONT_DESK', permission: 'reports.export', reason: 'missing_permission', route: '/pos/reports/export' }]);
    const ok = exec('reports.export', { ctx: staff('MANAGER') });
    expect(new RolePermissionGuard(ok.reflector).canActivate(ok.context)).toBe(true);
  });
  it('a DENY override recorded by the middleware says denied_by_override (grant + overrides, not the folded list)', () => {
    const ctx = staff('MANAGER', permissionsFor('MANAGER').filter((p) => p !== 'reports.export'), { authz: { grant: permissionsFor('MANAGER'), overrides: [{ permission: 'reports.export', effect: 'DENY' }], scope: 'TENANT', branchIds: null, templateKey: null, userVersion: 1, tenantVersion: 1, reauthorized: false } });
    const { reflector, context } = exec('pos.reports.export', { ctx });
    expect(caught(() => new RolePermissionGuard(reflector).canActivate(context)).getResponse().reason).toBe('denied_by_override');
  });
  it('a sink that throws or rejects never turns a 403 into a 500, nor blocks', () => {
    const { reflector, context } = exec('reports.export', { ctx: staff('TECHNICIAN') });
    expect(caught(() => new RolePermissionGuard(reflector, { record: () => { throw new Error('db down'); } }).canActivate(context)).getStatus()).toBe(403);
    expect(caught(() => new RolePermissionGuard(reflector, { record: () => Promise.reject(new Error('db down')) }).canActivate(context)).getStatus()).toBe(403);
  });
  it('no context → 403 (never a crash)', () => {
    const { reflector, context } = exec('reports.view', {});
    expect(caught(() => new RolePermissionGuard(reflector).canActivate(context)).getStatus()).toBe(403);
  });
});

describe('RolePermissionGuard — default deny for unkeyed staff handlers', () => {
  it('the shipped flag is ON: every staff route is keyed (unkeyed baseline 0), so an unkeyed handler is refused', () => {
    expect(typeof TENANT_DEFAULT_DENY).toBe('boolean');
    expect(TENANT_DEFAULT_DENY).toBe(true);
  });
  it('OFF: an unkeyed handler passes for everyone (today\'s behaviour)', () => {
    const { reflector, context } = exec(undefined, { ctx: staff('FRONT_DESK'), route: { path: '/pos/things' } });
    expect(new RolePermissionGuard(reflector, null, false).canActivate(context)).toBe(true);
  });
  it('ON: an unkeyed /pos, /owner, /tenant, /tech handler refuses staff and integrations with AUTHZ_ROUTE_UNKEYED', () => {
    for (const path of ['/pos/things', '/owner/x', '/tenant/ai/y', '/tech/queue', '/api/v1/pos/things']) {
      const recs: AuthzDenialRecord[] = [];
      const { reflector, context } = exec(undefined, { ctx: staff('OWNER'), route: { path } });
      const e = caught(() => new RolePermissionGuard(reflector, { record: (d) => { recs.push(d); } }, true).canActivate(context));
      expect(e?.getResponse?.().code).toBe('AUTHZ_ROUTE_UNKEYED');
      expect(recs[0]).toMatchObject({ reason: 'AUTHZ_ROUTE_UNKEYED' });
    }
    const integ = exec(undefined, { ctx: { tenantId: 't', userId: 'k', role: 'INTEGRATION', actorType: 'INTEGRATION', apiKeyId: 'k', permissions: [] }, route: { path: '/pos/things' } });
    expect(caught(() => new RolePermissionGuard(integ.reflector, null, true).canActivate(integ.context))?.getResponse?.().code).toBe('AUTHZ_ROUTE_UNKEYED');
  });
  it('ON: public routes (no session), customers, platform staff and non-staff paths are untouched', () => {
    const cases: any[] = [
      { route: { path: '/pos/public-thing' } },                                                          // no ctx
      { ctx: { tenantId: 't', userId: 'c', role: 'CUSTOMER', permissions: [] }, route: { path: '/customer/me' } },
      { ctx: { tenantId: '', userId: 's', role: 'SUPER_ADMIN', permissions: [] }, route: { path: '/super-admin/x' } },
      { ctx: staff('MANAGER'), route: { path: '/auth/me' } },
      { ctx: staff('MANAGER'), route: { path: '/push/register' } },
    ];
    for (const req of cases) { const { reflector, context } = exec(undefined, req); expect(new RolePermissionGuard(reflector, null, true).canActivate(context)).toBe(true); }
  });
  it('ON: a keyed handler is decided exactly as with the flag off', () => {
    const { reflector, context } = exec('checkout.view', { ctx: staff('FRONT_DESK'), route: { path: '/pos/checkout' } });
    expect(new RolePermissionGuard(reflector, null, true).canActivate(context)).toBe(true);
  });
});
