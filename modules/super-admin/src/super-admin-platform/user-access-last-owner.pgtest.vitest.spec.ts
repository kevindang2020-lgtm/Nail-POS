// user-access-last-owner.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9 on the platform's user routes (real schema, PGlite):
// disabling or demoting a salon's ONLY active owner is 409 LAST_OWNER; disabling anyone else revokes every live session of
// theirs at once and is written to authorization_audit_events.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';

const T = 'af900000-0000-4000-8000-0000000000a1';
const OWNER = 'af900000-0000-4000-8000-0000000000c1', MGR = 'af900000-0000-4000-8000-0000000000c2', SA = 'af900000-0000-4000-8000-0000000000c9';
let db: any; let svc: SuperAdminPlatformService;
const CTX: any = { userId: SA, email: 'sa@x.test' };
const err = (p: Promise<unknown>) => p.then(() => null, (e) => e);

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Lo LLC','Lo','lo-p9','LOP9','active');
    INSERT INTO users (id, tenant_id, email, status, role) VALUES ('${OWNER}','${T}','o@lo.test','active','OWNER'), ('${MGR}','${T}','m@lo.test','active','MANAGER');
    INSERT INTO users (id, tenant_id, email, status, role) VALUES ('${SA}', NULL, 'sa@x.test', 'active', 'SUPER_ADMIN');
    INSERT INTO sessions (user_id, tenant_id, status, expires_at) VALUES ('${MGR}','${T}','active', now() + interval '1 day'), ('${MGR}','${T}','active', now() + interval '1 day');`);
  svc = new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(db), db);
}, 120_000);

describe('platform user routes keep a salon owner and end sessions', () => {
  it('disabling the only active owner → conflict LAST_OWNER (nothing written)', async () => {
    const e = await err(svc.disableUser(CTX, OWNER));
    expect(e).toBeInstanceOf(PlatformError); expect(e).toMatchObject({ code: 'conflict', reason: 'LAST_OWNER' });
    const u: any = (await sql`select status from users where id = ${OWNER}`.execute(db)).rows[0];
    expect(u.status).toBe('active');
  });
  it('demoting the only active owner → conflict LAST_OWNER', async () => {
    expect(await err(svc.setUserRole(CTX, OWNER, 'MANAGER'))).toMatchObject({ code: 'conflict', reason: 'LAST_OWNER' });
  });
  it('disabling a manager suspends them, revokes every live session and audits the change', async () => {
    await svc.disableUser(CTX, MGR);
    const s: any[] = (await sql`select status from sessions where user_id = ${MGR}`.execute(db)).rows;
    expect(s.map((x) => x.status)).toEqual(['revoked', 'revoked']);
    const a: any = (await sql`select action, after_state from authorization_audit_events where target_user_id = ${MGR}`.execute(db)).rows[0];
    expect(a).toMatchObject({ action: 'status.changed', after_state: { status: 'suspended' } });
  });
  it('a role change is audited with before / after', async () => {
    await svc.enableUser(CTX, MGR);
    await svc.setUserRole(CTX, MGR, 'FRONT_DESK');
    const a: any = (await sql`select before_state, after_state from authorization_audit_events where target_user_id = ${MGR} and action = 'role.base_changed'`.execute(db)).rows[0];
    expect(a).toEqual({ before_state: { role: 'MANAGER' }, after_state: { role: 'FRONT_DESK' } });
  });
});
