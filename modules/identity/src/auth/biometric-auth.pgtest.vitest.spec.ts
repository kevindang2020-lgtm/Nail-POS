// biometric-auth.pgtest — BUILD_PLAN Phase 13 D (Constitution 6 §37–39, audit bug 2): the biometric device credential on
// the real schema (migration 559). Face ID unlocks a long-lived device secret — never the access token — and the SERVER
// decides, every time, whether it still means a session.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselySessionStore } from './session-store';
import { KyselyAuthDevices } from './auth-devices';
import { KyselyBiometricCredentials, hashBiometricSecret } from './biometric-credentials';
import { BiometricAuth, BiometricHttpError } from './biometric-auth';
import { verifySession } from './auth-session-token';
import { sql } from 'kysely';

let pg: any; let db: any;
const T = 'b1b1b1b1-0000-4000-8000-0000000000a1';
const TECH = 'b1b1b1b1-0000-4000-8000-0000000000b1', CUST = 'b1b1b1b1-0000-4000-8000-0000000000c1';
const DEV = 'a'.repeat(32), OTHER_DEV = 'b'.repeat(32);
const SECRET = 'test-session-secret-0123456789abcdef';
const REQ = { ip: '203.0.113.5', userAgent: 'test', native: true, secret: SECRET, secure: false };

