// display-devices.pgtest.vitest.spec.ts — 23-inch dual-screen spec §8–§12, §81–§86, §97 on the REAL schema (every
// migration, PGlite): migration 511's tables and rules, the pairing handshake's SQL (cross-tenant by design, and only
// that), the tenant-scoped device and register repository, the display's maintenance flag and receipt claim, and the
// checkout module's own reads of the same rows (which display a checkout may go to; what is "on" a display).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { KyselyDisplayPairingRepository } from './display-pairing.repository';
import { KyselyDisplayDevicesRepository } from './display-devices.repository';
import { KyselyDisplayRepository } from './customer-display.repository';
import { DisplayDevicesService } from './display-devices.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const T = 'e6000000-0000-0000-0000-000000000001', T2 = 'e6000000-0000-0000-0000-000000000002';
const B = 'e6000000-0000-0000-0000-0000000000b1', B2 = 'e6000000-0000-0000-0000-0000000000b2', BX = 'e6000000-0000-0000-0000-0000000000b9';
const OWNER = 'e6000000-0000-0000-0000-0000000000a1';
const CUST = 'e6000000-0000-0000-0000-0000000000c1';
const actor = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER' };

let pg: PGlite;
let db: Kysely<any>;
let pairing: KyselyDisplayPairingRepository;
let devices: KyselyDisplayDevicesRepository;
let display: KyselyDisplayRepository;
let svc: DisplayDevicesService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  pairing = new KyselyDisplayPairingRepository(db as any);
  devices = new KyselyDisplayDevicesRepository(db as any);
  display = new KyselyDisplayRepository(db as any);
  const rt: any = { toTenant() {}, toCustomerDisplayDevice() {}, toCustomerDisplay() {}, toTicket() {}, toTechnician() {}, toOwner() {}, toPlatform() {} };
  svc = new DisplayDevicesService(pairing, devices, rt);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','e6a','E6A'), ($2,'Other Salon LLC','Other Salon','e6b','E6B')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Cherry Hill'), ($3,$2,'Voorhees'), ($4,$5,'Elsewhere')`, [B, T, B2, BX, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Lane','Sophia Lane')`, [CUST, T, B]);
});

describe('migration 511 on the real schema', () => {
  it('a display\'s register must be a register of ITS salon (a foreign key — the old free text pointed at nothing)', async () => {
    const st = (await q(`insert into pos_stations (tenant_id, branch_id, name) values ($1,$2,'Register 1') returning id`, [T2, BX]))[0];
    await expect(q(`insert into customer_display_devices (tenant_id, branch_id, pos_station_id, device_name, pairing_status) values ($1,$2,$3,'X','paired')`, [T, B, st.id])).rejects.toThrow();
  });
  it('one live register per name in a branch (case and spaces ignored); a retired name can be reused', async () => {
    const a = await devices.createStation(actor, B, 'Front Desk');
    expect(a).toMatchObject({ name: 'Front Desk', branchId: B });
    expect(await devices.createStation(actor, B, ' front desk ')).toBe('duplicate');
    expect(await devices.createStation({ ...actor, branchId: B2 }, B2, 'Front Desk')).toMatchObject({ branchId: B2 });
    await devices.retireStation(actor, (a as any).id);
    expect(await devices.createStation(actor, B, 'Front Desk')).toMatchObject({ name: 'Front Desk' });
    const audit = await q(`select action_type, user_id from audit_logs where tenant_id = $1 and entity_type = 'pos_station' order by created_at`, [T]);
    expect(audit.map((r: any) => r.action_type)).toEqual(expect.arrayContaining(['pos_station_created', 'pos_station_retired']));
    expect(audit[0].user_id).toBe(OWNER);
  });
  it('receipt columns are all set or all empty, with known values only', async () => {
    const dev = (await q(`insert into customer_display_devices (tenant_id, branch_id, device_name, pairing_status) values ($1,$2,'R','paired') returning id`, [T, B]))[0];
    await expect(q(`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, state, public_token_hash, receipt_choice) values ($1,$2,$3,'idle','h','sms')`, [T, B, dev.id])).rejects.toThrow();
    await expect(q(`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, state, public_token_hash, receipt_choice, receipt_status, receipt_at) values ($1,$2,$3,'closed','h','fax','sent',now())`, [T, B, dev.id])).rejects.toThrow();
    await q(`update customer_display_devices set revoked_at = now() where id = $1`, [dev.id]);
  });
});

