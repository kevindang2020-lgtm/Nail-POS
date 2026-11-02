// credential-actions.pgtest.vitest.spec.ts — Security Deep Scan C2 / C3 / A3 / C7 (Oct 23 2026), real schema (PGlite).
//   C2: a Super Admin-initiated password reset (salon owner or any user) never returns the password — it is delivered to
//       the account holder's own email / phone; a reason is required; no channel → CANNOT_DELIVER and nothing changes.
//   A3: the generic Users routes refuse a platform account of equal or higher rank (disable / enable / reset / resend).
//   C3: POST /platform/users (createSuperAdmin) is retired (410); a platform invite needs platform_roles.manage.
//   C7: the routes carry @RequireStepUp (server-enforced by the API's global StepUpGuard).
// Each case fails on the pre-fix code: the password came back in the response, any account (a PLATFORM_SUPER_ADMIN too)
// could be disabled / reset by a PLATFORM_ADMIN, and none of these routes asked for step-up.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { verifyPassword } from '@aipowersalon/auth';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { STEP_UP_META } from '@aipowersalon/permissions/guards';
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';
import { SuperAdminPlatformController } from './super-admin-platform.controller';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';
import { platformHierarchyDecision } from './platform-user-hierarchy';
import { AccountHolderCredentialDelivery, kyselyCredentialStore, chooseChannel } from '../admin-credential-delivery';
import { SuperAdminTenantsService } from '../super-admin-tenants/super-admin-tenants.service';
import { KyselySuperAdminTenantsRepo } from '../super-admin-tenants/super-admin-tenants.kysely.repository';
import { SuperAdminTenantsController } from '../super-admin-tenants/super-admin-tenants.controller';

