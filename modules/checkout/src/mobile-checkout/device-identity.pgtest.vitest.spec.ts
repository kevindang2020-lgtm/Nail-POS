// device-identity.pgtest — Secure Tap to Pay mandate §4 / §7 / §9 / §16 / §58 / §70 on the REAL migrated schema (687):
// the key is set once and unique across the platform, a nonce is accepted once, a pairing code is single-use and expires,
// a device's branches cannot name another salon's branch, and revoking a phone revokes its sessions and refresh tokens.
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMobilePayDeviceStore } from './mobile-pay-device.kysely';
import { DeviceKeyMismatchError, DeviceBindingError } from './mobile-pay-device';
import { KyselyDevicePairingStore, pairingHash } from './device-pairing';
import { keyFingerprint } from './device-proof';

let pg: any; let db: any; let store: KyselyMobilePayDeviceStore; let pairings: KyselyDevicePairingStore;
const TA = 'd6870000-0000-4000-8000-00000000000a', TB = 'd6870000-0000-4000-8000-00000000000b';
const BA = 'd6871000-0000-4000-8000-00000000000a', BA2 = 'd6871000-0000-4000-8000-0000000000a2', BB = 'd6871000-0000-4000-8000-00000000000b';
const UA = 'd6872000-0000-4000-8000-00000000000a', UA2 = 'd6872000-0000-4000-8000-0000000000a2';
const key = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  store = new KyselyMobilePayDeviceStore(db); pairings = new KyselyDevicePairingStore(db);
  for (const [t, code] of [[TA, 'D687A'], [TB, 'D687B']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A1'), ('${BA2}', '${TA}', 'A2'), ('${BB}', '${TB}', 'B1')`);
  await pg.exec(`INSERT INTO users (id, tenant_id, email, full_name, role, status) VALUES ('${UA}', '${TA}', 'mgr@d687.test', 'Mgr', 'MANAGER', 'active'), ('${UA2}', '${TA}', 'mgr2@d687.test', 'Mgr B', 'MANAGER', 'active')`);
}, 120_000);