describe('the pairing handshake (§8–§12)', () => {
  it('start → claim (a pending display row for the claimer\'s salon and branch, audited) → pickup once (token hash, paired, seen)', async () => {
    const start = await svc.startPairing({ platform: 'android' });
    const row = (await q(`select code_hash, poll_secret_hash, tenant_id, platform from customer_display_pairings where id = $1`, [start.pairingId]))[0];
    expect(row).toEqual({ code_hash: sha(start.code), poll_secret_hash: sha(start.pollSecret), tenant_id: null, platform: 'android' });
    const v = await svc.pair({ ...actor, permissions: [], canManage: true }, { code: start.code, name: 'Front Display #1' });
    expect(v).toMatchObject({ branchId: B, branchName: 'Cherry Hill', awaitingPickup: true, pairing: 'shared' });
    const pending = (await q(`select tenant_id, branch_id, pairing_status, device_token_hash, device_type from customer_display_devices where id = $1`, [v.deviceId]))[0];
    expect(pending).toEqual({ tenant_id: T, branch_id: B, pairing_status: 'pending', device_token_hash: null, device_type: 'android' });
    expect(await display.deviceByToken(sha('anything'))).toBeNull();
    const got = await svc.pollPairing(start.pairingId, start.pollSecret);
    expect(got.status).toBe('paired');
    const token = (got as any).deviceToken;
    const dev = await display.deviceByToken(sha(token));
    expect(dev).toEqual({ id: v.deviceId, tenantId: T, branchId: B, maintenance: false });
    const after = (await q(`select pairing_status, last_seen_at is not null as seen from customer_display_devices where id = $1`, [v.deviceId]))[0];
    expect(after).toEqual({ pairing_status: 'paired', seen: true });
    expect((await svc.pollPairing(start.pairingId, start.pollSecret)).status).toBe('expired');
    const audit = await q(`select action_type, user_id, role from audit_logs where tenant_id = $1 and entity_id = $2 order by created_at`, [T, v.deviceId]);
    expect(audit).toEqual([{ action_type: 'customer_display_paired', user_id: OWNER, role: 'OWNER' }, { action_type: 'customer_display_connected', user_id: null, role: 'CUSTOMER_DISPLAY' }]);
  });

  it('an open code is unique: the same code cannot be opened twice while unclaimed', async () => {
    const first = await pairing.create({ codeHash: sha('11112222'), pollSecretHash: sha('s1'), ttlSeconds: 600, platform: null });
    expect(first).toMatchObject({ id: expect.any(String) });
    expect(await pairing.create({ codeHash: sha('11112222'), pollSecretHash: sha('s2'), ttlSeconds: 600, platform: null })).toBe('code_taken');
  });

  it('a claim takes an OPEN code only, once; a revoked display\'s pickup hands over nothing (and spends the pairing)', async () => {
    const c = await pairing.create({ codeHash: sha('33334444'), pollSecretHash: sha('s'), ttlSeconds: 600, platform: 'web' });
    const id = (c as any).id;
    const one = await pairing.claim(sha('33334444'), { tenantId: T, branchId: B, name: 'Web Display', stationId: null }, actor);
    expect(one).toMatchObject({ platform: 'web' });
    expect(await pairing.claim(sha('33334444'), { tenantId: T2, branchId: BX, name: 'Thief', stationId: null }, { ...actor, tenantId: T2 })).toBeNull();
    await q(`update customer_display_devices set revoked_at = now() where id = $1`, [one!.deviceId]);
    expect(await pairing.pickUp(id, sha('tok'))).toBeNull();
    expect((await q(`select consumed_at is not null as spent from customer_display_pairings where id = $1`, [id]))[0].spent).toBe(true);
    expect(await display.deviceByToken(sha('tok'))).toBeNull();
  });

  it('housekeeping: expired codes are deleted; a claimed display that never collected its credential is revoked', async () => {
    const old = await pairing.create({ codeHash: sha('55556666'), pollSecretHash: sha('s'), ttlSeconds: 600, platform: null });
    await q(`update customer_display_pairings set expires_at = now() - interval '1 second' where id = $1`, [(old as any).id]);
    const claimed = await pairing.create({ codeHash: sha('77778888'), pollSecretHash: sha('s'), ttlSeconds: 600, platform: null });
    const dev = await pairing.claim(sha('77778888'), { tenantId: T, branchId: B, name: 'Never Came', stationId: null }, actor);
    await q(`update customer_display_pairings set claimed_at = now() - interval '11 minutes' where id = $1`, [(claimed as any).id]);
    await pairing.purgeExpired(600);
    expect(await q(`select 1 from customer_display_pairings where id in ($1, $2)`, [(old as any).id, (claimed as any).id])).toEqual([]);
    expect((await q(`select pairing_status, revoked_at is not null as revoked from customer_display_devices where id = $1`, [dev!.deviceId]))[0]).toEqual({ pairing_status: 'unpaired', revoked: true });
  });
});

