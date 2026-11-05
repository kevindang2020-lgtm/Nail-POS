// auth-devices.vitest.spec.ts — Constitution 3 §21–24 (Step 4): device trust states; real Postgres for the ledger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { stateOnSignIn, validDeviceKey, newWebDeviceKey, KyselyAuthDevices, DeviceError, hashDeviceKey } from './auth-devices';

const NOW = Date.parse('2026-10-03T22:00:00Z');
describe('device trust — the rule', () => {
  it('new → recognized on the second sign-in; trusted stays trusted until it lapses; revoked starts again as new; blocked refuses', () => {
    expect(stateOnSignIn(null, NOW)).toBe('new');
    expect(stateOnSignIn({ trustState: 'new', trustedUntilMs: null }, NOW)).toBe('recognized');
    expect(stateOnSignIn({ trustState: 'trusted', trustedUntilMs: NOW + 1000 }, NOW)).toBe('trusted');
    expect(stateOnSignIn({ trustState: 'trusted', trustedUntilMs: NOW - 1 }, NOW)).toBe('recognized');
    expect(stateOnSignIn({ trustState: 'revoked', trustedUntilMs: null }, NOW)).toBe('new');
    expect(stateOnSignIn({ trustState: 'blocked', trustedUntilMs: null }, NOW)).toBe('refuse');
    expect(stateOnSignIn({ trustState: 'suspicious', trustedUntilMs: null }, NOW)).toBe('suspicious');
  });
  it('device keys: bounded and printable; web keys are random', () => {
    expect(validDeviceKey(newWebDeviceKey())).toBe(true); expect(newWebDeviceKey()).not.toBe(newWebDeviceKey());
    expect(validDeviceKey('short')).toBe(false); expect(validDeviceKey('<script>alert(1)</script>xxxxxxxx')).toBe(false); expect(validDeviceKey(42)).toBe(false);
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a7d00000-0000-4000-8000-0000000000a1', B = 'b7d00000-0000-4000-8000-0000000000b1', U = 'c7d00000-0000-4000-8000-0000000000c1', U2 = 'c7d00000-0000-4000-8000-0000000000c2';
describe.skipIf(!url)('devices on real Postgres (migration 496)', () => {
  let db: Kysely<any>; let pool: pg.Pool; let devices: KyselyAuthDevices;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); devices = new KyselyAuthDevices(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'DV', 'DV', 'dv-salon', 'DVSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    for (const [u, e] of [[U, 'dv1@example.test'], [U2, 'dv2@example.test']]) await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${u}, ${T}, ${B}, ${e}, 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
    await sql`delete from auth_devices where user_id in (${U}, ${U2})`.execute(db);
  });
  afterAll(async () => { await sql`delete from refresh_tokens where user_id in (${U}, ${U2})`.execute(db).catch(() => undefined); await sql`delete from sessions where user_id in (${U}, ${U2})`.execute(db).catch(() => undefined); await sql`delete from auth_devices where user_id in (${U}, ${U2})`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('sign-ins: new then recognized; the key is stored only as a hash; another user with the same key is a separate device', async () => {
    const key = newWebDeviceKey();
    const a: any = await devices.recordSignIn(U, key, { name: 'Chrome on Mac', platform: 'web', ip: '10.0.0.1' });
    expect((await devices.list(U))[0]).toMatchObject({ id: a.deviceId, trustState: 'new', signInCount: 1 });
    await devices.recordSignIn(U, key, {});
    expect((await devices.list(U))[0]).toMatchObject({ trustState: 'recognized', signInCount: 2, name: 'Chrome on Mac' });
    const raw: any = (await sql`select device_key_hash from auth_devices where id = ${a.deviceId}::uuid`.execute(db)).rows[0];
    expect(raw.device_key_hash).toBe(hashDeviceKey(key)); expect(JSON.stringify(raw)).not.toContain(key);
    const other: any = await devices.recordSignIn(U2, key, {});
    expect(other.deviceId).not.toBe(a.deviceId);
  });
  it('trust needs an MFA-verified session and ALWAYS expires; the table refuses trusted-forever', async () => {
    const key = newWebDeviceKey(); const d: any = await devices.recordSignIn(U, key, {});
    await expect(devices.trust(U, d.deviceId, { mfaAt: null })).rejects.toBeInstanceOf(DeviceError);
    const t = await devices.trust(U, d.deviceId, { mfaAt: new Date().toISOString() });
    expect(t.trustState).toBe('trusted'); expect(Date.parse(t.trustedUntil!)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await expect(devices.trust(U2, d.deviceId, { mfaAt: new Date().toISOString() })).rejects.toBeInstanceOf(DeviceError);   // not their device
    await expect(sql`update auth_devices set trusted_until = null where id = ${d.deviceId}::uuid`.execute(db)).rejects.toThrow(/auth_devices_trusted_until_check/);
  });
  it('revoke ends the device’s sessions and their refresh tokens; block also refuses the next sign-in until unblocked', async () => {
    const key = newWebDeviceKey(); const d: any = await devices.recordSignIn(U, key, {});
    const sid = String(((await sql`insert into sessions (user_id, tenant_id, status, expires_at, auth_device_id) values (${U}::uuid, ${T}::uuid, 'active', now() + interval '1 hour', ${d.deviceId}::uuid) returning id`.execute(db)).rows[0] as any).id);
    await sql`insert into refresh_tokens (session_id, user_id, token_hash, expires_at) values (${sid}::uuid, ${U}::uuid, ${'h-' + sid}, now() + interval '1 hour')`.execute(db);
    expect(await devices.revoke(U, d.deviceId, 'blocked')).toEqual({ sessionsEnded: 1 });
    const s: any = (await sql`select revoked_at from sessions where id = ${sid}::uuid`.execute(db)).rows[0]; expect(s.revoked_at).not.toBeNull();
    const rt: any = (await sql`select revoked_at from refresh_tokens where session_id = ${sid}::uuid`.execute(db)).rows[0]; expect(rt.revoked_at).not.toBeNull();
    expect(await devices.recordSignIn(U, key, {})).toBe('refuse');
    await devices.unblock(U, d.deviceId);
    expect(await devices.recordSignIn(U, key, {})).not.toBe('refuse');
    expect((await devices.list(U)).find((x) => x.id === d.deviceId)?.trustState).toBe('new');   // a fresh start, not trusted again
  });
});
