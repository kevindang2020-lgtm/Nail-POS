// security-notifications.vitest.spec.ts — Constitution 3 Step 10a: new-device alert + "This wasn't me".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { MockEmailSender } from '@aipowersalon/notifications';
import { SecurityNotifications, newDeviceEmail } from './security-notifications';
import { KyselyAuthDevices, newWebDeviceKey } from './auth-devices';

describe('the alert email', () => {
  it('names the device, time and address, and carries the one-time link — no secrets', () => {
    const m = newDeviceEmail({ deviceName: 'Chrome on Windows', ip: '203.0.113.9', whenIso: '2026-10-03T23:00:00Z', notMeUrl: 'https://pos.example/security/not-me?token=nm_x' });
    expect(m.subject).toMatch(/New sign-in/); expect(m.body).toContain('Chrome on Windows'); expect(m.body).toContain('203.0.113.9'); expect(m.body).toContain('nm_x');
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a8200000-0000-4000-8000-0000000000a1', B = 'b8200000-0000-4000-8000-0000000000b1', U = 'c8200000-0000-4000-8000-0000000000c1';
describe.skipIf(!url)('new-device alerts on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool; let mail: MockEmailSender; let n: SecurityNotifications; let devices: KyselyAuthDevices;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'NM', 'NM', 'nm-salon', 'NMSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${U}, ${T}, ${B}, 'nm-owner@example.test', 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
    await sql`delete from auth_devices where user_id = ${U}`.execute(db); await sql`delete from user_login_alert_prefs where user_id = ${U}`.execute(db);
    mail = new MockEmailSender(); n = new SecurityNotifications(db, mail, { APP_BASE_URL: 'https://pos.example' } as any); devices = new KyselyAuthDevices(db);
  });
  afterAll(async () => { await sql`delete from security_not_me_tokens where user_id = ${U}`.execute(db).catch(() => undefined); await sql`delete from sessions where user_id = ${U}`.execute(db).catch(() => undefined); await sql`delete from auth_devices where user_id = ${U}`.execute(db).catch(() => undefined); await sql`delete from user_login_alert_prefs where user_id = ${U}`.execute(db).catch(() => undefined); await db?.destroy(); });
  const signIn = async (key: string, name: string) => { const d: any = await devices.recordSignIn(U, key, { name }); return n.onSignIn({ userId: U, tenantId: T, deviceId: d.deviceId, isNew: d.isNew, hadOtherDevices: d.hadOtherDevices, deviceName: name, ip: '203.0.113.9' }).then((sent) => ({ sent, d })); };

  it('the first device ever: no alert; the same device again: no alert; a NEW second device: an alert', async () => {
    const home = newWebDeviceKey();
    expect((await signIn(home, 'Home Mac')).sent).toBe(false);
    expect((await signIn(home, 'Home Mac')).sent).toBe(false);
    expect((await signIn(newWebDeviceKey(), 'Unknown PC')).sent).toBe(true);
    expect(mail.sent).toHaveLength(1); expect(mail.sent[0].to).toBe('nm-owner@example.test'); expect(mail.sent[0].body).toContain('Unknown PC');
  });
  it('the user’s preference (new-device alerts off) is respected', async () => {
    await sql`insert into user_login_alert_prefs (tenant_id, user_id, new_device) values (${T}, ${U}, false) on conflict (tenant_id, user_id) do update set new_device = false`.execute(db);
    expect((await signIn(newWebDeviceKey(), 'Another')).sent).toBe(false);
    await sql`delete from user_login_alert_prefs where user_id = ${U}`.execute(db);
  });
  it('"This wasn\'t me": blocks that device, ends EVERY session, works once', async () => {
    mail.sent.length = 0;
    const { d } = await signIn(newWebDeviceKey(), 'Intruder');
    const token = /token=([^\s]+)/.exec(mail.sent[0].body)![1];
    for (let i = 0; i < 2; i++) await sql`insert into sessions (user_id, tenant_id, status, expires_at) values (${U}::uuid, ${T}::uuid, 'active', now() + interval '1 hour')`.execute(db);
    const r: any = await n.notMe(decodeURIComponent(token));
    expect(r).toMatchObject({ ok: true, userId: U }); expect(r.sessionsEnded).toBeGreaterThanOrEqual(2);
    expect(((await sql`select count(*)::int as n from sessions where user_id = ${U}::uuid and revoked_at is null`.execute(db)).rows[0] as any).n).toBe(0);
    expect(((await sql`select trust_state from auth_devices where id = ${d.deviceId}::uuid`.execute(db)).rows[0] as any).trust_state).toBe('blocked');
    expect(await n.notMe(decodeURIComponent(token))).toEqual({ ok: false, reason: 'used' });
    expect(await n.notMe('nm_forged_forged_forged')).toEqual({ ok: false, reason: 'invalid' });
  });
});
