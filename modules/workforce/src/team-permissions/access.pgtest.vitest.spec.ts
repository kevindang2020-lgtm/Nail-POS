// access.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9: the salon's Roles & Permissions API against the real schema (PGlite with
// every migration): overrides (ceiling, never on yourself, deny wins, expiry, sweep), branch access, role assignment with
// the authorization version + audit + AUTHORIZATION_CHANGED, last owner, ownership transfer, the per-user effective view.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor } from '@aipowersalon/permissions';
import { AuthorizationStateCache, KyselyAuthorizationStatePort, authorizeSession } from '@aipowersalon/identity';
import { TeamAccessService, AccessError, sweepExpiredOverridesForTenant, type AccessActor } from './access.service';

const T = 'a9000000-0000-4000-8000-0000000000a1';
const B1 = 'b9000000-0000-4000-8000-0000000000b1', B2 = 'b9000000-0000-4000-8000-0000000000b2';
const OWNER = 'c9000000-0000-4000-8000-0000000000c1', MGR = 'c9000000-0000-4000-8000-0000000000c2', DESK = 'c9000000-0000-4000-8000-0000000000c3', TECH = 'c9000000-0000-4000-8000-0000000000c4';
let pg: any; let db: any; let svc: TeamAccessService; let cache: AuthorizationStateCache; let clock = Date.now();
const owner: AccessActor = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') };
const manager: AccessActor = { tenantId: T, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') };
const status = async (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof AccessError ? e.status : 500));
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AccessError ? e.code : String(e)));
const version = async (u: string) => Number((await sql`select authorization_version as v from users where id = ${u}`.execute(db) as any).rows[0].v);
const events = async () => Number((await sql`select count(*)::int as n from outbox_events where event_type = 'authorization.changed' and tenant_id = ${T}`.execute(db) as any).rows[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) VALUES ('${T}','Access LLC','Access','access-p9','ACCP9','active','${OWNER}');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active'), ('${B2}','${T}','Annex','active');
    INSERT INTO users (id, tenant_id, branch_id, email, full_name, status, role) VALUES
      ('${OWNER}','${T}','${B1}','o@acc.test','Olga Owner','active','OWNER'), ('${MGR}','${T}','${B1}','m@acc.test','Max Manager','active','MANAGER'),
      ('${DESK}','${T}','${B1}','d@acc.test','Dee Desk','active','FRONT_DESK'), ('${TECH}','${T}','${B1}','t@acc.test','Tia Tech','active','TECHNICIAN');`);
  cache = new AuthorizationStateCache(new KyselyAuthorizationStatePort(db), 30_000);
  svc = new TeamAccessService(db, new OutboxWriter(), cache);
}, 120_000);

describe('overrides', () => {
  it('ALLOW only for keys the actor holds; never super_admin.*; never an unknown key; never on yourself; reason required', async () => {
    expect(await status(svc.grantOverride(manager, DESK, { permission: 'subscription.manage', effect: 'ALLOW', reason: 'x' }))).toBe(403);
    expect(await status(svc.grantOverride(owner, DESK, { permission: 'super_admin.users.view', effect: 'ALLOW', reason: 'x' }))).toBe(400);
    expect(await status(svc.grantOverride(owner, DESK, { permission: 'pos.checkout.refund', effect: 'ALLOW', reason: 'x' }))).toBe(400);   // aliases are not catalog keys
    expect(await status(svc.grantOverride(owner, OWNER, { permission: 'reports.view', effect: 'DENY', reason: 'x' }))).toBe(403);
    expect(await status(svc.grantOverride(owner, DESK, { permission: 'reports.view', effect: 'ALLOW', reason: '  ' }))).toBe(400);
    expect(await status(svc.grantOverride(manager, OWNER, { permission: 'reports.view', effect: 'DENY', reason: 'x' }))).toBe(403);   // owner-level
  });
  it('a temporary ALLOW works then expires at decision time; the sweep revokes + audits it; versions move; events written', async () => {
    clock = Date.now() + 2_000; const v0 = await version(DESK); const e0 = await events();
    const o = await svc.grantOverride(owner, DESK, { permission: 'reports.view', effect: 'ALLOW', reason: 'cover', expiresAt: new Date(clock + 60_000).toISOString() });
    expect(o).toMatchObject({ permission: 'reports.view', effect: 'ALLOW', temporary: true, active: true });
    expect(await version(DESK)).toBeGreaterThan(v0);
    expect(await events()).toBe(e0 + 1);
    const st = await cache.get(DESK, T);
    const now = authorizeSession({ userId: DESK, role: 'FRONT_DESK', tenantId: T, branchId: B1, permissions: permissionsFor('FRONT_DESK'), av: st!.userVersion, tv: st!.tenantVersion }, st, clock) as any;
    expect(now.permissions).toContain('reports.view');
    const later = authorizeSession({ userId: DESK, role: 'FRONT_DESK', tenantId: T, branchId: B1, permissions: permissionsFor('FRONT_DESK'), av: st!.userVersion, tv: st!.tenantVersion }, st, clock + 61_000) as any;
    expect(later.permissions).not.toContain('reports.view');
    await sql`update tenant_user_permission_overrides set starts_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where id = ${o.id}`.execute(db);
    expect(await sweepExpiredOverridesForTenant(db, new OutboxWriter(), T)).toBe(1);
    const row: any = (await sql`select revoked_at, revoke_reason from tenant_user_permission_overrides where id = ${o.id}`.execute(db)).rows[0];
    expect(row.revoke_reason).toBe('expired'); expect(row.revoked_at).toBeTruthy();
    const aud: any = (await sql`select action from authorization_audit_events where tenant_id = ${T} and target_user_id = ${DESK} order by created_at desc limit 1`.execute(db)).rows[0];
    expect(aud.action).toBe('override.expired');
    expect(await sweepExpiredOverridesForTenant(db, new OutboxWriter(), T)).toBe(0);
  });
  it('DENY beats the role (effective view says denied_by_override); a second grant for the same key replaces the first; revoke', async () => {
    const d = await svc.grantOverride(owner, MGR, { permission: 'reports.export', effect: 'DENY', reason: 'audit' });
    const eff = await svc.effective(owner, MGR);
    expect(eff.permissions.find((p) => p.key === 'reports.export')).toBeUndefined();
    expect(eff.denied).toContainEqual({ key: 'reports.export', reason: 'denied_by_override' });
    const d2 = await svc.grantOverride(owner, MGR, { permission: 'reports.export', effect: 'DENY', reason: 'audit again', branchId: null });
    const live: any = (await sql`select count(*)::int as n from tenant_user_permission_overrides where user_id = ${MGR} and permission = 'reports.export' and revoked_at is null`.execute(db)).rows[0];
    expect(live.n).toBe(1);
    expect(await code(svc.revokeOverride(owner, d.id, { reason: 'x' }))).toBe('ALREADY_REVOKED');
    expect(await code(svc.revokeOverride(manager, d2.id, { reason: 'x' }))).toBe('SELF_CHANGE');   // a manager cannot lift their own DENY
    const r = await svc.revokeOverride(owner, d2.id, { reason: 'done' });
    expect(r.active).toBe(false);
  });
});

describe('branch access (salon side)', () => {
  it('sets the branches; validates them; refuses yourself and owners for non-owners; the scope confines entry', async () => {
    const m = await svc.setBranchAccess(owner, DESK, { branchIds: [B2], accessLevel: 'staff', reason: 'moved' });
    expect(m.branchAccess.map((b) => b.branchId)).toEqual([B2]);
    const st = await cache.get(DESK, T); cache.invalidateUser(DESK);
    const st2 = await cache.get(DESK, T);
    expect(st2!.branchGrants).toEqual([B2]);
    expect(await status(svc.setBranchAccess(owner, DESK, { branchIds: ['f9000000-0000-4000-8000-0000000000f1'], reason: 'x' }))).toBe(404);
    expect(await status(svc.setBranchAccess(manager, MGR, { branchIds: [B1], reason: 'x' }))).toBe(403);
    expect(await status(svc.setBranchAccess(manager, OWNER, { branchIds: [B1], reason: 'x' }))).toBe(403);
    // a versioned session in B1 is now stale and out of branch → it ends
    const a = authorizeSession({ userId: DESK, role: 'FRONT_DESK', tenantId: T, branchId: B1, permissions: permissionsFor('FRONT_DESK'), av: st!.userVersion - 1, tv: st!.tenantVersion }, st2, clock);
    expect(a).toEqual({ ok: false, reason: 'branch_access_changed', revoke: 'session' });
    await svc.setBranchAccess(owner, DESK, { branchIds: [], reason: 'back home' });
  });
});

describe('roles, last owner, ownership', () => {
  it('assigning a template re-authorizes the person; audit + event in the same transaction', async () => {
    const v0 = await version(MGR); const e0 = await events();
    const m = await svc.assignRole(owner, MGR, { templateKey: 'ACCOUNTANT', reason: 'books only' });
    expect(m).toMatchObject({ templateKey: 'ACCOUNTANT', templateName: 'Accountant', role: 'MANAGER' });
    expect(await version(MGR)).toBeGreaterThan(v0);
    expect(await events()).toBe(e0 + 1);
    const st = await cache.get(MGR, T);
    const a: any = authorizeSession({ userId: MGR, role: 'MANAGER', tenantId: T, branchId: B1, permissions: permissionsFor('MANAGER'), av: v0, tv: st!.tenantVersion }, st, clock);
    expect(a.ok && a.stale).toBe(true);
    expect(a.permissions).not.toContain('checkout.process_payment');
    const page = await svc.audit(owner, { userId: MGR });
    expect(page.items[0]).toMatchObject({ action: 'role.assigned', actorName: 'Olga Owner', targetName: 'Max Manager', reason: 'books only' });
    expect(await status(svc.assignRole(owner, MGR, { templateKey: 'ACCOUNTANT', reason: '' }))).toBe(400);
  });
  it('last owner: the only active owner cannot be demoted (409 LAST_OWNER) — even by themselves', async () => {
    expect(await code(svc.assignRole(owner, OWNER, { templateKey: 'GENERAL_MANAGER', reason: 'step down' }))).toBe('LAST_OWNER');
    expect(await status(svc.assignRole(owner, OWNER, { templateKey: 'GENERAL_MANAGER', reason: 'step down' }))).toBe(409);
  });
  it('ownership transfer moves tenants.owner_user_id and the role; the previous owner takes the chosen role; both audited', async () => {
    expect(await status(svc.transferOwnership(manager, { toUserId: DESK, reason: 'x' }))).toBe(403);   // not an owner
    const r = await svc.transferOwnership(owner, { toUserId: MGR, reason: 'retiring', keepPreviousOwnerAs: 'GENERAL_MANAGER' });
    expect(r).toEqual({ ok: true, newOwnerUserId: MGR, previousOwnerUserId: OWNER });
    const t: any = (await sql`select owner_user_id from tenants where id = ${T}`.execute(db)).rows[0];
    expect(t.owner_user_id).toBe(MGR);
    const roles: any[] = (await sql`select id, role from users where id in (${OWNER}, ${MGR}) order by email`.execute(db)).rows;
    expect(Object.fromEntries(roles.map((x) => [x.id, x.role]))).toEqual({ [OWNER]: 'MANAGER', [MGR]: 'OWNER' });
    const acts: any[] = (await sql`select action from authorization_audit_events where tenant_id = ${T} order by created_at desc limit 2`.execute(db)).rows;
    expect(acts.map((x) => x.action).sort()).toEqual(['ownership.transferred', 'role.base_changed']);
    const members = await svc.listMembers(owner);
    expect(members.find((x) => x.userId === MGR)).toMatchObject({ isOwner: true, isPrimaryOwner: true });
  });
  it('preview: nothing saved; added / removed / high-risk', async () => {
    const before = await version(TECH);
    const p = await svc.preview(owner, { userId: TECH, templateKey: null, overrides: [{ permission: 'reports.export', effect: 'ALLOW', reason: 'x' }] });
    expect(p.added).toContain('reports.export');
    expect(p.highRisk).toContain('reports.export');
    expect(await version(TECH)).toBe(before);
    const q = await svc.preview(owner, { userId: DESK, templateKey: 'SUPPORT_STAFF' });
    expect(q.removed).toContain('checkout.process_payment');
  });
  it('catalog: the registry\'s salon keys only', () => {
    const c = svc.catalog();
    expect(c.length).toBeGreaterThan(100);
    expect(c.some((d) => d.key.startsWith('super_admin.'))).toBe(false);
    expect(c.find((d) => d.key === 'roles.manage')).toBeTruthy();
  });
});
