// device-alert-routing.pgtest — Device Integration Logs backlog · 05 on the REAL schema: deduplicated, actionable alerts for
// device offline / terminal unavailable / repeated sync failures / critical provider errors, routed into the salon's
// existing alert feed (owner_alerts). One open alert per key, cooldown after a resolve, another salon never touched.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DeviceFleetCenter } from './device-fleet-center';
import { evaluateDeviceAlerts, detectDeviceAlerts, DEVICE_ALERT_COOLDOWN_MS } from './device-alert-routing';

const P = 'c8740000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4), U = id(5);
let db: any; let fc: DeviceFleetCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const rows = (t: string) => fc.alertRows(t);
const open = async (t = T) => q(sql`select severity, status, metadata from owner_alerts where tenant_id = ${t} and category = 'device_integration' and status in ('new','acknowledged','in_progress') order by metadata->>'dedupeKey'`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  fc = new DeviceFleetCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'da-874', 'DA874', 'active'), (${X}, 'X', 'Other', 'da-874x', 'DA874X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main'), (${BX}, ${X}, 'Other')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${U}, ${T}, 'Owner Da', 'owner-da@example.test', 'active', 'OWNER')`);
  await q(sql`insert into customer_display_devices (tenant_id, branch_id, device_name, device_type, pairing_status, last_seen_at) values
    (${T}, ${B}, 'Display A', 'ipad', 'paired', now() - interval '20 minutes'),
    (${T}, ${B}, 'Display B', 'ipad', 'paired', now() - interval '2 hours'),
    (${T}, ${B}, 'Display live', 'ipad', 'paired', now() - interval '10 seconds'),
    (${T}, ${B}, 'Display gone for days', 'ipad', 'paired', now() - interval '3 days'),
    (${X}, ${BX}, 'Other salon display', 'ipad', 'paired', now() - interval '20 minutes')`);
  await q(sql`insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, checkin_slug, status, last_seen_at) values (${T}, ${B}, 'Lobby kiosk', 'kiosk', 'da-k1', 'active', now() - interval '1 minute')`);
  await q(sql`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, hsn, last_seen_at, last_ping_at, last_ping_ok) values
    ('da-term-off', ${T}, ${B}, 'Compact 1', 'paired', 'C032UQ11112222', now() - interval '3 hours', now() - interval '3 hours', false)`);
  await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, created_at) values
    (${T}, ${B}, 'integration', 'error', 'google_calendar', 'sync failed', now() - interval '5 minutes'),
    (${T}, ${B}, 'integration', 'error', 'google_calendar', 'sync failed', now() - interval '10 minutes'),
    (${T}, ${B}, 'integration', 'error', 'google_calendar', 'sync failed', now() - interval '15 minutes'),
    (${T}, ${B}, 'integration', 'error', 'webhook', 'one failure', now() - interval '5 minutes'),
    (${T}, ${B}, 'integration', 'critical', 'payment_gateway', 'gateway rejected credentials', now() - interval '2 minutes'),
    (${T}, ${B}, 'integration', 'error', 'google_calendar', 'old failure', now() - interval '3 hours'),
    (${X}, ${BX}, 'integration', 'critical', 'payment_gateway', 'other salon', now() - interval '2 minutes')`);
}, 180_000);

