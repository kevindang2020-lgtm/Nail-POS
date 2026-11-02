// escalation.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9 (Constitution 2 §153 "escalation tests"), the write paths on the
// real schema: an ALLOW override above the actor, a super_admin.* key via override (refused by the service AND by the
// table's CHECK), an override on yourself, a peer widening another manager, self-assignment, and a branch-access row
// naming a wider role (it may only narrow). The pure decision-level checks live in apps/api role-matrix.vitest.spec.ts.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor, templatePermissions, findRoleTemplate } from '@aipowersalon/permissions';
import { AuthorizationStateCache, KyselyAuthorizationStatePort, authorizeSession } from '@aipowersalon/identity';
import { TeamAccessService, AccessError, type AccessActor } from '../team-permissions/access.service';

const T = 'a9300000-0000-4000-8000-0000000000a1', B1 = 'b9300000-0000-4000-8000-0000000000b1';
const OWNER = 'c9300000-0000-4000-8000-0000000000c1', MGR = 'c9300000-0000-4000-8000-0000000000c2', MGR2 = 'c9300000-0000-4000-8000-0000000000c3', DESK = 'c9300000-0000-4000-8000-0000000000c4';
let db: any; let svc: TeamAccessService; let cache: AuthorizationStateCache;
const owner: AccessActor = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') };
const manager: AccessActor = { tenantId: T, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') };
const narrowedManager: AccessActor = { ...manager, permissions: templatePermissions(findRoleTemplate('INVENTORY_MANAGER')!) };
const status = async (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof AccessError ? e.status : 500));

beforeAll(async () => {
  const pg: any = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) VALUES ('${T}','Esc LLC','Esc','esc-p9b','RACEP9B3','active','${OWNER}');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active');
    INSERT INTO users (id, tenant_id, branch_id, email, full_name, status, role) VALUES
      ('${OWNER}','${T}','${B1}','o@esc.test','Olga','active','OWNER'), ('${MGR}','${T}','${B1}','m@esc.test','Max','active','MANAGER'),
      ('${MGR2}','${T}','${B1}','m2@esc.test','Mia','active','MANAGER'), ('${DESK}','${T}','${B1}','d@esc.test','Dee','active','FRONT_DESK');`);
  cache = new AuthorizationStateCache(new KyselyAuthorizationStatePort(db), 30_000);
  svc = new TeamAccessService(db, new OutboxWriter(), cache);
}, 120_000);

describe('escalation on the write paths', () => {
  it('an ALLOW override above the actor is refused (a manager cannot hand out what only the owner holds)', async () => {
    expect(await status(svc.grantOverride(manager, DESK, { permission: 'subscription.manage', effect: 'ALLOW', reason: 'x' }))).toBe(403);
    expect(await status(svc.grantOverride(narrowedManager, DESK, { permission: 'customers.export', effect: 'ALLOW', reason: 'x' }))).toBe(403);
  });
  it('a super_admin.* key via override is refused by the service and by the table itself', async () => {
    expect(await status(svc.grantOverride(owner, DESK, { permission: 'super_admin.users.manage', effect: 'ALLOW', reason: 'x' }))).toBe(400);
    await expect(sql`insert into tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, granted_by_user_id)
        values (${T}, ${DESK}, 'super_admin.users.manage', 'ALLOW', 'direct', ${OWNER})`.execute(db)).rejects.toThrow(/chk_tupo_no_platform|check constraint/);
  });
  it('nobody overrides their own permissions (not even to DENY themselves something, which a later revoke would undo)', async () => {
    expect(await status(svc.grantOverride(manager, MGR, { permission: 'reports.view', effect: 'ALLOW', reason: 'x' }))).toBe(403);
    expect(await status(svc.grantOverride(owner, OWNER, { permission: 'reports.view', effect: 'DENY', reason: 'x' }))).toBe(403);
  });
  it('self-assignment and peer widening are refused on the role-assignment path', async () => {
    expect(await status(svc.assignRole(manager, MGR, { templateKey: 'GENERAL_MANAGER', reason: 'me' }))).toBe(403);
    expect(await status(svc.assignRole(narrowedManager, MGR2, { templateKey: 'GENERAL_MANAGER', reason: 'peer' }))).toBe(403);
    expect(await status(svc.assignRole(manager, DESK, { templateKey: 'TENANT_ADMIN', reason: 'promote' }))).toBe(403);   // owner-level
  });
  it('a branch-access row naming OWNER does not make a front-desk session an owner (it can only narrow)', async () => {
    await sql`insert into user_branch_access (tenant_id, user_id, branch_id, role, access_level) values (${T}, ${DESK}, ${B1}, 'OWNER', 'owner')`.execute(db);
    cache.invalidateUser(DESK);
    const st = await cache.get(DESK, T);
    const r: any = authorizeSession({ userId: DESK, role: 'FRONT_DESK', tenantId: T, branchId: B1, permissions: permissionsFor('FRONT_DESK'), av: st!.userVersion, tv: st!.tenantVersion }, st);
    expect(r.ok).toBe(true);
    expect(r.permissions).not.toContain('settings.edit');
    expect(r.permissions).not.toContain('subscription.manage');
    expect(r.permissions.every((k: string) => (permissionsFor('FRONT_DESK') as string[]).includes(k))).toBe(true);
  });
});
