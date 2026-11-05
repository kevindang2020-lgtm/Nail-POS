import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { checkIntegrationPermission, P } from './integration-permissions';
import { IntegrationPermissionGuard } from './integration-permission.guard';

const ctx = (role: string | undefined, permissions?: string[]) => ({ role, permissions });

describe('checkIntegrationPermission', () => {
  it('denies non-super-admins outright', () => {
    expect(checkIntegrationPermission(ctx('OWNER', ['super_admin.integrations.view']), P.view)).toBe(false);
    expect(checkIntegrationPermission(undefined, P.view)).toBe(false);
  });

  it('grants an unrestricted super admin full access (backward compatible)', () => {
    const u = ctx('SUPER_ADMIN', ['super_admin.tenants.view', 'super_admin.audit_logs.view']); // no integration perms
    expect(checkIntegrationPermission(u, P.view)).toBe(true);
    expect(checkIntegrationPermission(u, P.credentialsManage)).toBe(true); // sensitive still allowed when unrestricted
    expect(checkIntegrationPermission(ctx('SUPER_ADMIN', []), P.compromisedDisable)).toBe(true);
  });

  it('honors superuser wildcards', () => {
    expect(checkIntegrationPermission(ctx('SUPER_ADMIN', ['super_admin.*']), P.credentialsManage)).toBe(true);
    expect(checkIntegrationPermission(ctx('SUPER_ADMIN', ['*']), P.crossTenantExport)).toBe(true);
  });

  it('enforces a restricted token key-by-key', () => {
    const scoped = ctx('SUPER_ADMIN', [P.view, P.syncView]);
    expect(checkIntegrationPermission(scoped, P.view)).toBe(true);
    expect(checkIntegrationPermission(scoped, P.syncView)).toBe(true);
    expect(checkIntegrationPermission(scoped, P.create)).toBe(false);      // not granted
    expect(checkIntegrationPermission(scoped, P.credentialsManage)).toBe(false);
  });

  it('the integrations wildcard grants non-sensitive but NOT sensitive capabilities', () => {
    const w = ctx('SUPER_ADMIN', ['super_admin.integrations.*']);
    expect(checkIntegrationPermission(w, P.view)).toBe(true);
    expect(checkIntegrationPermission(w, P.enable)).toBe(true);
    expect(checkIntegrationPermission(w, P.export)).toBe(true);
    expect(checkIntegrationPermission(w, P.credentialsManage)).toBe(false); // sensitive → explicit only
    expect(checkIntegrationPermission(w, P.compromisedDisable)).toBe(false);
    expect(checkIntegrationPermission(ctx('SUPER_ADMIN', ['super_admin.integrations.*', P.credentialsManage]), P.credentialsManage)).toBe(true);
  });
});

describe('IntegrationPermissionGuard', () => {
  const makeCtx = (metaKey: string | undefined, reqCtx: any) => ({
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ ctx: reqCtx }) }),
  } as any);
  const reflector = (metaKey: string | undefined) => ({ get: () => metaKey } as any);

  it('passes when no permission metadata is present', () => {
    const g = new IntegrationPermissionGuard(reflector(undefined));
    expect(g.canActivate(makeCtx(undefined, { role: 'OWNER' }))).toBe(true);
  });

  it('enforces the required permission and 403s when missing', () => {
    const g = new IntegrationPermissionGuard(reflector(P.credentialsManage));
    expect(g.canActivate(makeCtx(P.credentialsManage, { role: 'SUPER_ADMIN', permissions: ['super_admin.*'] }))).toBe(true);
    expect(() => g.canActivate(makeCtx(P.credentialsManage, { role: 'SUPER_ADMIN', permissions: ['super_admin.integrations.*'] }))).toThrow(ForbiddenException);
  });
});

import { permissionsFor } from '@aipowersalon/permissions';
import { ALL_PERMISSIONS } from './integration-permissions';

describe('rbac wiring', () => {
  it("issues every integrations.* capability in a SUPER_ADMIN token", () => {
    const granted = permissionsFor('SUPER_ADMIN');
    for (const p of ALL_PERMISSIONS) expect(granted).toContain(p);
  });
  it('a real SUPER_ADMIN token passes every integration permission check (incl. sensitive)', () => {
    const ctx = { role: 'SUPER_ADMIN', permissions: permissionsFor('SUPER_ADMIN') };
    for (const p of ALL_PERMISSIONS) expect(checkIntegrationPermission(ctx, p)).toBe(true);
  });
});
