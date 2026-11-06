// terminals-screen.pgtest — Payment Terminals mandate (Oct 29 2026), against the REAL schema.
//   Physical: the KPI counts and the list come from the SAME rows by the SAME status function — a terminal with no location
//   (charged by terminal capture) is in both; ONLINE only within the freshness window; a never-heard-from terminal is
//   "Not tested yet" and needs attention, never Online; an unpaired / no-serial / retired-register terminal says why.
//   Search ranks an exact id / serial first; paging is newest first with no duplicates; another salon is invisible.
//   Tap to Pay: revoked phones stay listed (history) and are counted apart from physical terminals.
//   Activity: payment → ticket → capture device → customer; a payment with no recorded device is "Not linked"; a
//   customer phone finds that customer's payments only; another salon's payments never appear; the period is salon-local.
//   Routing: the mode, the register → terminal association the charge would use, and the last change from the audit log.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TerminalsScreenRepository } from './terminals-screen.repository';
import { resolvePeriod, pageReq, FinanceError } from './finance-scope';

const P = 'f7a2b3c4-0000-4000-8000-0000000';
const id = (n: string) => P + n.replace(/t/g, '7').replace(/p/g, '9').replace(/s/g, '5').padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), OWNER = id('e1'), STAFF = id('e2');
const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.devices.manage', 'pos.customers.view', 'settings.edit'] };
const deskCtx = { ...ctx, role: 'FRONT_DESK', permissions: ['pos.checkout.view'] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
const TZ = 'America/New_York';
let pg: any; let repo: TerminalsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const term = (tid: string, tenant: string, branch: string | null, label: string, f: Record<string, unknown> = {}) =>
  q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, station_id, status, paired_at, hsn, terminal_type, last_seen_at, last_ping_at, last_ping_ok, disabled_at, disabled_reason, updated_at)
     values ($1,$2,$3,$4,$5,$6, now() - make_interval(mins => $7), $8, 'clover_compact', $9, $10, $11, $12, $13, now())`,
    [tid, tenant, branch, label, f.station ?? null, f.status ?? 'paired', Number(f.pairedMinsAgo ?? 100), f.hsn === undefined ? 'HSN-' + tid.slice(-4) : f.hsn, f.seen ?? null, f.ping ?? null, f.pingOk ?? null, f.disabled ?? null, f.reason ?? null]);
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof FinanceError ? e.code : String((e as Error).message); } }

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus','pt-lotus','PTL001','active'), ($2,'Other LLC','Other','pt-other','PTL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active',$5), ($3,$4,'Other','active',$5)`, [B, T, B2, T2, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status, normalized_phone) values ($1,$3,'o@x.test','Olive Owner','OWNER','active',null), ($2,$3,'s@x.test','Sam Staff','FRONT_DESK','active','+12155550188')`, [OWNER, STAFF, T]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$2,$3,'Front Desk'), ($4,$2,$3,'Back Bar'), ($5,$2,$3,'Old Register')`, [id('s1'), T, B, id('s2'), id('s3')]);
  await q(`update pos_stations set retired_at = now() where id = $1`, [id('s3')]);
  repo = new TerminalsScreenRepository(kyselyFor(pg));
  await term('term_000001', T, B, 'Front Counter', { station: id('s1'), seen: ago(3), pairedMinsAgo: 10 });                 // ONLINE
  await term('term_000002', T, null, 'Spa Room', { seen: ago(5), ping: ago(1), pingOk: false, pairedMinsAgo: 20 });         // OFFLINE, no location
  await term('term_000003', T, B, 'Patio', { seen: ago(90), pairedMinsAgo: 30 });                                            // DEGRADED (stale)
  await term('term_000004', T, B, 'New One', { pairedMinsAgo: 1, hsn: null });                                               // UNKNOWN + no serial
  await term('term_000005', T, B, 'Old Flex', { disabled: ago(600), reason: 'Broken screen', pairedMinsAgo: 40 });          // DISABLED
  await term('term_000006', T, B, 'Back Bar Unit', { status: 'unpaired', pairedMinsAgo: 50, station: id('s3') });          // pairing incomplete + retired register
  await term('term_000099', T2, B2, 'Other salon', { seen: ago(1) });
  // Tap to Pay phones: one active (seen now), two revoked, one pending — the other salon's phone never appears
  for (const [n, status, mins] of [['1', 'active', 1], ['2', 'revoked', 5000], ['3', 'revoked', 9000], ['4', 'pending', 2]] as const)
    await q(`insert into mobile_pay_devices (tenant_id, branch_id, device_id, label, platform, status, bound_user_id, last_seen_at, created_at, tap_to_pay_capable, revoked_at, revoke_reason)
      values ($1,$2,$3,$4,'ios',$5,$6, now() - make_interval(mins => $7), now() - make_interval(mins => $8), true, $9, $10)`,
      [T, B, 'iphone-device-000' + n, 'Staff iPhone ' + n, status, STAFF, mins, 100 - Number(n), status === 'revoked' ? ago(mins) : null, status === 'revoked' ? 'Lost phone' : null]);
  await q(`insert into mobile_pay_devices (tenant_id, branch_id, device_id, label, platform, status, created_at) values ($1,$2,'iphone-other','Other phone','ios','active', now())`, [T2, B2]);
  // payments: one through the paired terminal, one Tap to Pay, one with no device recorded (legacy), one cash (not card activity), another salon's
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values ($1,$2,$3,'Ann','Lee','Ann Lee','+12155550101','ann@example.com'), ($4,$5,$6,'Ann','Other','Ann Other','+12155550101',null)`, [id('c1'), T, B, id('c9'), T2, B2]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, checkout_register_id) values ($1,$2,$3,$4,'paid',5000,'041',$5), ($6,$2,$3,$4,'paid',3000,'042',null), ($7,$8,$9,$10,'paid',9000,'099',null)`,
    [id('t1'), T, B, id('c1'), id('s1'), id('t2'), id('t9'), T2, B2, id('c9')]);
  // Nov 4 2026: the payments sit inside the salon's CURRENT day (they were now − 1…4 h, which fell on yesterday between midnight
  // and 4 a.m. New York time, so the 'today' assertions failed at night)
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status, processor_transaction_id, payment_surface, device_id, card_brand, card_last4, created_at) values
    ($1,$2,$3,$4,'card',5000,'approved','RETREF-1','cardpointe_terminal','term_000001','VISA','4242', (greatest(now(), (date_trunc('day', now() at time zone 'America/New_York') + interval '5 hours') at time zone 'America/New_York') - interval '1 hour')),
    ($5,$2,$3,$6,'card',3000,'approved','FCH-2','tap_to_pay_iphone','iphone-device-0001','MC','5454', (greatest(now(), (date_trunc('day', now() at time zone 'America/New_York') + interval '5 hours') at time zone 'America/New_York') - interval '2 hours')),
    ($7,$2,$3,$6,'card',1234,'declined',null,null,null,null,null, (greatest(now(), (date_trunc('day', now() at time zone 'America/New_York') + interval '5 hours') at time zone 'America/New_York') - interval '3 hours')),
    ($8,$2,$3,$6,'cash',700,'approved',null,'cash',null,null,null, (greatest(now(), (date_trunc('day', now() at time zone 'America/New_York') + interval '5 hours') at time zone 'America/New_York') - interval '4 hours')),
    ($9,$10,$11,$12,'card',9000,'approved','RETREF-9','cardpointe_terminal','term_000099',null,null, now())`,
    [id('p1'), T, B, id('t1'), id('p2'), id('t2'), id('p3'), id('p4'), id('p9'), T2, B2, id('t9')]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', '{"customerDisplayCaptureMode":"terminal"}'::jsonb)`, [T]);
  await q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json) values ($1,$2,$3,'OWNER','pos_settings_payments_checkout_updated','payments_checkout','payments-checkout','{"customerDisplayCaptureMode":"front_desk"}'::jsonb,'{"customerDisplayCaptureMode":"terminal"}'::jsonb)`, [T, B, OWNER]);
}, 180_000);

describe('Payment Terminals — physical inventory and KPIs', () => {
  it('KPI counts and the list are the same rows: a no-location terminal is in both; Online only within the window', async () => {
    const s = await repo.summary(ctx);
    expect(s.physical.total).toBe(6);
    expect(s.physical.online).toBe(1);
    expect(s.physical.disabled).toBe(1);
    expect(s.physical.needsAttention).toBe(4);   // offline · stale · never tested · pairing incomplete
    const list = await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 1, pageSize: 50 }));
    expect(list.total).toBe(s.physical.total);
    const by = Object.fromEntries(list.items.map((t) => [t.id, t]));
    expect(by.term_000001.status).toBe('ONLINE');
    expect(by.term_000002.status).toBe('OFFLINE'); expect(by.term_000002.branchId).toBeNull(); expect(by.term_000002.attention).toEqual(['offline']);
    expect(by.term_000003.status).toBe('DEGRADED'); expect(by.term_000003.attention).toEqual(['stale']);
    expect(by.term_000004.status).toBe('UNKNOWN'); expect(by.term_000004.attention).toEqual(['never_tested', 'no_serial']);
    expect(by.term_000005.group).toBe('disabled'); expect(by.term_000005.disabledReason).toBe('Broken screen');
    expect(by.term_000006.attention).toEqual(['pairing_incomplete', 'register_retired']);
    expect(by.term_000001.registerName).toBe('Front Desk');
    expect(list.items.some((t) => t.id === 'term_000099')).toBe(false);
  });
  it('newest registration first; numbered pages have no duplicates or gaps; a page past the end lands on the last page', async () => {
    const p1 = await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 1, pageSize: 2 }));
    const p2 = await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 2, pageSize: 2 }));
    const p3 = await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 3, pageSize: 2 }));
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t) => t.id);
    expect(ids).toEqual(['term_000004', 'term_000001', 'term_000002', 'term_000003', 'term_000005', 'term_000006']);
    expect(new Set(ids).size).toBe(6);
    expect((await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 9, pageSize: 2 }))).page).toBe(3);
  });
  it('search: an exact id / serial ranks first, a name matches partially, a group filter narrows; another salon never matches', async () => {
    const a = await repo.physicalList(ctx, { q: 'HSN-0003', sort: 'created_desc' }, pageReq({}));
    expect(a.items[0].id).toBe('term_000003'); expect(a.items[0].matchedBy).toBe('identifier');
    const b = await repo.physicalList(ctx, { q: 'front', sort: 'created_desc' }, pageReq({}));
    expect(b.items.map((t) => t.id)).toEqual(['term_000001']);
    const c = await repo.physicalList(ctx, { q: '', group: 'attention', sort: 'created_desc' }, pageReq({}));
    expect(c.total).toBe(4);
    expect((await repo.physicalList(ctx, { q: 'Other salon', sort: 'created_desc' }, pageReq({}))).total).toBe(0);
    expect(await code(repo.physicalDetail(ctx, 'term_000099'))).toBe('TERMINAL_NOT_FOUND');
  });
  it('detail lists the recent payments the terminal actually took', async () => {
    const d = await repo.physicalDetail(ctx, 'term_000001');
    expect(d.recentPayments.map((p) => p.amountCents)).toEqual([5000]);
    expect(d.freshnessMinutes).toBe(15);
  });
});

describe('Payment Terminals — Tap to Pay iPhones', () => {
  it('every registration is listed (revoked kept for history) and counted apart from physical terminals', async () => {
    const s = await repo.summary(ctx);
    expect(s.tapToPay).toMatchObject({ total: 4, active: 1, revoked: 2, pending: 1, seenRecently: 1 });
    const l = await repo.phoneList(ctx, { q: '', sort: 'created_desc' }, pageReq({ page: 1, pageSize: 10 }));
    expect(l.items.map((d) => d.status)).toEqual(['pending', 'revoked', 'revoked', 'active']);   // newest registration first
    expect(l.items.find((d) => d.status === 'revoked')?.revokeReason).toBe('Lost phone');
    expect(l.items.some((d) => d.deviceId === 'iphone-other')).toBe(false);
  });
  it('staff name and staff phone find the phone; a front-desk role sees the staff phone masked', async () => {
    const a = await repo.phoneList(ctx, { q: 'Sam', sort: 'created_desc' }, pageReq({}));
    expect(a.total).toBe(4); expect(a.items[0].matchedBy).toBe('staff');
    const b = await repo.phoneList(ctx, { q: '215-555-0188', sort: 'created_desc' }, pageReq({}));
    expect(b.total).toBe(4); expect(b.items[0].staffPhone).toBe('(215) 555-0188');   // shown as staff read it, never raw E.164
    const c = await repo.phoneList(deskCtx, { q: '', status: 'active', sort: 'created_desc' }, pageReq({}));
    expect(c.items[0].staffPhone).toBe('(•••) •••-0188');
  });
});

describe('Payment Terminals — Payment Activity and routing', () => {
  const today = () => resolvePeriod({ preset: 'today' }, TZ);
  it('payment → ticket → actual capture device → customer; no recorded device is "unlinked"; cash is not card activity', async () => {
    const l = await repo.activityList(ctx, { period: today(), q: '', sort: 'time_desc' }, pageReq({ page: 1, pageSize: 10 }));
    expect(l.total).toBe(3);
    expect(l.items.map((x) => [x.amountCents, x.device.kind])).toEqual([[5000, 'terminal'], [3000, 'iphone'], [1234, 'unlinked']]);
    expect(l.items[0].device.label).toBe('Front Counter'); expect(l.items[0].register).toBe('Front Desk');
    expect(l.items[1].device.staff).toBe('Sam Staff');
    expect(l.items[2].status).toBe('declined');
  });
  it('Payment Terminals guide audit (Nov 4 2026): a location sees only its own payments; the salon-wide view sees them all', async () => {
    const B3 = id('b3');
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Second','active',$3) on conflict do nothing`, [B3, T, TZ]);
    expect((await repo.activityList({ ...ctx, branchId: B3 }, { period: today(), q: '', sort: 'time_desc' }, pageReq({}))).total).toBe(0);
    expect((await repo.activityList({ ...ctx, branchId: undefined } as typeof ctx, { period: today(), q: '', sort: 'time_desc' }, pageReq({}))).total).toBe(3);
  });
  it('a customer phone finds only that customer’s payments in this salon; a device filter narrows; a range before today is empty', async () => {
    const a = await repo.activityList(ctx, { period: today(), q: '(215) 555-0101', sort: 'time_desc' }, pageReq({}));
    expect(a.items.every((x) => x.customer?.name === 'Ann Lee')).toBe(true);
    expect(a.total).toBe(3);
    const b = await repo.activityList(ctx, { period: today(), q: 'RETREF-1', sort: 'time_desc' }, pageReq({}));
    expect(b.items.map((x) => x.paymentId)).toEqual([id('p1')]);
    const c = await repo.activityList(ctx, { period: today(), q: '', device: 'iphone', sort: 'time_desc' }, pageReq({}));
    expect(c.total).toBe(1);
    const old = resolvePeriod({ preset: 'custom', from: '2024-01-01', to: '2024-01-31' }, TZ);
    expect((await repo.activityList(ctx, { period: old, q: '', sort: 'time_desc' }, pageReq({}))).total).toBe(0);
    expect((await repo.activityList(ctx2, { period: today(), q: 'Ann', sort: 'time_desc' }, pageReq({}))).items.every((x) => x.customer?.name === 'Ann Other')).toBe(true);
  });
  it('routing: the saved mode, each register’s terminal (as the charge selects it) and the last change with its actor', async () => {
    const r = await repo.routing(ctx);
    expect(r.mode).toBe('terminal');
    expect(r.lastChange).toMatchObject({ actor: 'Olive Owner', from: 'front_desk', to: 'terminal' });
    const fd = r.registers.find((x) => x.name === 'Front Desk')!;
    expect(fd.routedTerminal).toMatchObject({ id: 'term_000001', via: 'assigned' });
    const bb = r.registers.find((x) => x.name === 'Back Bar')!;
    expect(bb.routedTerminal).toBeNull(); expect(bb.problem).toBe('not_assigned');
    expect(r.registers.some((x) => x.name === 'Old Register')).toBe(false);
    expect((await repo.routing(ctx2)).mode).toBe('front_desk');
  });
});