const T = 'c2c20000-0000-4000-8000-0000000000a1';
const OWNER = 'c2c20000-0000-4000-8000-0000000000b1', TECH_NO_CONTACT = 'c2c20000-0000-4000-8000-0000000000b2';
const PSA = 'c2c20000-0000-4000-8000-0000000000c1', PSA2 = 'c2c20000-0000-4000-8000-0000000000c2', PADMIN = 'c2c20000-0000-4000-8000-0000000000c3', PSUPPORT = 'c2c20000-0000-4000-8000-0000000000c4';
const REASON = 'Owner called support and was verified';
let db: any;
const outbox: { to: string; text: string }[] = [];
const senders = {
  email: { async send(to: string, subject: string, body: string) { outbox.push({ to, text: subject + '\n' + body }); return { id: 'em-1' }; } },
  sms: { async send(to: string, body: string) { outbox.push({ to, text: body }); return { sid: 'sm-1' }; } },
};
const ctxOf = (userId: string, role: string) => ({ userId, email: `${role}@x.test`, permissions: platformPermissionsFor(role) as string[] });
const err = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const row = async (id: string) => (await sql<any>`select password_hash, temp_password_hash, temp_password_delivery, must_change_password, status from users where id = ${id}`.execute(db)).rows[0];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','C2 LLC','C2 Nails','c2-nails','C2NAILS','active');
    INSERT INTO users (id, tenant_id, full_name, email, normalized_phone, password_hash, status, role) VALUES
      ('${OWNER}','${T}','Olive Owner','olive@c2.test','+18565550101','orig-hash','active','OWNER'),
      ('${TECH_NO_CONTACT}','${T}','No Contact',NULL,NULL,'orig-hash','active','TECHNICIAN');
    UPDATE tenants SET owner_user_id = '${OWNER}' WHERE id = '${T}';
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role, platform_role) VALUES
      ('${PSA}', NULL, 'Top One', 'top1@x.test', 'orig-hash', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'),
      ('${PSA2}', NULL, 'Top Two', 'top2@x.test', 'orig-hash', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'),
      ('${PADMIN}', NULL, 'Admin', 'admin@x.test', 'orig-hash', 'active', 'SUPER_ADMIN', 'PLATFORM_ADMIN'),
      ('${PSUPPORT}', NULL, 'Support', 'support@x.test', 'orig-hash', 'active', 'SUPER_ADMIN', 'PLATFORM_SUPPORT');`);
}, 120_000);

const delivery = () => new AccountHolderCredentialDelivery(kyselyCredentialStore(db), senders);
const platform = () => new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(db), db, undefined, undefined, undefined, delivery());

describe('C2 — the owner reset reaches the owner only', () => {
  it('never returns the password; it is sent to the owner and works only as the temporary password', async () => {
    const svc = new SuperAdminTenantsService(new KyselySuperAdminTenantsRepo(db), undefined, undefined, delivery());
    outbox.length = 0;
    const out: any = await svc.resetOwnerPassword(T, { userId: PADMIN }, { reason: REASON });
    expect(out).toMatchObject({ ok: true, delivery: 'email', sentTo: 'o***@c2.test' });
    expect(out).not.toHaveProperty('temporaryPassword');
    expect(outbox).toHaveLength(1); expect(outbox[0].to).toBe('olive@c2.test');
    const temp = /temporary password is: (\S+)/.exec(outbox[0].text)![1];
    expect(JSON.stringify(out)).not.toContain(temp);
    const u = await row(OWNER);
    expect(await verifyPassword(temp, u.temp_password_hash)).toBe(true);   // the temp-password sign-in flow's column
    expect(u.password_hash).toBe('orig-hash');                             // the owner was NOT moved to a caller-known password
    expect(u).toMatchObject({ must_change_password: true, temp_password_delivery: 'email', status: 'active' });
    const audit: any = (await sql`select metadata_json from audit_logs where action_type = 'super_admin_tenant_owner_password_reset' and entity_id = ${T} order by created_at desc limit 1`.execute(db)).rows[0];
    expect(audit.metadata_json).toMatchObject({ reason: REASON, delivery: 'email' });
    expect(JSON.stringify(audit.metadata_json)).not.toContain(temp);
  });
  it('a reason is required, and SMS goes to the owner\'s own phone when asked', async () => {
    const svc = new SuperAdminTenantsService(new KyselySuperAdminTenantsRepo(db), undefined, undefined, delivery());
    expect(await svc.resetOwnerPassword(T, {}, { reason: 'short' })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    outbox.length = 0;
    expect(await svc.resetOwnerPassword(T, {}, { reason: REASON, deliveryMethod: 'sms' })).toMatchObject({ ok: true, delivery: 'sms', sentTo: '***0101' });
    expect(outbox[0].to).toBe('+18565550101');
  });
  it('a platform account set as a salon owner is refused', async () => {
    await sql`update tenants set owner_user_id = ${PSA2} where id = ${T}`.execute(db);
    const svc = new SuperAdminTenantsService(new KyselySuperAdminTenantsRepo(db), undefined, undefined, delivery());
    const before = await row(PSA2);
    expect(await svc.resetOwnerPassword(T, {}, { reason: REASON })).toMatchObject({ ok: false, code: 'PLATFORM_ACCOUNT_TARGET' });
    expect((await row(PSA2)).temp_password_hash).toBe(before.temp_password_hash);
    await sql`update tenants set owner_user_id = ${OWNER} where id = ${T}`.execute(db);
  });
});

describe('C2 / A3 — platform user reset, disable, enable', () => {
  it('reset: reason required, delivered to the holder, never returned', async () => {
    const svc = platform();
    expect(await err(svc.resetUserPassword(ctxOf(PADMIN, 'PLATFORM_ADMIN'), OWNER, {}))).toMatchObject({ code: 'invalid', reason: 'REASON_REQUIRED' });
    outbox.length = 0;
    const out: any = await svc.resetUserPassword(ctxOf(PADMIN, 'PLATFORM_ADMIN'), OWNER, { reason: REASON });
    expect(out).toMatchObject({ ok: true, delivery: 'email' }); expect(out).not.toHaveProperty('temporaryPassword');
    expect(outbox[0].to).toBe('olive@c2.test');
  });
  it('no email / phone on file → CANNOT_DELIVER and nothing changed', async () => {
    const e = await err(platform().resetUserPassword(ctxOf(PADMIN, 'PLATFORM_ADMIN'), TECH_NO_CONTACT, { reason: REASON }));
    expect(e).toBeInstanceOf(PlatformError); expect(e).toMatchObject({ code: 'unavailable', reason: 'CANNOT_DELIVER' });
    expect((await row(TECH_NO_CONTACT)).temp_password_hash).toBeNull();
  });
  it('a failed send withdraws the temporary password (DELIVERY_FAILED)', async () => {
    const broken = new AccountHolderCredentialDelivery(kyselyCredentialStore(db), { ...senders, email: { async send() { throw new Error('sendgrid down'); } } });
    const svc = new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(db), db, undefined, undefined, undefined, broken);
    await sql`update users set temp_password_hash = null where id = ${PSUPPORT}`.execute(db);
    expect(await err(svc.resetUserPassword(ctxOf(PADMIN, 'PLATFORM_ADMIN'), PSUPPORT, { reason: REASON }))).toMatchObject({ reason: 'DELIVERY_FAILED' });
    expect((await row(PSUPPORT)).temp_password_hash).toBeNull();
  });
  it('a PLATFORM_ADMIN cannot reset / disable / enable / resend / sign out a PLATFORM_SUPER_ADMIN; a peer cannot either', async () => {
    const svc = platform(); const admin = ctxOf(PADMIN, 'PLATFORM_ADMIN'); const top = ctxOf(PSA, 'PLATFORM_SUPER_ADMIN');
    for (const p of [svc.resetUserPassword(admin, PSA, { reason: REASON }), svc.disableUser(admin, PSA), svc.enableUser(admin, PSA), svc.resendInvite(admin, PSA), svc.revokeAllUserSessions(admin, PSA),
      svc.disableUser(top, PSA2), svc.resetUserPassword(top, PSA2, { reason: REASON }), svc.disableUser(admin, PADMIN)])
      expect(await err(p)).toMatchObject({ code: expect.stringMatching(/forbidden|invalid/) });
    expect((await row(PSA)).status).toBe('active'); expect((await row(PSA2)).status).toBe('active');
    expect((await row(PSA)).temp_password_hash).toBeNull();
  });
  it('a higher rank may act on a lower one (PLATFORM_SUPER_ADMIN → PLATFORM_SUPPORT)', async () => {
    const out = await platform().disableUser(ctxOf(PSA, 'PLATFORM_SUPER_ADMIN'), PSUPPORT);
    expect(out).toMatchObject({ status: 'suspended' });
  });
});

describe('C3 — platform accounts only by invitation', () => {
  it('createSuperAdmin is retired (gone), and a users.manage-only admin cannot invite a platform account', async () => {
    const svc = platform();
    expect(await err(svc.createSuperAdmin(ctxOf(PSA, 'PLATFORM_SUPER_ADMIN'), { email: 'n@x.test', fullName: 'New' }))).toMatchObject({ code: 'gone' });
    expect(await err(svc.inviteUser(ctxOf(PADMIN, 'PLATFORM_ADMIN'), { email: 'n@x.test', fullName: 'New One', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_AUDITOR' }))).toMatchObject({ code: 'forbidden' });
    expect(Number((await sql<any>`select count(*)::int as n from users where email = 'n@x.test'`.execute(db)).rows[0].n)).toBe(0);
  });
});

describe('pure rules', () => {
  it('hierarchy: strict outrank only; salon accounts unaffected; never yourself', () => {
    const admin = { userId: 'a', permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };
    expect(platformHierarchyDecision(admin, { id: 't', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPER_ADMIN' }, 'x').ok).toBe(false);
    expect(platformHierarchyDecision(admin, { id: 't', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_ADMIN' }, 'x').ok).toBe(false);
    expect(platformHierarchyDecision(admin, { id: 't', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT' }, 'x').ok).toBe(true);
    expect(platformHierarchyDecision(admin, { id: 't', role: 'SUPER_ADMIN', platformRole: null }, 'x').ok).toBe(true);   // read-only fallback
    expect(platformHierarchyDecision(admin, { id: 't', role: 'OWNER' }, 'x').ok).toBe(true);
    expect(platformHierarchyDecision(admin, { id: 'a', role: 'OWNER' }, 'x').ok).toBe(false);
  });
  it('channel choice: a named channel only if the account has it; auto prefers email', () => {
    expect(chooseChannel('auto', true, true)).toBe('email'); expect(chooseChannel('auto', false, true)).toBe('sms');
    expect(chooseChannel('sms', true, false)).toBeNull(); expect(chooseChannel('auto', false, false)).toBeNull();
  });
});

describe('C7 — these routes require a fresh step-up (server-enforced)', () => {
  const stepUp = (proto: any, m: string) => Reflect.getMetadata(STEP_UP_META, proto[m]);
  it.each(['inviteUser', 'createInvitation', 'disableUser', 'enableUser', 'resetUserPassword', 'resendInvite', 'revokeAllUserSessions', 'approveAccessRequest'])('platform %s', (m) => {
    expect(stepUp(SuperAdminPlatformController.prototype, m)).toBeGreaterThan(0);
  });
  it.each(['resetOwnerPassword', 'suspend', 'reactivate', 'pauseGateway', 'resumeGateway', 'disableGateway', 'rotateWebhookSecret'])('tenants %s', (m) => {
    expect(stepUp(SuperAdminTenantsController.prototype, m)).toBeGreaterThan(0);
  });
});