describe('the salon\'s displays (tenant-scoped)', () => {
  let devId = '';
  it('heartbeat: the row before the write comes back; the report is stored; another salon cannot write it', async () => {
    devId = (await q(`insert into customer_display_devices (tenant_id, branch_id, device_name, pairing_status, device_token_hash) values ($1,$2,'Desk','paired',$3) returning id`, [T, B, sha('desk-token')]))[0].id;
    const hb = { mode: 'advertisement' as const, appVersion: '0.1.0', width: 1920, height: 1080, pixelRatio: 1.25, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE' as const };
    const before = await devices.recordHeartbeat(T, devId, hb);
    expect(before).toMatchObject({ id: devId, reportedMode: null, lastSeenAt: null });
    const now = await devices.device(T, devId);
    expect(now).toMatchObject({ reportedMode: 'advertisement', appVersion: '0.1.0', screenWidth: 1920, screenHeight: 1080, pixelRatio: 1.25, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE', branchName: 'Cherry Hill' });
    expect(now?.lastSeenAt).toBeTruthy();
    expect(await devices.recordHeartbeat(T2, devId, hb)).toBeNull();
    expect(await devices.device(T2, devId)).toBeNull();
    // round 10 (Tablets 02): no OS / battery reported → nothing stored (never a guessed value)
    expect((await q(`select os_version, battery_percent, battery_reported_at from customer_display_devices where id = $1`, [devId]))[0]).toEqual({ os_version: null, battery_percent: null, battery_reported_at: null });
    await devices.recordHeartbeat(T, devId, { ...hb, os: 'Android 13', battery: { percent: 12, charging: false } });
    const r = (await q(`select os_version, battery_percent, battery_charging, battery_reported_at from customer_display_devices where id = $1`, [devId]))[0];
    expect(r).toMatchObject({ os_version: 'Android 13', battery_percent: 12, battery_charging: false }); expect(r.battery_reported_at).toBeTruthy();
    await devices.recordHeartbeat(T, devId, hb);   // a later beat without a battery reading keeps the last one with its own time
    expect((await q(`select battery_percent from customer_display_devices where id = $1`, [devId]))[0].battery_percent).toBe(12);
    await expect(q(`update customer_display_devices set battery_percent = 101 where id = $1`, [devId])).rejects.toThrow();
    // round 10 (Tablets 09): recovery after being offline and an app update are recorded on the activity timeline; routine beats are not
    const audits = async () => (await q(`select action_type, metadata_json from audit_logs where entity_id = $1 and action_type in ('customer_display_reconnected', 'customer_display_app_updated') order by created_at, action_type`, [devId]));
    expect(await audits()).toEqual([]);
    await q(`update customer_display_devices set last_seen_at = now() - interval '10 minutes' where id = $1`, [devId]);
    await devices.recordHeartbeat(T, devId, { ...hb, appVersion: '0.2.0' });
    const a = await audits();
    expect(a.map((x: any) => x.action_type).sort()).toEqual(['customer_display_app_updated', 'customer_display_reconnected']);
    expect(a.find((x: any) => x.action_type === 'customer_display_app_updated').metadata_json).toEqual({ from: '0.1.0', to: '0.2.0' });
    expect(Number(a.find((x: any) => x.action_type === 'customer_display_reconnected').metadata_json.offlineSeconds)).toBeGreaterThanOrEqual(590);
    await devices.recordHeartbeat(T, devId, { ...hb, appVersion: '0.2.0' });
    expect(await audits()).toHaveLength(2);   // a routine beat writes nothing
  });

  it('what is ON a display: open sessions only — a released (completed), cancelled or expired one is history', async () => {
    const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, ticket_number) values ($1,$2,$3,'ready_for_payment', 41) returning id`, [T, B, CUST]))[0].id;
    const mk = (state: string, extra = '') => q(`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, expires_at ${extra ? ', closed_at' : ''}) values ($1,$2,$3,$4,$5,$6,'h', now() + interval '10 minutes' ${extra ? ', now()' : ''}) returning id`, [T, B, devId, tk, CUST, state]);
    await mk('completed', 'closed');
    await mk('disconnected', 'closed');
    expect(await devices.activeSessions(T, [devId])).toEqual([]);
    const open = (await mk('showing_ticket'))[0].id;
    expect(await devices.activeSessions(T, [devId])).toEqual([{ sessionId: open, deviceId: devId, ticketId: tk, ticketNumber: '41', customerFirstName: 'Sophia', state: 'showing_ticket' }]);
    expect(await devices.activeSessions(T2, [devId])).toEqual([]);
    // the checkout module reads the SAME rule (it used to call a released session "active" until it expired)
    const co = new KyselyCheckoutRepository(db as any);
    const ctx: any = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [] };
    expect((await co.activeSession(ctx))?.sessionId).toBe(open);
    expect(await co.openDisplaySessionsForTicket(ctx, tk)).toEqual([{ sessionId: open, deviceId: devId, state: 'showing_ticket' }]);
    await q(`update customer_display_sessions set state = 'completed', closed_at = now() where id = $1`, [open]);
    expect(await co.activeSession(ctx)).toBeNull();
    expect(await co.openDisplaySessionsForTicket(ctx, tk)).toEqual([]);
  });

  it('the checkout module sees online and maintenance from the same rows (the send picks only usable displays)', async () => {
    const co = new KyselyCheckoutRepository(db as any);
    const ctx: any = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: [] };
    let d = (await co.devices(ctx)).find((x) => x.deviceId === devId)!;
    expect(d).toMatchObject({ online: true, maintenance: false, stationCode: '' });
    expect(await devices.updateDevice(actor, devId, { maintenance: true }, [{ action: 'customer_display_maintenance_on', metadata: {} }])).toBe(true);
    d = (await co.devices(ctx)).find((x) => x.deviceId === devId)!;
    expect(d.maintenance).toBe(true);
    expect(await display.deviceByToken(sha('desk-token'))).toMatchObject({ maintenance: true });
    await q(`update customer_display_devices set last_seen_at = now() - interval '2 minutes' where id = $1`, [devId]);
    d = (await co.devices(ctx)).find((x) => x.deviceId === devId)!;
    expect(d.online).toBe(false);
    expect(await devices.updateDevice({ ...actor, tenantId: T2 }, devId, { name: 'Taken' }, [])).toBe(false);
    expect((await devices.device(T, devId))?.name).toBe('Desk');
  });

  it('revoke: the credential is destroyed, open checkouts end, the change is audited; a second revoke changes nothing', async () => {
    const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status) values ($1,$2,$3,'ready_for_payment') returning id`, [T, B, CUST]))[0].id;
    const s = (await q(`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, ticket_id, state, public_token_hash, expires_at) values ($1,$2,$3,$4,'tip_selected','h', now() + interval '10 minutes') returning id`, [T, B, devId, tk]))[0].id;
    expect(await devices.revokeDevice({ ...actor, tenantId: T2 }, devId)).toBeNull();
    expect(await devices.revokeDevice(actor, devId)).toEqual({ endedSessionIds: [s] });
    expect((await q(`select device_token_hash, pairing_status, maintenance_at from customer_display_devices where id = $1`, [devId]))[0]).toEqual({ device_token_hash: null, pairing_status: 'unpaired', maintenance_at: null });
    expect((await q(`select state, closed_at is not null as closed from customer_display_sessions where id = $1`, [s]))[0]).toEqual({ state: 'disconnected', closed: true });
    expect(await display.deviceByToken(sha('desk-token'))).toBeNull();
    expect(await devices.revokeDevice(actor, devId)).toBeNull();
    expect((await q(`select count(*)::int n from audit_logs where tenant_id = $1 and entity_id = $2 and action_type = 'customer_display_revoked'`, [T, devId]))[0].n).toBe(1);
    expect((await devices.listDevices(T, B)).some((d) => d.id === devId)).toBe(false);
  });
});