// Payment Terminals guide (Nov 4 2026) §16 / §17: the processor filter, and the Device Audit History with its own date range and
// page — terminal and Tap to Pay events newest first, revoked devices still listed, nothing of another salon / location
describe('Payment Terminals — processor filter and Device Audit History', () => {
  it('filters terminals by the processor they were paired to (none = not linked)', async () => {
    await q(`update pos_payment_terminals set provider = 'cardpointe' where tenant_id = $1 and id = 'term_000003'`, [T]);
    const all = await repo.physicalList(ctx, { q: '', sort: 'created_desc' }, pageReq({ pageSize: 50 }));
    const cp = await repo.physicalList(ctx, { q: '', provider: 'CardPointe', sort: 'created_desc' }, pageReq({ pageSize: 50 }));
    expect(cp.items.map((t) => t.id)).toEqual(['term_000003']);
    const none = await repo.physicalList(ctx, { q: '', provider: 'none', sort: 'created_desc' }, pageReq({ pageSize: 50 }));
    expect(none.total).toBe(all.total - 1);
  });
  it('lists terminal and Tap to Pay audit events newest first within the period; kind / device / search narrow it; other salons and locations never', async () => {
    // minutes, not hours, apart: 3 hours ago is yesterday in the salon's first hours, outside 'today' (failed in the
    // 07:20 UTC full run of Nov 6 2026). The order newest-first is the same.
    await q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, after_json, created_at) values
      ($1,$2,$3,'OWNER','pos_settings_terminal_paired','payments_checkout','term_000003','{"id":"term_000003","provider":"cardpointe","merchantAccountId":"x"}', now() - interval '3 minutes'),
      ($1,$2,$3,'OWNER','pos_settings_terminal_tested','payments_checkout','term_000003','{"id":"term_000003","reachable":false}', now() - interval '2 minutes'),
      ($1,$6,$3,'OWNER','pos_settings_terminal_paired','payments_checkout','term_elsewhere','{}', now() - interval '1 minutes'),
      ($4,$5,$7,'OWNER','pos_settings_terminal_paired','payments_checkout','term_000099','{}', now()),
      ($1,$2,$3,'OWNER','pos_settings_receipts_saved','receipts','receipts','{}', now())`, [T, B, OWNER, T2, B2, id('b9'), id('e9')]);
    await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json, created_at) values
      ($1,$2,$3,'OWNER','mobile_pay_device_revoked','mobile_pay_device','iphone-device-0002','{"reason":"Lost phone","token":"secret"}', now() - interval '30 seconds'),
      ($4,$5,null,'OWNER','mobile_pay_device_revoked','mobile_pay_device','iphone-other','{}', now())`, [T, B, OWNER, T2, B2]);
    const period = resolvePeriod({ preset: 'today' }, TZ);
    const h = await repo.auditHistory(ctx, { period, q: '' }, pageReq({}));
    expect(h.items.map((x) => [x.kind, x.deviceId, x.action])).toEqual([
      ['iphone', 'iphone-device-0002', 'mobile_pay_device_revoked'], ['terminal', 'term_000003', 'pos_settings_terminal_tested'], ['terminal', 'term_000003', 'pos_settings_terminal_paired']]);
    expect(h.items[0]).toMatchObject({ deviceLabel: 'Staff iPhone 2', actor: 'Olive Owner', detail: { reason: 'Lost phone' } });
    expect(JSON.stringify(h.items)).not.toMatch(/secret|merchantAccountId/);
    expect(h.items[1]!.detail).toEqual({ reachable: false });
    expect((await repo.auditHistory(ctx, { period, kind: 'terminal', q: '' }, pageReq({}))).total).toBe(2);
    expect((await repo.auditHistory(ctx, { period, deviceId: 'iphone-device-0002', q: '' }, pageReq({}))).total).toBe(1);
    expect((await repo.auditHistory(ctx, { period, q: 'patio' }, pageReq({}))).items.map((x) => x.action)).toEqual(['pos_settings_terminal_tested', 'pos_settings_terminal_paired']);
    const p2 = await repo.auditHistory(ctx, { period, q: '' }, pageReq({ page: 2, pageSize: 2 }));
    expect(p2).toMatchObject({ page: 2, total: 3, pageCount: 2 }); expect(p2.items.length).toBe(1);
    const yesterday = resolvePeriod({ preset: 'custom', from: '2020-01-01', to: '2020-01-02' }, TZ);
    expect((await repo.auditHistory(ctx, { period: yesterday, q: '' }, pageReq({}))).total).toBe(0);
  });
});