let authorize: (c: any) => Promise<any> = async () => ({ ok: true, permissions: ['pos.tech_queue.view'] });
let passkeysOff = false;
const core = () => new BiometricAuth({
  db, creds: new KyselyBiometricCredentials(db), login: { authorizeResume: (c) => authorize(c) },
  sessions: new KyselySessionStore(db), refresh: null, passkeysOff: async () => passkeysOff,
});
async function session(userId: string, opts: { strength?: string; ageSec?: number } = {}): Promise<string> {
  const sid = (await new KyselySessionStore(db).create({ userId, tenantId: T, branchId: null, deviceId: DEV, platform: 'ios', ttlSeconds: 3600, authStrength: opts.strength } as any))!;
  if (opts.ageSec) await pg.query(`UPDATE sessions SET last_primary_auth_at = now() - ($2 || ' seconds')::interval WHERE id = $1`, [sid, String(opts.ageSec)]);
  return sid;
}
const techSession = (sid: string) => ({ sid, userId: TECH, tenantId: T, branchId: null, role: 'TECHNICIAN', subscriptionStatus: 'active' });
async function enrolled(userId = TECH, device = DEV) {
  const sid = await session(userId);
  return core().enroll({ ...techSession(sid), userId, role: userId === CUST ? 'CUSTOMER' : 'TECHNICIAN' }, { deviceId: device, platform: 'ios', deviceName: 'iPhone · Tech' }, true);
}
async function expectCode(p: Promise<unknown>, code: string, status?: number) {
  const e: any = await p.then(() => null, (x) => x);
  expect(e, `expected ${code}`).toBeInstanceOf(BiometricHttpError);
  expect(e.code).toBe(code);
  if (status) expect(e.status).toBe(status);
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'B', 'B', 'bio-t', 'BIOT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES
      ('${TECH}', '${T}', 'Tia Tech', 'tia@bio.test', 'x', 'active', 'TECHNICIAN'),
      ('${CUST}', '${T}', 'Cara Customer', 'cara@bio.test', 'x', 'active', 'CUSTOMER') ON CONFLICT DO NOTHING`);
});

describe('enroll (signed in, native, recent password)', () => {
  it('a browser cannot enrol — the secret would land in JavaScript', async () => {
    const sid = await session(TECH);
    await expectCode(core().enroll(techSession(sid), { deviceId: DEV }, false), 'PERMISSION_DENIED', 403);
  });
  it('needs a PASSWORD sign-in (or step-up) in the last 10 minutes', async () => {
    const old = await session(TECH, { ageSec: 3600 });
    await expectCode(core().enroll(techSession(old), { deviceId: DEV }, true), 'BIOMETRIC_RECENT_AUTH_REQUIRED', 403);
    const viaFace = await session(TECH, { strength: 'biometric' });
    await expectCode(core().enroll(techSession(viaFace), { deviceId: DEV }, true), 'BIOMETRIC_RECENT_AUTH_REQUIRED', 403);   // Face ID never re-arms Face ID
    await pg.query(`UPDATE sessions SET last_step_up_at = now() WHERE id = $1`, [old]);
    await expect(core().enroll(techSession(old), { deviceId: DEV }, true)).resolves.toMatchObject({ ok: true });
  });
  it('returns a 256-bit secret once; the database holds only its hash', async () => {
    const out = await enrolled();
    expect(out.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await pg.query(`SELECT secret_hash, claims FROM device_biometric_credentials WHERE id = $1`, [out.credentialId])).rows[0];
    expect(row.secret_hash).toBe(hashBiometricSecret(out.secret));
    expect(JSON.stringify(row)).not.toContain(out.secret);
    expect(JSON.stringify(row.claims)).not.toMatch(/permissions|token|password/i);
  });
  it('re-enrolling the device replaces the previous credential', async () => {
    const a = await enrolled(); const b = await enrolled();
    expect((await pg.query(`SELECT status, revoked_reason FROM device_biometric_credentials WHERE id = $1`, [a.credentialId])).rows[0]).toEqual({ status: 'revoked', revoked_reason: 'replaced' });
    await expectCode(core().login({ credentialId: a.credentialId, deviceId: DEV, secret: a.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
    await expect(core().login({ credentialId: b.credentialId, deviceId: DEV, secret: b.secret }, REQ)).resolves.toBeTruthy();
  });
});

describe('login → a FRESH session, re-authorized now', () => {
  it('mints a new session (auth_strength biometric) with the token pair and a rotated secret', async () => {
    const e = await enrolled();
    const spec: any = await core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ);
    expect(spec.status).toBe(200);
    expect(spec.body.ok).toBe(false);   // technician with no branch → branch picker (ok:false, outcome BRANCH_SELECTION_REQUIRED)
    expect(spec.body.outcome).toBe('BRANCH_SELECTION_REQUIRED');
    expect(typeof spec.body.accessToken).toBe('string');
    const claims: any = verifySession(spec.body.accessToken, { secret: SECRET });
    expect(claims.valid).toBe(true);
    expect(claims.payload.permissions).toEqual(['pos.tech_queue.view']);    // from authorizeResume, never from storage
    const s = (await pg.query(`SELECT auth_strength, user_id FROM sessions WHERE id = $1`, [claims.payload.sid])).rows[0];
    expect(s).toEqual({ auth_strength: 'biometric', user_id: TECH });
    expect(spec.body.nextSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(spec.body.nextSecret).not.toBe(e.secret);
  });
  it('a customer gets SUCCESS straight away', async () => {
    const e = await enrolled(CUST);
    const spec: any = await core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ);
    expect(spec.body).toMatchObject({ ok: true, outcome: 'SUCCESS' });
  });
  it('the secret is single-use: replaying the spent one is theft — the credential is revoked for good', async () => {
    const e = await enrolled();
    const first: any = await core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ);
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_REUSED', 401);
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: first.body.nextSecret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
  });
  it('a copied secret on another device does nothing', async () => {
    const e = await enrolled();
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: OTHER_DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
  });
  it('a web caller is refused (native only)', async () => {
    const e = await enrolled();
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, { ...REQ, native: false }), 'PERMISSION_DENIED', 403);
  });
});

describe('revocation — every path that ends trust ends Face ID', () => {
  it('a password change after enrolment', async () => {
    const e = await enrolled();
    await pg.query(`UPDATE users SET password_changed_at = now() + interval '1 second' WHERE id = $1`, [TECH]);
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
    expect((await pg.query(`SELECT revoked_reason FROM device_biometric_credentials WHERE id = $1`, [e.credentialId])).rows[0].revoked_reason).toBe('password_changed');
    await pg.query(`UPDATE users SET password_changed_at = now() - interval '1 day' WHERE id = $1`, [TECH]);
  });
  it('a device revoked from Security → Devices', async () => {
    const devices = new KyselyAuthDevices(db);
    const d = await devices.recordSignIn(TECH, DEV, { name: 'iPhone', platform: 'ios' });
    if (d === 'refuse') throw new Error('unexpected');
    const sid = await session(TECH);
    await pg.query(`UPDATE sessions SET auth_device_id = $2 WHERE id = $1`, [sid, d.deviceId]);
    const e = await core().enroll(techSession(sid), { deviceId: DEV }, true);
    await devices.revoke(TECH, d.deviceId, 'revoked');
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
    expect((await pg.query(`SELECT status FROM device_biometric_credentials WHERE id = $1`, [e.credentialId])).rows[0].status).toBe('revoked');
  });
  it('sign-out from the device (revokeForDevice) and "turn Face ID off"', async () => {
    const e = await enrolled();
    expect(await new KyselyBiometricCredentials(db).revokeForDevice(TECH, DEV, 'logout')).toBe(1);
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
  });
  it('the account changed (authorizeResume refuses) → SESSION_ENDED and the credential is revoked', async () => {
    const e = await enrolled();
    authorize = async () => ({ ok: false, reason: 'role_changed' });
    try {
      await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'SESSION_ENDED', 401);
    } finally { authorize = async () => ({ ok: true, permissions: ['pos.tech_queue.view'] }); }
    expect((await pg.query(`SELECT status FROM device_biometric_credentials WHERE id = $1`, [e.credentialId])).rows[0].status).toBe('revoked');
  });
  it('the salon switched Face ID off', async () => {
    const e = await enrolled();
    passkeysOff = true;
    try { await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'POLICY_PASSKEYS_OFF', 403); } finally { passkeysOff = false; }
  });
  it('an expired credential', async () => {
    const e = await enrolled();
    await pg.query(`UPDATE device_biometric_credentials SET expires_at = now() - interval '1 minute' WHERE id = $1`, [e.credentialId]);
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
  });
  it('a suspended account', async () => {
    const e = await enrolled();
    await pg.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [TECH]);
    try { await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401); }
    finally { await pg.query(`UPDATE users SET status = 'active' WHERE id = $1`, [TECH]); }
  });
});

// Nov 5 2026 (Kevin; changes Constitution 6 §37) — migration 841: a normal sign-out on the phone KEEPS Face ID; every other
// way a session is revoked ends it (the trigger on sessions), so a remotely signed-out phone cannot sign back in by face.
describe('Face ID and sign-out (migration 841)', () => {
  const status = async (id: string) => (await pg.query(`SELECT status, revoked_reason FROM device_biometric_credentials WHERE id = $1`, [id])).rows[0];
  it('the phone\'s own sign-out (aps.keep_face_id) keeps the credential, and Face ID signs back in', async () => {
    const e = await enrolled();
    const sid = await session(TECH);
    await db.transaction().execute(async (trx: any) => {
      await sql`select set_config('aps.keep_face_id', 'on', true)`.execute(trx);   // exactly what POST /auth/logout does
      await sql`update sessions set status = 'revoked', revoked_at = now() where id = ${sid}`.execute(trx);
    });
    expect(await status(e.credentialId)).toEqual({ status: 'active', revoked_reason: null });
    await expect(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ)).resolves.toBeTruthy();
  });
  it('the flag is transaction-local: a later revoke on the same connection still ends Face ID', async () => {
    const e = await enrolled();
    await new KyselySessionStore(db).revoke(await session(TECH));
    expect(await status(e.credentialId)).toEqual({ status: 'revoked', revoked_reason: 'session_revoked' });
  });
  it('a session revoked from elsewhere (sign out other devices, Super Admin, theft) ends Face ID on that phone', async () => {
    const e = await enrolled();
    const sid = await session(TECH);
    await pg.query(`UPDATE sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [sid]);
    expect(await status(e.credentialId)).toEqual({ status: 'revoked', revoked_reason: 'session_revoked' });
    await expectCode(core().login({ credentialId: e.credentialId, deviceId: DEV, secret: e.secret }, REQ), 'BIOMETRIC_CREDENTIAL_INVALID', 401);
  });
  it('revoking a session on ANOTHER phone leaves this phone\'s Face ID alone', async () => {
    const e = await enrolled();
    const other = (await new KyselySessionStore(db).create({ userId: TECH, tenantId: T, branchId: null, deviceId: OTHER_DEV, platform: 'ios', ttlSeconds: 3600 } as any))!;
    await pg.query(`UPDATE sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [other]);
    expect(await status(e.credentialId)).toEqual({ status: 'active', revoked_reason: null });
  });
});
