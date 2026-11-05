// authz-revalidation.pgtest.vitest.spec — Constitution 9 §42/§43/§44 against REAL Postgres: the Kysely source
// reads the same rows the HTTP guards read, so a change an admin makes is a version change on the next poll.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAuthzVersionSource, authzVersion, isTerminal } from './authz-revalidation';

const T = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222221', B2 = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';
let pg: any; let src: KyselyAuthzVersionSource;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour-rt','GLAMRT','active') ON CONFLICT (id) DO NOTHING;
                 INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active'), ('${B2}','${T}','Annex','active') ON CONFLICT (id) DO NOTHING;
                 INSERT INTO users (id, tenant_id, branch_id, email, status, role, mfa_enabled)
                 VALUES ('${U}','${T}','${B1}','mgr@glamour.test','active','MANAGER',false) ON CONFLICT (id) DO NOTHING;
                 INSERT INTO user_branch_access (tenant_id, branch_id, user_id, access_level) VALUES ('${T}','${B1}','${U}','manager'), ('${T}','${B2}','${U}','manager') ON CONFLICT DO NOTHING;`);
  src = new KyselyAuthzVersionSource(kyselyFor(pg));
}, 60_000);

describe('§42 permission revocation is visible on the next poll', () => {
  it('reads role, home branch, statuses and the branch-access set; removing Branch B changes the version', async () => {
    const before = await src.facts(U, T);
    expect(before).toMatchObject({ role: 'MANAGER', branchId: B1, userStatus: 'active', tenantStatus: 'active', branchStatus: 'active', branchAccess: [B1, B2].sort() });
    const v0 = authzVersion(before);
    await pg.exec(`DELETE FROM user_branch_access WHERE user_id='${U}' AND branch_id='${B2}'`);   // §42: loses Branch B
    const after = await src.facts(U, T);
    expect(after!.branchAccess).toEqual([B1]);
    expect(authzVersion(after)).not.toBe(v0);
    expect(isTerminal(after)).toBe(false);                                                        // still allowed in — just narrower
  });
  it('a demotion changes the version; the same facts re-read give the same version', async () => {
    const v1 = authzVersion(await src.facts(U, T));
    expect(authzVersion(await src.facts(U, T))).toBe(v1);                                         // stable
    await pg.exec(`UPDATE users SET role='TECHNICIAN' WHERE id='${U}'`);
    expect(authzVersion(await src.facts(U, T))).not.toBe(v1);
    await pg.exec(`UPDATE users SET role='MANAGER' WHERE id='${U}'`);
  });
});

describe('BUILD_PLAN Phase 9: templates, overrides and both authorization versions are in the hash', () => {
  it('a narrowed template, a new override, an expiry change and a salon custom-role edit each change the version', async () => {
    const f0 = await src.facts(U, T);
    expect(f0).toMatchObject({ templateKey: null, overrides: [] });
    expect(typeof f0!.userVersion).toBe('number'); expect(typeof f0!.tenantVersion).toBe('number');
    const v0 = authzVersion(f0);
    await pg.exec(`INSERT INTO staff_role_assignments (tenant_id, user_id, template_key) VALUES ('${T}','${U}','ACCOUNTANT')`);
    const f1 = await src.facts(U, T);
    expect(f1!.templateKey).toBe('ACCOUNTANT');
    expect(f1!.userVersion).toBeGreaterThan(f0!.userVersion!);                                     // the trigger bumped it
    const v1 = authzVersion(f1); expect(v1).not.toBe(v0);
    await pg.exec(`INSERT INTO tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, granted_by_user_id) VALUES ('${T}','${U}','reports.export','DENY','test','${U}')`);
    const f2 = await src.facts(U, T); expect(f2!.overrides!.length).toBe(1);
    const v2 = authzVersion(f2); expect(v2).not.toBe(v1);
    await pg.exec(`UPDATE tenant_user_permission_overrides SET expires_at = now() + interval '1 day' WHERE user_id='${U}'`);
    const v3 = authzVersion(await src.facts(U, T)); expect(v3).not.toBe(v2);
    await pg.exec(`INSERT INTO tenant_custom_roles (tenant_id, name, base_role, scope, permissions) VALUES ('${T}','Lead','FRONT_DESK','BRANCH','["pos.login"]')`);
    expect(authzVersion(await src.facts(U, T))).not.toBe(v3);                                      // the salon's version moved
    await pg.exec(`DELETE FROM tenant_user_permission_overrides WHERE user_id='${U}'; DELETE FROM staff_role_assignments WHERE user_id='${U}'`);
  });
});

describe('§43/§44 suspension and deactivation are terminal', () => {
  it('§44 deactivating the user\'s home branch is terminal', async () => {
    await pg.exec(`UPDATE branches SET status='inactive' WHERE id='${B1}'`);
    expect(isTerminal(await src.facts(U, T))).toBe(true);
    await pg.exec(`UPDATE branches SET status='active' WHERE id='${B1}'`);
    expect(isTerminal(await src.facts(U, T))).toBe(false);
  });
  it('§43 suspending the tenant is terminal for every user in it', async () => {
    await pg.exec(`UPDATE tenants SET status='suspended' WHERE id='${T}'`);
    expect(isTerminal(await src.facts(U, T))).toBe(true);
    await pg.exec(`UPDATE tenants SET status='active' WHERE id='${T}'`);
  });
  it('a user that no longer exists (or belongs to another tenant) resolves to null → terminal', async () => {
    expect(await src.facts(U, '99999999-9999-4999-8999-999999999999')).toBeNull();               // §19: tenant-scoped lookup
    expect(isTerminal(null)).toBe(true);
  });
});
