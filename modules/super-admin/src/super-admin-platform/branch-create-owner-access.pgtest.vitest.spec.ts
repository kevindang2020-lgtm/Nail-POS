// branch-create-owner-access.pgtest.vitest.spec.ts — found by the 200-technician M5 pilot (Oct 24 2026), real schema
// (PGlite): the Super Admin opens a second location for a salon → the salon's OWNER may enter it. Explicit
// user_branch_access grants confine (BUILD_PLAN Phase 9), so before this the owner's own new location answered "That
// branch is not available for your account". Staff grants are NOT extended; another salon's owner gets nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';

const T = 'b0c00000-0000-4000-8000-0000000000a1', T2 = 'b0c00000-0000-4000-8000-0000000000a2';
const MAIN = 'b0c00000-0000-4000-8000-0000000000b1', OTHER_MAIN = 'b0c00000-0000-4000-8000-0000000000b2';
const OWNER = 'b0c00000-0000-4000-8000-0000000000c1', CO_OWNER = 'b0c00000-0000-4000-8000-0000000000c2', TECH = 'b0c00000-0000-4000-8000-0000000000c3', OTHER_OWNER = 'b0c00000-0000-4000-8000-0000000000c4';
let db: any; let svc: SuperAdminPlatformService;
const CTX: any = { userId: 'b0c00000-0000-4000-8000-0000000000c9', email: 'sa@x.test' };

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Annex LLC','Annex','annex-m5','ANXM5','active'), ('${T2}','Other LLC','Other','other-m5','OTHM5','active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${MAIN}','${T}','Main','active'), ('${OTHER_MAIN}','${T2}','Other Main','active');
    INSERT INTO users (id, tenant_id, email, status, role) VALUES ('${OWNER}','${T}','o@annex.test','active','OWNER'), ('${CO_OWNER}','${T}','co@annex.test','active','OWNER'),
      ('${TECH}','${T}','t@annex.test','active','TECHNICIAN'), ('${OTHER_OWNER}','${T2}','o@other.test','active','OWNER');
    UPDATE tenants SET owner_user_id = '${OWNER}' WHERE id = '${T}';
    UPDATE tenants SET owner_user_id = '${OTHER_OWNER}' WHERE id = '${T2}';
    INSERT INTO user_branch_access (tenant_id, branch_id, user_id, access_level) VALUES ('${T}','${MAIN}','${OWNER}','owner'), ('${T}','${MAIN}','${CO_OWNER}','owner'),
      ('${T}','${MAIN}','${TECH}','staff'), ('${T2}','${OTHER_MAIN}','${OTHER_OWNER}','owner');`);
  svc = new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(db), db);
}, 120_000);

describe('a new location is open to its salon\'s owners', () => {
  it('createBranch grants every owner-level user of THAT salon (and the tenant owner) access to the new branch — nobody else', async () => {
    const b: any = await svc.createBranch(CTX, { tenantId: T, name: 'Annex', city: 'Merchantville', timezone: 'America/New_York' });
    const rows: any[] = (await sql`select user_id, access_level from user_branch_access where branch_id = ${b.id} order by user_id`.execute(db)).rows;
    expect(rows).toEqual([{ user_id: OWNER, access_level: 'owner' }, { user_id: CO_OWNER, access_level: 'owner' }].sort((x, y) => x.user_id.localeCompare(y.user_id)));
    // the technician's staff grant is NOT extended (her branches are her employment); the other salon's owner gets nothing
    const tech: any[] = (await sql`select branch_id from user_branch_access where user_id = ${TECH}`.execute(db)).rows;
    expect(tech.map((r) => r.branch_id)).toEqual([MAIN]);
    const other: any[] = (await sql`select branch_id from user_branch_access where user_id = ${OTHER_OWNER}`.execute(db)).rows;
    expect(other.map((r) => r.branch_id)).toEqual([OTHER_MAIN]);
  });
  it('a salon whose owner has no grant rows yet still gets the tenant owner on the new branch', async () => {
    await sql`delete from user_branch_access where tenant_id = ${T}`.execute(db);
    const b: any = await svc.createBranch(CTX, { tenantId: T, name: 'Annex Two', city: 'Pennsauken' });
    const rows: any[] = (await sql`select user_id from user_branch_access where branch_id = ${b.id}`.execute(db)).rows;
    expect(rows.map((r) => r.user_id)).toEqual([OWNER]);
  });
});