describe('the receipt choice is recorded once (§97)', () => {
  it('claim → sending → its outcome; a second claim finds it taken; settings: the branch over the salon, defaults on', async () => {
    const dev = (await q(`insert into customer_display_devices (tenant_id, branch_id, device_name, pairing_status) values ($1,$2,'Rcpt','paired') returning id`, [T, B]))[0].id;
    const s = (await q(`insert into customer_display_sessions (tenant_id, branch_id, display_device_id, state, public_token_hash, expires_at) values ($1,$2,$3,'paid','h', now() + interval '10 minutes') returning id`, [T, B, dev]))[0].id;
    expect(await display.claimReceiptChoice(T2, s, 'sms', 'sending')).toBe(false);   // another salon cannot
    expect(await display.claimReceiptChoice(T, s, 'sms', 'sending')).toBe(true);
    expect(await display.claimReceiptChoice(T, s, 'email', 'sending')).toBe(false);
    await display.finishReceipt(T, s, 'sent');
    await display.finishReceipt(T, s, 'failed');   // only a 'sending' row moves
    const row = await display.getSession(s);
    expect(row).toMatchObject({ receiptChoice: 'sms', receiptStatus: 'sent' });

    expect(await display.receiptSettings(T, B)).toEqual({ promptEnabled: true, defaultDelivery: ['SMS', 'Email'] });
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'receipts-branding', $2::jsonb), ($1, null, 'customer-display-devices', '{"receiptPromptEnabled": true}'::jsonb), ($1, $3, 'customer-display-devices', '{"receiptPromptEnabled": false}'::jsonb)`, [T, JSON.stringify({ defaultDelivery: ['Email'] }), B2]);
    expect(await display.receiptSettings(T, B)).toEqual({ promptEnabled: true, defaultDelivery: ['Email'] });
    expect(await display.receiptSettings(T, B2)).toEqual({ promptEnabled: false, defaultDelivery: ['Email'] });
  });
});