describe('Device Integration Logs 05 — automated alert routing', () => {
  it('opens one actionable alert per rule/key: offline displays grouped, terminal unavailable, repeated sync failures, critical provider error', async () => {
    const r = await evaluateDeviceAlerts(db, T, rows);
    expect(r.opened).toBe(4);
    const a = await open();
    expect(a.map((x) => x.metadata.dedupeKey)).toEqual(['device_offline:display', 'provider_critical:payment_gateway', 'sync_failures:google_calendar', 'terminal_unavailable']);
    const off = a[0];
    expect(off.metadata).toMatchObject({ rule: 'device_offline', count: 2, action: 'check_power_network' });   // the live display and the 3-day-silent one are not in it
    expect([...off.metadata.names].sort()).toEqual(['Display A', 'Display B']);
    expect(a[1]).toMatchObject({ severity: 'critical' }); expect(a[1].metadata.count).toBe(1);
    expect(a[2].metadata.count).toBe(3);                         // the 3-hour-old failure is outside the hour; 'webhook' (1 error) is under the threshold
    expect(a[3]).toMatchObject({ severity: 'high' }); expect(a[3].metadata.names).toEqual(['Compact 1']);
    expect(JSON.stringify(a)).not.toMatch(/C032UQ11112222|gateway rejected credentials/);   // no serial, no raw provider message
    expect(await open(X)).toEqual([]);                           // the other salon is untouched by this salon's run
  });

  it('a repeat detection updates the open alert (no second alert); the page lists them through the fleet center', async () => {
    const r = await evaluateDeviceAlerts(db, T, rows);
    expect(r).toMatchObject({ opened: 0, updated: 4 });
    const a = await open();
    expect(a).toHaveLength(4);
    expect(a.every((x) => x.metadata.detections === 2)).toBe(true);
    const list = await fc.alerts({ tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.logs.view', 'owner.alerts.resolve'] }, { status: 'open', page: 1, pageSize: 10 });
    expect(list.totalItems).toBe(4); expect(list.canResolve).toBe(true); expect(list.cooldownMinutes).toBe(30);
    expect(list.items.map((i) => i.rule).sort()).toEqual(['device_offline', 'provider_critical', 'sync_failures', 'terminal_unavailable']);
    const noResolve = await fc.alerts({ tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: ['pos.logs.view'] }, {});
    expect(noResolve.canResolve).toBe(false);
  });

  it('after a resolve the same key is not reopened inside the cooldown (critical excepted), and is reopened after it', async () => {
    await q(sql`update owner_alerts set status = 'resolved', resolved_at = now(), resolved_by_user_id = ${U} where tenant_id = ${T} and category = 'device_integration'`);
    const r = await evaluateDeviceAlerts(db, T, rows);
    expect(r).toMatchObject({ opened: 1, suppressed: 3 });
    expect((await open()).map((x) => x.metadata.dedupeKey)).toEqual(['provider_critical:payment_gateway']);
    const later = await evaluateDeviceAlerts(db, T, rows, { now: Date.now() + DEVICE_ALERT_COOLDOWN_MS + 60_000 });
    expect(later.opened).toBeGreaterThanOrEqual(1);              // outside the cooldown the outage is news again (the window moved, so only what is still detected)
    const closed = await fc.alerts({ tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.logs.view'] }, { status: 'closed' });
    expect(closed.totalItems).toBe(4); expect(closed.items[0].resolvedBy).toBe('Owner Da');
  });

  it('the open-alert index refuses a second open alert for one key (two evaluators racing)', async () => {
    const m = JSON.stringify({ dedupeKey: 'race:test', rule: 'sync_failures' });
    await q(sql`insert into owner_alerts (tenant_id, category, severity, status, title, metadata) values (${T}, 'device_integration', 'warning', 'new', 'a', ${m}::jsonb)`);
    await expect(q(sql`insert into owner_alerts (tenant_id, category, severity, status, title, metadata) values (${T}, 'device_integration', 'warning', 'new', 'b', ${m}::jsonb)`)).rejects.toThrow();
  });

  it('pure rules: unknown / never-tested terminals and pending devices are not outages', () => {
    const now = Date.now();
    const d = (o: Partial<any>) => ({ id: 'x', source: 'display', class: 'display', name: 'n', type: 't', branchId: null, branch: null, station: null, status: 'online', reason: null, lastSeenAt: new Date(now - 60_000).toISOString(), createdAt: null, updatedAt: null, facts: {}, ...o });
    expect(detectDeviceAlerts([d({ class: 'terminal', status: 'unknown' }), d({ status: 'pending', lastSeenAt: null }), d({ status: 'offline', lastSeenAt: null })] as any, [], now)).toEqual([]);
    expect(detectDeviceAlerts([], [{ source: 'Some Source!', severity: 'error', count: 2, first: null, last: null }], now)).toEqual([]);
    expect(detectDeviceAlerts([], [{ source: 'Some Source!', severity: 'error', count: 3, first: null, last: null }], now)[0].dedupeKey).toBe('sync_failures:some_source_');
  });
});
