// device-fleet-center.pgtest — SUNMI batch 8 (Nov 9 2026) on the REAL schema. DF = each class reads its OWN registry (the
// old pages filtered displays by types that registry never stores — the "0 connected" bug), honest statuses, scope,
// filters / pages, the canonical history, the digital-receipt view and the read-only check. Every row is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DeviceFleetCenter, DeviceFleetError, duplicateNameCount, exportDeviceFleetCsv, DF_EXPORT_COLUMNS } from './device-fleet-center';

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
  it('round 10 (Tablets 02): OS and battery only as reported; a low battery (fresh, not charging) needs attention; a stale reading is marked stale; unreported = null', async () => {
    const before = await fc.list(ctx(), { class: 'tablet', sort: 'name' });
    expect(before.items.find((d) => d.name === 'Display 1')!.facts).toMatchObject({ osVersion: null, batteryPercent: null, batteryCharging: null, batteryReportedAt: null, batteryStale: false });
    await q(sql`update customer_display_devices set os_version = 'Android 13', battery_percent = 9, battery_charging = false, battery_reported_at = now() - interval '1 minute' where device_name = 'Display 1' and tenant_id = ${T}`);
    let d1 = (await fc.list(ctx(), { class: 'tablet', sort: 'name' })).items.find((d) => d.name === 'Display 1')!;
    expect(d1).toMatchObject({ status: 'online', reason: 'BATTERY_LOW' });
    expect(d1.facts).toMatchObject({ osVersion: 'Android 13', batteryPercent: 9, batteryCharging: false, batteryStale: false });
    await q(sql`update customer_display_devices set battery_charging = true where device_name = 'Display 1' and tenant_id = ${T}`);
    expect((await fc.list(ctx(), { class: 'tablet', sort: 'name' })).items.find((d) => d.name === 'Display 1')!.reason).toBeNull();   // charging → fine
    await q(sql`update customer_display_devices set battery_charging = false, battery_reported_at = now() - interval '2 hours' where device_name = 'Display 1' and tenant_id = ${T}`);
    d1 = (await fc.list(ctx(), { class: 'tablet', sort: 'name' })).items.find((d) => d.name === 'Display 1')!;
    expect(d1.reason).toBeNull(); expect(d1.facts.batteryStale).toBe(true);   // an old reading is never treated as the current level
    await q(sql`update customer_display_devices set os_version = null, battery_percent = null, battery_charging = null, battery_reported_at = null where device_name = 'Display 1' and tenant_id = ${T}`);
    // a Go Check-In iPad kiosk reports the same facts with its session heartbeat (migration 931)
    await q(sql`update go_checkin_devices set os_version = 'iPadOS 17.4', battery_percent = 5, battery_charging = false, battery_reported_at = now(), last_seen_at = now() where checkin_slug = 'df-k4'`);
    const k4 = (await fc.list(ctx(), { class: 'tablet', sort: 'name' })).items.find((d) => d.name === 'Spare iPad')!;
    expect(k4.facts).toMatchObject({ role: 'kiosk', osVersion: 'iPadOS 17.4', batteryPercent: 5, batteryCharging: false, batteryStale: false });
    expect(k4.reason).toBe('NO_BRANCH');   // a more urgent reason still wins; the battery stays in the facts
    await q(sql`update go_checkin_devices set os_version = null, battery_percent = null, battery_charging = null, battery_reported_at = null, last_seen_at = now() - interval '3 hours' where checkin_slug = 'df-k4'`);
    const lobby = await q(sql`update go_checkin_devices set battery_percent = 3, battery_charging = false, battery_reported_at = now(), last_seen_at = now() where checkin_slug = 'df-k1' returning id`);
    expect(lobby).toHaveLength(1);
    const k1 = (await fc.list(ctx(), { class: 'kiosk', sort: 'name' })).items.find((d) => d.name === 'Lobby kiosk')!;
    expect(k1).toMatchObject({ status: 'online', reason: 'BATTERY_LOW' });
    await q(sql`update go_checkin_devices set battery_percent = null, battery_charging = null, battery_reported_at = null, last_seen_at = now() - interval '1 minute' where checkin_slug = 'df-k1'`);
  });
  it('round 10 (Tablets 10): the list says whose devices it shows and lists each location with its count; a location filter narrows to it', async () => {
    const here = await fc.list(ctx(), { class: 'tablet' });
    expect(here.scope).toEqual({ branchId: B, branchName: 'Main' });
    expect(here.branches).toEqual([{ branchId: B, name: 'Main', devices: 2 }, { branchId: null, name: null, devices: 1 }]);   // the no-location iPad is shown as such
    const all = await fc.list({ ...ctx(), branchId: '' }, { class: 'tablet' });
    expect(all.scope).toEqual({ branchId: null, branchName: null });
    expect(all.branches!.map((b) => [b.name, b.devices])).toEqual([['Main', 2], ['Second', 1], [null, 1]]);
    const second = await fc.list({ ...ctx(), branchId: '' }, { class: 'tablet', branchId: B2 });
    expect(second.items.map((d) => d.name)).toEqual(['Other branch display']);
    expect(second.branches!.length).toBe(3);   // every location stays choosable while one is picked
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
  it('DF-07 Receipt Devices: no printer registry (NOT CONFIGURED) + the real digital receipts', async () => {
    const s = await fc.summary(ctx(), 'receipt');
    expect(s.registered).toBe(0);
    expect(s.extra).toMatchObject({ printerRegistry: 'not_configured', emailToday: 1, smsToday: 1, noReceiptToday: 1, failedToday: 1 });
    const h = await fc.history(ctx(), { class: 'receipt' });
    expect(h.total).toBe(3); expect(h.receipts!.map((r) => r.choice).sort()).toEqual(['email', 'none', 'sms']);
    const c = await fc.check(ctx(), 'receipt');
    expect(c.checks.find((x) => x.key === 'printer_registry')!.state).toBe('NOT_CONFIGURED');
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
  it('DF-09 duplicate identity (extras #06): same name in one branch is a WARNING with the count; nothing is merged', async () => {
    const clean = await fc.check(ctx(), 'kiosk');
    expect(clean.checks.find((x) => x.key === 'duplicate_names')).toMatchObject({ state: 'READY', count: 0 });
    await q(sql`insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, checkin_slug, status, last_seen_at) values (${T}, ${B}, '  lobby  KIOSK ', 'kiosk', 'df-k5', 'active', now())`);
    const before = (await q(sql`select count(*)::int n from go_checkin_devices where tenant_id = ${T}`))[0].n;
    const c = await fc.check(ctx(), 'kiosk');
    expect(c.checks.find((x) => x.key === 'duplicate_names')).toMatchObject({ state: 'WARNING', count: 2 });
    expect((await q(sql`select count(*)::int n from go_checkin_devices where tenant_id = ${T}`))[0].n).toBe(before);   // read-only: both stay registered
  });
});

describe('duplicateNameCount (pure)', () => {
  it('extras Device Assignments 09 — terminal routing guard: ready / busy (reserved, holder id never shown) / no register / no processor / not ready; read-only', async () => {
    await q(sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, station_id, last_seen_at) values
      ('df-t2', ${T}, ${B}, 'Compact 2', 'paired', 'C032UQ00000002', ${S2}, now()), ('df-t3', ${T}, ${B}, 'Compact 3', 'paired', 'C032UQ00000003', null, now()),
      ('df-t4', ${T}, ${B}, 'Compact 4', 'paired', 'C032UQ00000004', ${S3}, now())`);
    await q(sql`insert into payment_terminal_leases (tenant_id, terminal_id, holder, expires_at) values (${T}, 'df-t2', 'ticket:9f1c-secret-ticket', now() + interval '2 minutes')`);
    const routing = async () => Object.fromEntries((await fc.list(ctx(), { class: 'terminal', pageSize: 50 } as any)).items.map((d: any) => [d.name, d.facts.routing]));
    let r = await routing();
    expect(r['Compact 4']).toMatchObject({ verdict: 'no_processor', processor: null, registerPaired: true, movesMoney: false });   // no merchant setup yet
    await q(sql`insert into tenant_payment_config (tenant_id) values (${T})`);
    const proc = (await q(sql`select processor from tenant_payment_config where tenant_id = ${T}`))[0].processor;
    r = await routing();
    expect(r['Compact 4']).toMatchObject({ verdict: 'ready', operational: 'ONLINE', processor: proc });
    expect(r['Compact 2']).toMatchObject({ verdict: 'busy', operational: 'PROCESSING', reservedFor: 'ticket' });
    expect(r['Compact 2'].reservedUntil).toEqual(expect.any(String));
    expect(JSON.stringify(r)).not.toContain('secret-ticket');
    expect(r['Compact 3']).toMatchObject({ verdict: 'no_register', registerPaired: false });
    expect(r['Compact 1']).toMatchObject({ verdict: 'not_ready', operational: 'UNKNOWN' });   // never answered: not routable
    expect((await q(sql`select count(*)::int as n from payment_terminal_leases where tenant_id = ${T}`))[0].n).toBe(1);   // nothing reserved or released
  });
  it('counts only names shared inside the same branch; blank names are ignored', () => {
    expect(duplicateNameCount([{ name: 'Front', branchId: 'b1' }, { name: 'front ', branchId: 'b1' }, { name: 'Front', branchId: 'b2' }, { name: '', branchId: 'b1' }, { name: '', branchId: 'b1' }] as any)).toBe(2);
    expect(duplicateNameCount([{ name: 'A', branchId: 'b1' }, { name: 'B', branchId: 'b1' }] as any)).toBe(0);
  });
});

describe('Tablets 11 — Safe Export & Evidence Bundle', () => {
  const owner = (branchId = B) => ({ tenantId: T, branchId, userId: U, role: 'OWNER', permissions: ['settings.view'] });
  const lines = (csv: string) => csv.split('\r\n');
  it('EX-01 owners / managers only (pos.devices.export → settings.view): the front desk is refused before anything is read or audited', async () => {
    const before = (await q(sql`select count(*)::int as n from audit_events where tenant_id = ${T} and action = 'device_fleet.exported'`))[0].n;
    expect(await code(exportDeviceFleetCsv(fc, { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['pos.login', 'checkout.view', 'customers.view'] }, {}))).toBe('PERMISSION_DENIED');
    expect((await q(sql`select count(*)::int as n from audit_events where tenant_id = ${T} and action = 'device_fleet.exported'`))[0].n).toBe(before);
  });
  it('EX-02 provenance block, the health checks, then exactly the filtered inventory the list shows; masked serial; no tokens / slugs / processor; audited', async () => {
    const csv = await exportDeviceFleetCsv(fc, owner(), { class: 'all', q: 'Compact' });
    const L = lines(csv);
    expect(L[0]).toBe('Export,Device inventory and health');
    expect(L).toContain('Salon,Pilot'); expect(L).toContain('Location scope,Main'); expect(L).toContain('Generated by,Kevin Owner');
    expect(L.find((l) => l.startsWith('Filters,'))).toBe('Filters,class=all; status=all; search=given (not written)');
    expect(L.join('\n')).not.toMatch(/Compact.*Filters|search=Compact/);   // the search text itself is never written
    expect(L.find((l) => l.startsWith('Health check,'))).toMatch(/^Health check,(READY|WARNING|FAILED|NOT_CONFIGURED) at .* \(read-only\)$/);
    expect(L).toContain('Health check,State,Count');
    expect(L.some((l) => l.startsWith('no_side_effects,READY'))).toBe(true);
    const hi = L.indexOf(DF_EXPORT_COLUMNS.join(','));
    expect(hi).toBeGreaterThan(0);
    const rows = L.slice(hi + 1).filter(Boolean);
    expect(rows).toHaveLength((await fc.list(owner(), { class: 'all', q: 'Compact', pageSize: 100 })).total);   // every page of the same list
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const c1 = rows.find((r) => r.includes('Compact 1'))!;
    expect(c1).toContain('••••8888'); expect(c1.split(',').slice(-2)).toEqual(['UNKNOWN', 'not_ready']);
    expect(L).toContain(`Rows,${rows.length}`);
    for (const bad of ['df-k1', 'df-k2', 'session_token', 'h1', 'C032UQ']) expect(csv).not.toContain(bad);
    const aud = (await q(sql`select actor_user_id, metadata from audit_events where tenant_id = ${T} and action = 'device_fleet.exported' order by occurred_at desc limit 1`))[0];
    expect(aud.actor_user_id).toBe(U);
    expect(aud.metadata).toMatchObject({ class: 'all', rows: rows.length, redaction: 'no_tokens_no_pairing_no_processor_no_customer' });
  });
  it('EX-03 the class and status filters narrow it exactly like the list; another salon\'s devices never appear; a formula-looking name is neutralised', async () => {
    await q(sql`insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, checkin_slug, status) values (${T}, ${B}, '=HYPERLINK("x")', 'kiosk', 'df-k9', 'active')`);
    const csv = await exportDeviceFleetCsv(fc, owner(), { class: 'kiosk' });
    const L = lines(csv); const rows = L.slice(L.indexOf(DF_EXPORT_COLUMNS.join(',')) + 1).filter(Boolean);
    const list = await fc.list(owner(), { class: 'kiosk', pageSize: 100 });
    expect(rows).toHaveLength(list.total);
    expect(csv).not.toContain('Other salon kiosk');
    expect(rows.some((r) => r.includes(`"'=HYPERLINK(""x"")"`))).toBe(true);
    const off = lines(await exportDeviceFleetCsv(fc, owner(), { class: 'kiosk', status: 'disabled' }));
    expect(off.slice(off.indexOf(DF_EXPORT_COLUMNS.join(',')) + 1).filter(Boolean).map((r) => r.split(',')[1])).toEqual(['Old kiosk']);
  });
});

describe('extras Device Assignments 25 (round 10) — tamper-evident device history (migration 923)', () => {
  it('every device audit row is chained at insert; verify says INTACT; an edited row, a removed row and a forged link are named; the chain is append-only', async () => {
    const XC = id(931);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${XC}, 'C', 'Chain', 'df-chain', 'DFCHAIN', 'active')`);
    const cx = { tenantId: XC, branchId: null as any, userId: U, role: 'OWNER', permissions: ['pos.devices.view'] };
    expect((await fc.verifyHistory(cx as any)).state).toBe('EMPTY');
    for (const [act, ent] of [['pos_station_created', 'pos_station'], ['terminal_paired', 'payment_terminal'], ['display_revoked', 'customer_display'], ['login', 'user']] as const)
      await q(sql`insert into audit_logs (tenant_id, action_type, entity_type, entity_id, metadata_json) values (${XC}, ${act}, ${ent}, ${id(940)}, ${JSON.stringify({ station: 'Front' })}::jsonb)`);
    const chain = await q(sql`select seq::int, prev_hash, row_hash from device_history_chain where tenant_id = ${XC} order by seq`);
    expect(chain.map((c: any) => c.seq)).toEqual([1, 2, 3]);                       // the non-device 'login' row is not chained
    expect(chain[0].prev_hash).toBe('GENESIS'); expect(chain[1].prev_hash).toBe(chain[0].row_hash);
    let v = await fc.verifyHistory(cx as any);
    expect(v).toMatchObject({ state: 'INTACT', links: 3, intact: 3, altered: 0, broken: 0, missing: 0 });
    // audit_logs refuse UPDATE / DELETE; simulate someone bypassing the triggers with direct database access
    await q(sql`set session_replication_role = replica`);
    await q(sql`update audit_logs set metadata_json = '{"station":"Back"}'::jsonb where tenant_id = ${XC} and action_type = 'terminal_paired'`);
    await q(sql`delete from audit_logs where tenant_id = ${XC} and action_type = 'display_revoked'`);
    await q(sql`set session_replication_role = origin`);
    v = await fc.verifyHistory(cx as any);
    expect(v).toMatchObject({ state: 'TAMPERED', intact: 1, altered: 1, missing: 1 });
    expect(v.findings.map((f) => [f.seq, f.kind])).toEqual([[2, 'altered'], [3, 'missing']]);
    await expect(q(sql`update device_history_chain set row_hash = 'x' where tenant_id = ${XC}`)).rejects.toThrow(/append-only/);
    await expect(q(sql`delete from device_history_chain where tenant_id = ${XC}`)).rejects.toThrow(/append-only/);
    expect((await fc.verifyHistory(ctx() as any)).findings.every((f) => f.entityId !== id(940))).toBe(true);   // another salon's chain is never mixed in
  });
});

