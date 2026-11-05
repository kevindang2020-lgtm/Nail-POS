// Constitution 7 §7, §281 — the in-plane default-deny guard, and a platform role resolved at sign-in on the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformDomainGuard } from '@aipowersalon/permissions/guards';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAuthUserRepository } from '@aipowersalon/identity';
import { seedRow } from '../events/pgtest-seed';

function ctxFor(role: string, perms: string[], path: string, method: string, handlerKey?: string) {
  const req = { ctx: { role, permissions: perms }, route: { path }, method };
  const handler = () => undefined;
  const reflector = { get: (k: string) => (k === 'perm' ? handlerKey : undefined) } as unknown as Reflector;
  const context: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }), getHandler: () => handler };
  return { guard: new PlatformDomainGuard(reflector), context };
}

describe('PlatformDomainGuard (§7 deny by default inside the plane)', () => {
  const support = platformPermissionsFor('PLATFORM_SUPPORT') as string[];
  it('an unkeyed platform route requires its derived key: support may read tickets, may not issue billing credits', () => {
    let g = ctxFor('SUPER_ADMIN', support, '/super-admin/support/tickets', 'GET'); expect(g.guard.canActivate(g.context)).toBe(true);
    g = ctxFor('SUPER_ADMIN', support, '/super-admin/billing/credits', 'POST'); expect(() => g.guard.canActivate(g.context)).toThrow(ForbiddenException);
  });
  it('an UNCLASSIFIED platform path is refused even to the top role', () => {
    const g = ctxFor('SUPER_ADMIN', platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[], '/super-admin/not-a-real-area', 'GET');
    expect(() => g.guard.canActivate(g.context)).toThrow(/not classified/);
  });
  it('a route that declares its own key is left to RolePermissionGuard; non-platform sessions and paths are untouched', () => {
    let g = ctxFor('SUPER_ADMIN', support, '/super-admin/billing/credits', 'POST', 'super_admin.billing.credits.apply'); expect(g.guard.canActivate(g.context)).toBe(true);
    g = ctxFor('OWNER', ['pos.login'], '/pos/checkout', 'POST'); expect(g.guard.canActivate(g.context)).toBe(true);
  });
  it('the top role passes every classified route (no change for existing Super Admins)', () => {
    const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
    for (const [p, m] of [['/super-admin/billing/credits', 'POST'], ['/super-admin/security/lockdown', 'POST'], ['/super-admin/platform/users/:id', 'PATCH']]) {
      const g = ctxFor('SUPER_ADMIN', all, p, m); expect(g.guard.canActivate(g.context), `${m} ${p}`).toBe(true);
    }
  });
});

describe('platform role on the real schema (migration 460)', () => {
  let db: any; let pg: any;
  const SA = '4d4d4d4d-4d4d-44d4-84d4-4d4d4d4d4d4d', SUP = '4e4e4e4e-4e4e-44e4-84e4-4e4e4e4e4e4e', OWN = '4f4f4f4f-4f4f-44f4-84f4-4f4f4f4f4f4f', T = '50505050-5050-4505-8505-505050505050';
  beforeAll(async () => {
    pg = await migratedPglite(); db = kyselyFor(pg);
    await seedRow(pg, 'tenants', { id: T, legal_name: 'T', display_name: 'T', tenant_slug: 'prt', tenant_code: 'PRT001', status: 'active' });
    await seedRow(pg, 'users', { id: SA, email: 'sa@example.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' });
    await seedRow(pg, 'users', { id: SUP, email: 'support@example.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPPORT' });
    await seedRow(pg, 'users', { id: OWN, email: 'owner@example.test', role: 'OWNER', tenant_id: T });
  });
  it('reads a platform account\'s role; a tenant account has none', async () => {
    const repo = new KyselyAuthUserRepository(db);
    expect(await repo.platformRoleOf(SUP)).toBe('PLATFORM_SUPPORT');
    expect(await repo.platformRoleOf(SA)).toBe('PLATFORM_SUPER_ADMIN');
    expect(await repo.platformRoleOf(OWN)).toBeNull();
  });
  it('the schema refuses a platform role on a tenant account and an unknown role', async () => {
    await expect(pg.query(`update users set platform_role = 'PLATFORM_SUPPORT' where id = $1`, [OWN])).rejects.toBeTruthy();
    await expect(pg.query(`update users set platform_role = 'ROOT' where id = $1`, [SUP])).rejects.toBeTruthy();
  });
});
