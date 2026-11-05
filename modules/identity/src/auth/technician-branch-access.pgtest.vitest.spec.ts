// technician-branch-access.pgtest — enterableBranchesForUser on the real schema for TECHNICIAN logins (Oct 12 2026 merge,
// workforce audit P2 #28): her grants (user_branch_access, one per active membership) decide; without any, her home
// branch only; the OWN scope's "any branch" never applies to her. Other roles unchanged (null = any for TENANT scope).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { enterableBranchesForUser } from './authorization-state';

const T = 'b4a00000-0000-4000-8000-0000000000a0', A = 'b4a00000-0000-4000-8000-0000000000b1', B = 'b4a00000-0000-4000-8000-0000000000b2';
const TECH = 'b4a00000-0000-4000-8000-0000000000c1', TECH_NOHOME = 'b4a00000-0000-4000-8000-0000000000c2', MGR = 'b4a00000-0000-4000-8000-0000000000c3';
let pg: any; let db: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','M','M','m-b4a','MB4A1','active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${A}','${T}','A'), ('${B}','${T}','B');
    INSERT INTO users (id, tenant_id, branch_id, full_name, email, status, role) VALUES
      ('${TECH}','${T}','${B}','Lan','lan@b4a.test','active','TECHNICIAN'), ('${TECH_NOHOME}','${T}',NULL,'Ivy','ivy@b4a.test','active','TECHNICIAN'),
      ('${MGR}','${T}','${A}','Max','max@b4a.test','active','OWNER');
  `);
}, 300_000);

describe('enterable branches for a TECHNICIAN login', () => {
  it('no grant → her home branch only; no home either → none (never "any")', async () => {
    expect(await enterableBranchesForUser(db, T, TECH, 'TECHNICIAN')).toEqual([B]);
    expect(await enterableBranchesForUser(db, T, TECH_NOHOME, 'TECHNICIAN')).toEqual([]);
  });
  it('grants decide once she has them (employment at A only → A, even though her home row says B)', async () => {
    await pg.query(`INSERT INTO user_branch_access (tenant_id, branch_id, user_id, role, access_level) VALUES ($1,$2,$3,'TECHNICIAN','staff')`, [T, A, TECH]);
    expect(await enterableBranchesForUser(db, T, TECH, 'TECHNICIAN')).toEqual([A]);
  });
  it('an owner without grants keeps the TENANT scope (any branch)', async () => {
    expect(await enterableBranchesForUser(db, T, MGR, 'OWNER')).toBeNull();
  });
});