describe('payment device identity on Postgres (migration 687)', () => {
  it('§4 / §18: the key is set once; a different key for the device id is refused; §58: one key cannot belong to two devices', async () => {
    const k1 = key();
    const r = await store.upsertOnRegister(TA, { deviceId: 'phone-1', branchId: BA, registeredBy: UA, publicKey: k1, keyFingerprint: keyFingerprint(k1) });
    expect(r).toMatchObject({ publicKey: k1, keyFingerprint: keyFingerprint(k1), status: 'pending', attestationStatus: 'none' });
    await expect(store.upsertOnRegister(TA, { deviceId: 'phone-1', registeredBy: UA, publicKey: key() })).rejects.toBeInstanceOf(DeviceKeyMismatchError);
    expect((await store.upsertOnRegister(TA, { deviceId: 'phone-1', registeredBy: UA, appVersion: '2.0' })).publicKey).toBe(k1);   // a re-register without a key keeps it
    await expect(store.upsertOnRegister(TA, { deviceId: 'phone-copy', registeredBy: UA, publicKey: k1, keyFingerprint: keyFingerprint(k1) })).rejects.toBeInstanceOf(DeviceKeyMismatchError);
    expect(Number((await one(`select count(*)::int n from mobile_pay_devices where key_fingerprint = $1`, [keyFingerprint(k1)])).n)).toBe(1);
  });

  it('§70: a nonce is accepted once per device', async () => {
    expect(await store.consumeNonce(TA, 'phone-1', 'nonce-aaaaaaaaaaaaaaaa')).toBe(true);
    expect(await store.consumeNonce(TA, 'phone-1', 'nonce-aaaaaaaaaaaaaaaa')).toBe(false);
    expect(await store.consumeNonce(TA, 'phone-2', 'nonce-aaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('§7 / §70: a pairing code is single-use, tenant-scoped and expires; only its hash is stored', async () => {
    const code = 'pairing-code-' + Date.now();
    const p = await pairings.create({ tenantId: TA, branchId: BA, createdBy: UA, codeHash: pairingHash(code), expiresAt: new Date(Date.now() + 60_000) });
    expect(JSON.stringify(await one(`select * from payment_device_pairings where id = $1`, [p.id]))).not.toContain(code);
    expect(await pairings.consume(TB, pairingHash(code), { userId: UA, deviceId: 'x' }, new Date())).toBeNull();      // another salon
    expect(await pairings.consume(TA, pairingHash(code), { userId: UA, deviceId: 'x' }, new Date())).toMatchObject({ branchId: BA });
    expect(await pairings.consume(TA, pairingHash(code), { userId: UA, deviceId: 'y' }, new Date())).toBeNull();      // replay
    const late = 'late-' + Date.now();
    await pairings.create({ tenantId: TA, branchId: BA, createdBy: UA, codeHash: pairingHash(late), expiresAt: new Date(Date.now() + 1000) });
    expect(await pairings.consume(TA, pairingHash(late), { userId: UA, deviceId: 'z' }, new Date(Date.now() + 5000))).toBeNull();   // expired
    // a paired phone lands active in the pairing's branch, approved by the code's creator
    const k = key();
    const r = await store.upsertOnRegister(TA, { deviceId: 'paired', registeredBy: UA, publicKey: k, keyFingerprint: keyFingerprint(k), pairing: { branchId: BA2, approvedBy: UA } });
    expect(r).toMatchObject({ status: 'active', branchId: BA2, pairedVia: 'pos_qr' });
  });

  it('§9: a device\'s branches are this salon\'s only (the tenant-consistency trigger refuses another salon\'s branch)', async () => {
    expect((await store.setAllowedBranches(TA, 'phone-1', [BA, BA2], UA))!.allowedBranchIds!.sort()).toEqual([BA, BA2].sort());
    await expect(store.setAllowedBranches(TA, 'phone-1', [BB], UA)).rejects.toBeTruthy();
    expect((await store.get(TA, 'phone-1'))!.allowedBranchIds!.sort()).toEqual([BA, BA2].sort());   // unchanged (one transaction)
    expect((await store.setAllowedBranches(TA, 'phone-1', [], UA))!.allowedBranchIds).toEqual([]);
  });

  it('§16: revoking a phone revokes every session opened on it and their refresh tokens; other phones keep theirs', async () => {
    const s1 = (await one(`insert into sessions (user_id, tenant_id, device_id, expires_at) values ($1, $2, 'phone-1', now() + interval '1 day') returning id`, [UA, TA])).id;
    const s2 = (await one(`insert into sessions (user_id, tenant_id, device_id, expires_at) values ($1, $2, 'phone-other', now() + interval '1 day') returning id`, [UA, TA])).id;
    await pg.query(`insert into refresh_tokens (session_id, user_id, token_hash, expires_at) values ($1, $2, 'h1-687', now() + interval '30 days'), ($3, $2, 'h2-687', now() + interval '30 days')`, [s1, UA, s2]);
    expect(await store.revokeDeviceSessions(TA, 'phone-1')).toBe(1);
    expect(await one(`select status, revoked_at is not null as revoked from sessions where id = $1`, [s1])).toMatchObject({ status: 'revoked', revoked: true });
    expect((await one(`select revoked_at is not null as revoked from refresh_tokens where session_id = $1`, [s1])).revoked).toBe(true);
    expect((await one(`select revoked_at is null as live from sessions where id = $1`, [s2])).live).toBe(true);
    expect(await store.revokeDeviceSessions(TB, 'phone-other')).toBe(0);   // another salon cannot touch them
  });

  it('M6-5 (live pilot): the revoked sessions are also ended in the API\'s session store (its 15 s live cache no longer lets them through)', async () => {
    const told: string[] = [];
    const withStore = new KyselyMobilePayDeviceStore(db, () => ({ revoke: async (id: string) => { told.push(id); } }));
    const s3 = (await one(`insert into sessions (user_id, tenant_id, device_id, expires_at) values ($1, $2, 'phone-m65', now() + interval '1 day') returning id`, [UA, TA])).id;
    const s4 = (await one(`insert into sessions (user_id, tenant_id, device_id, expires_at) values ($1, $2, 'phone-m65', now() + interval '1 day') returning id`, [UA2, TA])).id;
    expect(await withStore.revokeDeviceSessions(TA, 'phone-m65')).toBe(2);
    expect(told.sort()).toEqual([String(s3), String(s4)].sort());
    // a store that cannot be reached never undoes the DB revocation
    const broken = new KyselyMobilePayDeviceStore(db, () => ({ revoke: async () => { throw new Error('down'); } }));
    const s5 = (await one(`insert into sessions (user_id, tenant_id, device_id, expires_at) values ($1, $2, 'phone-m65b', now() + interval '1 day') returning id`, [UA, TA])).id;
    expect(await broken.revokeDeviceSessions(TA, 'phone-m65b')).toBe(1);
    expect((await one(`select status from sessions where id = $1`, [s5])).status).toBe('revoked');
  });

  it('§18: a revoked device never becomes active again', async () => {
    await store.setStatus(TA, 'phone-1', 'active', UA);
    await store.setStatus(TA, 'phone-1', 'revoked', UA, 'lost');
    expect((await store.setStatus(TA, 'phone-1', 'active', UA))!.status).toBe('revoked');
  });

  it('§14 / §77 (migration 688): a shared salon phone takes Manager B after Manager A; a personal phone refuses another user', async () => {
    const code = 'shared-' + Date.now();
    await pairings.create({ tenantId: TA, branchId: BA, createdBy: UA, codeHash: pairingHash(code), expiresAt: new Date(Date.now() + 60_000), shared: true });
    const pr = await pairings.consume(TA, pairingHash(code), { userId: UA, deviceId: 'front-desk' }, new Date());
    expect(pr).toMatchObject({ shared: true });
    const k = key();
    const r = await store.upsertOnRegister(TA, { deviceId: 'front-desk', registeredBy: UA, publicKey: k, keyFingerprint: keyFingerprint(k), pairing: { branchId: BA, approvedBy: UA, shared: true } });
    expect(r).toMatchObject({ shared: true, status: 'active' });
    const again = await store.upsertOnRegister(TA, { deviceId: 'front-desk', registeredBy: UA2, appVersion: '2.1' });   // Manager B signs in on it
    expect(again).toMatchObject({ shared: true, status: 'active', publicKey: k });
    // personal phone: bound to its first user
    const kp = key();
    await store.upsertOnRegister(TA, { deviceId: 'personal', registeredBy: UA, publicKey: kp, keyFingerprint: keyFingerprint(kp) });
    await expect(store.upsertOnRegister(TA, { deviceId: 'personal', registeredBy: UA2 })).rejects.toBeInstanceOf(DeviceBindingError);
    expect((await store.get(TA, 'personal'))!.boundUserId).toBe(UA);
  });
});

describe('Oct 26 2026: §15 rename and §5 attestation on Postgres', () => {
  it('§15: the owner\'s rename sticks — a phone re-registering with its own name never overwrites it; another salon\'s phone is untouched', async () => {
    await store.upsertOnRegister(TA, { deviceId: 'phone-rn', branchId: BA, registeredBy: UA, label: 'iPhone 15' });
    const r = await store.rename(TA, 'phone-rn', 'Front Desk', UA);
    expect(r?.label).toBe('Front Desk');
    expect((await store.upsertOnRegister(TA, { deviceId: 'phone-rn', registeredBy: UA, label: 'iPhone 15', appVersion: '2.1' })).label).toBe('Front Desk');
    expect(await one(`select updated_by from mobile_pay_devices where tenant_id = $1 and device_id = 'phone-rn'`, [TA])).toMatchObject({ updated_by: UA });
    expect(await store.rename(TB, 'phone-rn', 'Hijack')).toBeNull();
  });
  it('§5: an attestation verdict is stored; the CHECK refuses an unknown verdict', async () => {
    await store.upsertOnRegister(TA, { deviceId: 'phone-at', branchId: BA, registeredBy: UA });
    expect((await store.setAttestation(TA, 'phone-at', 'passed'))?.attestationStatus).toBe('passed');
    expect((await store.setAttestation(TA, 'phone-at', 'failed'))?.attestationStatus).toBe('failed');
    await expect(store.setAttestation(TA, 'phone-at', 'bogus' as any)).rejects.toThrow();
  });
});