describe('extras Device Health 06 (round 10) — alias and asset tag', () => {
  it('a manager labels a device; search finds it by alias or asset tag; tags are unique per salon; another salon\'s device cannot be labelled; audited', async () => {
    const dev = (await fc.list(ctx(), { class: 'all', q: 'lobby' })).items[0];
    expect(dev).toBeTruthy(); expect(dev.alias).toBeNull();
    const r = await fc.setLabel(ctx() as any, { source: dev.source, deviceId: dev.id, alias: 'Window iPad', assetTag: 'AT-0042' });
    expect(r).toMatchObject({ alias: 'Window iPad', assetTag: 'AT-0042' });
    expect((await fc.list(ctx(), { class: 'all', q: 'window ipad' })).items.map((d) => d.id)).toEqual([dev.id]);
    expect((await fc.list(ctx(), { class: 'all', q: 'at-0042' })).items[0]).toMatchObject({ id: dev.id, alias: 'Window iPad', assetTag: 'AT-0042' });
    const other = (await fc.list(ctx(), { class: 'all' })).items.find((d) => d.id !== dev.id)!;
    await expect(fc.setLabel(ctx() as any, { source: other.source, deviceId: other.id, assetTag: 'at-0042' })).rejects.toMatchObject({ code: 'DEVICE_ASSET_TAG_TAKEN' });
    await expect(fc.setLabel({ ...ctx(), tenantId: X, branchId: BX } as any, { source: dev.source, deviceId: dev.id, alias: 'x' })).rejects.toMatchObject({ code: 'DEVICE_FLEET_INVALID_DEVICE' });
    await fc.setLabel(ctx() as any, { source: dev.source, deviceId: dev.id, alias: null, assetTag: '' });
    expect((await fc.list(ctx(), { class: 'all', q: 'window ipad' })).total).toBe(0);
    const a = await q(sql`select action, before_state, after_state from audit_events where resource_type = 'device_label' order by occurred_at`);
    expect(a.map((x: any) => x.action)).toEqual(['device.label_set', 'device.label_set']);
    expect(a[1].before_state).toMatchObject({ alias: 'Window iPad', assetTag: 'AT-0042' });
  });
});
