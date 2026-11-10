// device-fleet-center.pgtest — SUNMI batch 8 (Nov 9 2026) on the REAL schema. DF = each class reads its OWN registry (the
// old pages filtered displays by types that registry never stores — the "0 connected" bug), honest statuses, scope,
// filters / pages, the canonical history, the digital-receipt view and the read-only check. Every row is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DeviceFleetCenter, DeviceFleetError } from './device-fleet-center';

const P = 'c8450000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), S1 = id(10), S2 = id(11), S3 = id(12), U = id(20);
const ctx = (branchId = B) => ({ tenantId: T, branchId, userId: U, role: 'OWNER', permissions: ['pos.devices.view'] });
let db: any; let fc: DeviceFleetCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof DeviceFleetError ? e.code : (e as Error).message; } }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  fc = new DeviceFleetCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'df-845', 'DF845', 'active'), (${X}, 'X', 'Other', 'df-845x', 'DF845X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main'), (${B2}, ${T}, 'Second'), (${BX}, ${X}, 'Other')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${U}, ${T}, 'Kevin Owner', 'owner-df@example.test', 'active', 'OWNER')`);
  // registers: one with a reporting display, one with a silent display, one with none, one retired
  await q(sql`insert into pos_stations (id, tenant_id, branch_id, name, created_at) values (${S1}, ${T}, ${B}, 'Front Desk 1', now() - interval '3 days'), (${S2}, ${T}, ${B}, 'Front Desk 2', now() - interval '2 days'), (${S3}, ${T}, ${B}, 'Back Bar', now() - interval '1 day')`);
  await q(sql`insert into pos_stations (tenant_id, branch_id, name, retired_at) values (${T}, ${B}, 'Old Register', now())`);
  await q(sql`insert into customer_display_devices (tenant_id, branch_id, pos_station_id, device_name, device_type, pairing_status, last_seen_at, created_at) values
    (${T}, ${B}, ${S1}, 'Display 1', 'ipad', 'paired', now() - interval '20 seconds', now() - interval '3 days'),
    (${T}, ${B}, ${S2}, 'Display 2', 'android', 'paired', now() - interval '2 hours', now() - interval '2 days'),
    (${T}, ${B}, null, 'Loose display', 'web_display', 'pending', null, now()),
    (${T}, ${B2}, null, 'Other branch display', 'ipad', 'paired', now(), now())`);
  // kiosks: online, never connected, disabled, no branch
  await q(sql`insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, checkin_slug, status, last_seen_at, disabled_at) values
    (${T}, ${B}, 'Lobby kiosk', 'kiosk', 'df-k1', 'active', now() - interval '1 minute', null),
    (${T}, ${B}, 'New kiosk', 'kiosk', 'df-k2', 'active', null, null),
    (${T}, ${B}, 'Old kiosk', 'kiosk', 'df-k3', 'disabled', now() - interval '9 days', now() - interval '8 days'),
    (${T}, null, 'Spare iPad', 'ipad', 'df-k4', 'active', now() - interval '3 hours', null),
    (${X}, ${BX}, 'Other salon kiosk', 'kiosk', 'df-kx', 'active', now(), null)`);
  await q(sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, station_id) values ('df-term', ${T}, ${B}, 'Compact 1', 'paired', 'C032UQ99998888', ${S1})`);
  await q(sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, created_at) values
    (${T}, ${B}, ${U}, 'OWNER', 'customer_display_paired', 'customer_display', ${S1}, now() - interval '3 days'),
    (${T}, ${B}, ${U}, 'OWNER', 'pos_station_created', 'pos_station', ${S2}, now() - interval '2 days'),
    (${X}, ${BX}, null, 'OWNER', 'customer_display_paired', 'customer_display', ${BX}, now())`);
  const k1 = (await q(sql`select id from go_checkin_devices where checkin_slug = 'df-k1'`))[0].id;
  await q(sql`insert into go_checkin_logs (tenant_id, branch_id, device_id, event_type, safe_message) values (${T}, ${B}, ${k1}, 'heartbeat', 'ok'), (${T}, ${B}, ${k1}, 'check_in_completed', 'guest checked in')`);
  await q(sql`insert into go_checkin_sessions (tenant_id, branch_id, device_id, session_token_hash, status, started_at, last_seen_at, completed_at) values (${T}, ${B}, ${k1}, 'h1', 'completed', now(), now(), now())`);
  await q(sql`insert into customer_display_sessions (tenant_id, branch_id, pos_station_id, state, public_token_hash, receipt_choice, receipt_status, receipt_at, created_at, updated_at) values
    (${T}, ${B}, ${S1}, 'closed', 'p1', 'email', 'sent', now(), now(), now()), (${T}, ${B}, ${S1}, 'closed', 'p2', 'sms', 'failed', now(), now(), now()), (${T}, ${B}, ${S1}, 'closed', 'p3', 'none', 'skipped', now(), now(), now())`);
}, 180_000);

describe('device fleet — each page reads its own registry', () => {
  it('DF-01 Reception POS = the registers (the old page always said 0)', async () => {
    const s = await fc.summary(ctx(), 'reception_pos');
    expect(s).toMatchObject({ registered: 3, online: 1, attention: 1, unassigned: 1, retired: 1 });
    const l = await fc.list(ctx(), { class: 'reception_pos' });
    expect(Object.fromEntries(l.items.map((d) => [d.name, d.status]))).toEqual({ 'Back Bar': 'unassigned', 'Front Desk 2': 'attention', 'Front Desk 1': 'online', 'Old Register': 'retired' });
    expect(l.items.find((d) => d.name === 'Front Desk 1')!.facts).toMatchObject({ displays: 1, terminals: 1 });
    expect(l.items[0].name).toBe('Old Register');   // newest first (created now)
  });
  it('DF-02 Kiosks = Go Check-In devices; connected / never / disabled / no branch; checked in today', async () => {
    const s = await fc.summary(ctx(), 'kiosk');
    expect(s).toMatchObject({ registered: 4, online: 1, disabled: 1 });
    expect(s.extra.checkedInToday).toBe(1);
    const l = await fc.list(ctx(), { class: 'kiosk', sort: 'name' });
    const by = Object.fromEntries(l.items.map((d) => [d.name, d]));
    expect(by['Lobby kiosk'].status).toBe('online');
    expect(by['New kiosk']).toMatchObject({ status: 'pending', reason: 'NEVER_CONNECTED' });
    expect(by['Old kiosk'].status).toBe('disabled');
    expect(by['Spare iPad']).toMatchObject({ status: 'offline' });
    expect(l.items.some((d) => d.name === 'Other salon kiosk')).toBe(false);
  });
  it('DF-03 Tablets = iPad / Android displays + iPad kiosks; branch scope hides the other branch', async () => {
    const l = await fc.list(ctx(), { class: 'tablet', sort: 'name' });
    expect(l.items.map((d) => d.name).sort()).toEqual(['Display 1', 'Display 2', 'Spare iPad']);
    const l2 = await fc.list(ctx(B2), { class: 'tablet' });
    expect(l2.items.map((d) => d.name).sort()).toEqual(['Other branch display', 'Spare iPad']);
  });
  it('DF-04 assignments (all): displays + kiosks + terminals; filters, search, unassigned, pages', async () => {
    const all = await fc.list(ctx(), { class: 'all', pageSize: 10 });
    expect(all.total).toBe(8);
    expect(all.items.find((d) => d.source === 'terminal')).toMatchObject({ name: 'Compact 1', status: 'unknown', station: 'Front Desk 1' });
    expect(JSON.stringify(all)).not.toContain('C032UQ99998888');
    expect((await fc.list(ctx(), { class: 'all', q: 'lobby' })).items.map((d) => d.name)).toEqual(['Lobby kiosk']);
    expect((await fc.list(ctx(), { class: 'all', q: 'Kiosk', status: 'online' })).total).toBe(1);
    expect((await fc.list(ctx(), { class: 'all', status: 'unassigned' })).items.map((d) => d.name).sort()).toEqual(['Loose display', 'Spare iPad']);
    const p2 = await fc.list(ctx(), { class: 'all', pageSize: 10, page: 1, sort: 'name' });
    expect(p2.items.map((d) => d.name)).toEqual([...p2.items.map((d) => d.name)].sort((a, b) => a.localeCompare(b)));
  });
  it('DF-05 bad input is refused with a code', async () => {
    expect(await code(fc.list(ctx(), { class: 'printers' }))).toBe('DEVICE_FLEET_INVALID_CLASS');
    expect(await code(fc.list(ctx(), { class: 'all', pageSize: 7 }))).toBe('DEVICE_FLEET_INVALID_PAGE_SIZE');
    expect(await code(fc.list(ctx(), { class: 'all', from: '2026-11-09', to: '2026-11-01' }))).toBe('DEVICE_FLEET_INVALID_PERIOD');
    expect(await code(fc.list(ctx(), { class: 'all', q: 'a' }))).toBe('DEVICE_FLEET_SEARCH_TOO_SHORT');
  });
});

describe('device fleet — history, receipts and the check', () => {
  it('DF-06 history = audit_logs + kiosk logs, newest first, tenant-scoped', async () => {
    const h = await fc.history(ctx(), { class: 'all' });
    expect(h.total).toBe(4);
    expect(h.items.map((x) => x.at)).toEqual([...h.items.map((x) => x.at)].sort().reverse());
    expect(h.items.find((x) => x.event === 'pos_station_created')!.actor).toBe('Kevin Owner');
    expect((await fc.history(ctx(), { class: 'kiosk' })).total).toBe(2);
    expect((await fc.history(ctx(), { class: 'reception_pos' })).items.map((x) => x.event)).toEqual(['pos_station_created']);
    expect((await fc.history(ctx(), { class: 'all', q: 'check_in' })).total).toBe(1);
  });
  it('DF-07 Receipt Devices: no printers recorded yet (NOT CONFIGURED), no print bridge + the real digital receipts', async () => {
    const s = await fc.summary(ctx(), 'receipt');
    expect(s.registered).toBe(0);
    expect(s.extra).toMatchObject({ printerRegistry: 'not_configured', emailToday: 1, smsToday: 1, noReceiptToday: 1, failedToday: 1 });
    const h = await fc.history(ctx(), { class: 'receipt' });
    expect(h.total).toBe(3); expect(h.receipts!.map((r) => r.choice).sort()).toEqual(['email', 'none', 'sms']);
    const c = await fc.check(ctx(), 'receipt');
    expect(c.checks.find((x) => x.key === 'printers_registered')!.state).toBe('NOT_CONFIGURED'); expect(c.checks.find((x) => x.key === 'print_bridge')!.state).toBe('NOT_CONFIGURED');
    expect(c.checks.find((x) => x.key === 'receipt_failures_today')).toMatchObject({ state: 'WARNING', count: 1 });
  });
  it('DF-08 the check is read-only and honest', async () => {
    const before = (await q(sql`select (select count(*) from audit_logs)::int a, (select count(*) from customer_display_devices)::int d, (select max(updated_at) from go_checkin_devices) k`))[0];
    const c = await fc.check(ctx(), 'reception_pos');
    const after = (await q(sql`select (select count(*) from audit_logs)::int a, (select count(*) from customer_display_devices)::int d, (select max(updated_at) from go_checkin_devices) k`))[0];
    expect(after).toEqual(before);
    expect(c.overall).toBe('WARNING');
    expect(c.checks.find((x) => x.key === 'devices_reporting')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(c.checks.find((x) => x.key === 'assignments_complete')).toMatchObject({ state: 'WARNING', count: 1 });
  });
});
