// branch-health.pgtest — BUILD_PLAN Phase 14 B (Constitution 11 §345): branch health snapshots on the REAL migrated schema.
//   • facts per branch from the operational tables, every query tenant-scoped; one row per branch per 15-minute slot
//     (a second run in the slot is a no-op); one queue job per ACTIVE salon per slot;
//   • the overall comes from explicit rules (payments failing, long wait, devices offline while open, idle);
//   • a failed fact query is UNKNOWN + named, never zero / HEALTHY;
//   • an owner sees ONLY their own salon's branches; Super Admin sees every branch, worst first.
// Every timestamp is relative to a FIXED clock passed in — nothing reads the database's now().
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { jobHandlerFor } from '@aipowersalon/database';
import { BranchHealthService, BranchHealthSnapshots, BRANCH_SNAPSHOT_JOB, evaluateBranchHealth, emptyFacts, snapshotSlotOf } from './branch-health';
import { seedRow } from '../events/pgtest-seed';

const A = '5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a', B = '5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b', C = '5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c5c';
const A1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', A2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', B1 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const CA = 'ca5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a', CB = 'cb5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b';
const NOW = new Date('2026-10-01T12:07:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();   // minutes relative to NOW
let pg: any; let db: any; let snaps: BranchHealthSnapshots;

const count = async (table: string, where = sql`true`) => Number((await sql<any>`select count(*)::int n from ${sql.table(table)} where ${where}`.execute(db)).rows[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: A, legal_name: 'A', display_name: 'Alpha Nails', tenant_slug: 'alphanails5', tenant_code: 'ALPH05', status: 'active' });
  await seedRow(pg, 'tenants', { id: B, legal_name: 'B', display_name: 'Bravo Spa', tenant_slug: 'bravospa5', tenant_code: 'BRAV05', status: 'active' });
  await seedRow(pg, 'tenants', { id: C, legal_name: 'C', display_name: 'Closed', tenant_slug: 'closed5', tenant_code: 'CLOS05', status: 'cancelled' });
  await seedRow(pg, 'branches', { id: A1, tenant_id: A, name: 'Alpha Main', status: 'active' });
  await seedRow(pg, 'branches', { id: A2, tenant_id: A, name: 'Alpha East', status: 'active' });
  await seedRow(pg, 'branches', { id: B1, tenant_id: B, name: 'Bravo One', status: 'active' });
  await seedRow(pg, 'customers', { id: CA, tenant_id: A });
  await seedRow(pg, 'customers', { id: CB, tenant_id: B });
  // A1 — busy and in trouble: 2 open tickets (+1 paid), 3 waiting (oldest 87 min), 2 techs on shift, 6 payments 3 failed,
  // a display offline and a kiosk online, 1 terminal paired, an outbox event, 2 SMS 1 failed.
  for (const [i, status, paid] of [[1, 'open', null], [2, 'in_service', null], [3, 'paid', at(-30)]] as const)
    await seedRow(pg, 'tickets', { id: `00000000-0000-4000-8000-00000000a10${i}`, tenant_id: A, branch_id: A1, customer_id: CA, status, paid_at: paid, created_at: at(-60), updated_at: at(-60) });
  for (const [i, checked] of [[1, -87], [2, -20], [3, -5]] as const)
    await seedRow(pg, 'pos_queue_items', { id: `00000000-0000-4000-8000-00000000b10${i}`, tenant_id: A, branch_id: A1, customer_name: 'Guest', status: 'waiting', source: 'walk_in', priority: 'normal', checked_in_at: at(checked), created_at: at(checked), updated_at: at(checked) });
  for (const [i, status] of [[1, 'available'], [2, 'busy'], [3, 'off']] as const)
    await seedRow(pg, 'technicians', { id: `00000000-0000-4000-8000-00000000c10${i}`, tenant_id: A, branch_id: A1, first_name: 'T', last_name: String(i), full_name: `T ${i}`, status, is_active: true });
  for (let i = 1; i <= 6; i++)
    await seedRow(pg, 'payment_attempts', { tenant_id: A, branch_id: A1, ticket_id: `00000000-0000-4000-8000-00000000a101`, amount_cents: 1000, method: 'card', status: i <= 3 ? 'failed' : 'succeeded', idempotency_key: `pa-${i}`, created_at: at(-10), updated_at: at(-10) });
  await seedRow(pg, 'payment_attempts', { tenant_id: A, branch_id: A1, ticket_id: `00000000-0000-4000-8000-00000000a101`, amount_cents: 1000, method: 'card', status: 'failed', idempotency_key: 'pa-old', created_at: at(-120), updated_at: at(-120) });   // outside the hour
  await seedRow(pg, 'customer_display_devices', { tenant_id: A, branch_id: A1, pairing_status: 'paired', last_seen_at: at(-120), created_at: at(-999), updated_at: at(-999) });
  await seedRow(pg, 'go_checkin_devices', { tenant_id: A, branch_id: A1, device_name: 'Kiosk', checkin_slug: 'alpha-main-k', status: 'active', last_seen_at: at(-2), created_at: at(-999), updated_at: at(-999) });
  await seedRow(pg, 'pos_payment_terminals', { id: 'term-1', tenant_id: A, branch_id: A1, label: 'Front', status: 'paired' });
  await seedRow(pg, 'outbox_events', { id: '00000000-0000-4000-8000-00000000e101', event_type: 'ticket.updated', tenant_id: A, branch_id: A1, aggregate_type: 'ticket', aggregate_id: 't', correlation_id: 'c', payload_json: '{}', occurred_at: at(-37) });
  await seedRow(pg, 'sms_usage_records', { tenant_id: A, branch_id: A1, purpose: 'BOOKING_VERIFICATION', status: 'DELIVERED', created_at: at(-15) });
  await seedRow(pg, 'sms_usage_records', { tenant_id: A, branch_id: A1, purpose: 'BOOKING_VERIFICATION', status: 'FAILED', created_at: at(-14) });
  // B1 — trading normally: one open ticket, kiosk online. B's data must never reach A's owner.
  await seedRow(pg, 'tickets', { id: '00000000-0000-4000-8000-00000000b901', tenant_id: B, branch_id: B1, customer_id: CB, status: 'open', created_at: at(-30), updated_at: at(-30) });
  await seedRow(pg, 'go_checkin_devices', { tenant_id: B, branch_id: B1, device_name: 'Kiosk', checkin_slug: 'bravo-one-k', status: 'active', last_seen_at: at(-1), created_at: at(-999), updated_at: at(-999) });
  expect(await count('tickets', sql`tenant_id = ${A}`)).toBe(3);
  expect(await count('payment_attempts', sql`tenant_id = ${A}`)).toBe(7);
  expect(await count('pos_queue_items', sql`tenant_id = ${A}`)).toBe(3);
  snaps = new BranchHealthSnapshots(new BranchHealthService(db), db);
  snaps.onModuleInit();   // registers the queue job handler (NODE_ENV=test: no timer)
});

describe('evaluateBranchHealth (pure)', () => {
  const f = (o: Partial<ReturnType<typeof emptyFacts>>) => ({ ...emptyFacts(), openTickets: 0, queueWaiting: 0, paymentsLastHour: 0, paymentsFailedLastHour: 0, smsSentLastHour: 0, smsFailedLastHour: 0, displaysTotal: 0, displaysOnline: 0, kiosksTotal: 0, kiosksOnline: 0, ...o });
  it('half the payments failing on volume is an OUTAGE; a fifth is DEGRADED; below volume is noise', () => {
    expect(evaluateBranchHealth(f({ paymentsLastHour: 6, paymentsFailedLastHour: 3 })).overall).toBe('OUTAGE');
    expect(evaluateBranchHealth(f({ paymentsLastHour: 10, paymentsFailedLastHour: 2 }))).toEqual({ overall: 'DEGRADED', reasons: ['payment_failures'] });
    expect(evaluateBranchHealth(f({ paymentsLastHour: 4, paymentsFailedLastHour: 4 }))).toEqual({ overall: 'HEALTHY', reasons: ['ok'] });
  });
  it('a guest waiting an hour or more is DEGRADED long_wait', () => {
    expect(evaluateBranchHealth(f({ queueWaiting: 1, queueLongestWaitSeconds: 3600 })).reasons).toContain('long_wait');
    expect(evaluateBranchHealth(f({ queueWaiting: 1, queueLongestWaitSeconds: 3599 })).overall).toBe('HEALTHY');
  });
  it('devices offline only matter while the branch is open', () => {
    expect(evaluateBranchHealth(f({ openTickets: 1, kiosksTotal: 1, kiosksOnline: 0 })).reasons).toEqual(['devices_offline_while_open']);
    expect(evaluateBranchHealth(f({ kiosksTotal: 1, kiosksOnline: 0 }))).toEqual({ overall: 'UNKNOWN', reasons: ['idle'] });
  });
  it('SMS mostly failing is DEGRADED; no activity is UNKNOWN idle, never HEALTHY', () => {
    expect(evaluateBranchHealth(f({ smsSentLastHour: 6, smsFailedLastHour: 3 })).reasons).toEqual(['sms_failing']);
    expect(evaluateBranchHealth(f({}))).toEqual({ overall: 'UNKNOWN', reasons: ['idle'] });
  });
  it('a failed fact query can never read HEALTHY — UNKNOWN, named; a real finding still wins', () => {
    expect(evaluateBranchHealth(f({ openTickets: 2 }), ['payments'])).toEqual({ overall: 'UNKNOWN', reasons: ['query_failed:payments'] });
    expect(evaluateBranchHealth(f({ paymentsLastHour: 6, paymentsFailedLastHour: 6 }), ['sms']).overall).toBe('OUTAGE');
  });
});

describe('§345 snapshots on the migrated schema', () => {
  it('facts per branch, tenant-scoped', async () => {
    const { branches, failed } = await new BranchHealthService(db).facts(A, NOW);
    expect(failed).toEqual([]);
    expect(branches.map((b) => b.branchName)).toEqual(['Alpha East', 'Alpha Main']);
    const main = branches.find((b) => b.branchId === A1)!.facts;
    expect(main).toMatchObject({ openTickets: 2, queueWaiting: 3, queueLongestWaitSeconds: 87 * 60, techniciansOnShift: 2, paymentsLastHour: 6, paymentsFailedLastHour: 3,
      displaysTotal: 1, displaysOnline: 0, kiosksTotal: 1, kiosksOnline: 1, terminalsPaired: 1, lastRealtimeEventAt: at(-37), smsSentLastHour: 2, smsFailedLastHour: 1 });
    const east = branches.find((b) => b.branchId === A2)!.facts;
    expect(east).toMatchObject({ openTickets: 0, queueWaiting: 0, queueLongestWaitSeconds: null, paymentsLastHour: 0, lastRealtimeEventAt: null });
  });

  it('one row per branch per slot; a second run in the slot stores nothing; the next slot adds rows', async () => {
    expect(await snaps.snapshotTenant(A, NOW)).toBe(2);
    expect(await snaps.snapshotTenant(A, new Date(NOW.getTime() + 5 * 60_000))).toBe(0);
    const row = (await sql<any>`select * from branch_health_snapshots where branch_id = ${A1}`.execute(db)).rows[0];
    expect(row.overall_status).toBe('OUTAGE');
    expect(row.reasons).toEqual(['payments_failing', 'long_wait']);
    expect(new Date(row.snapshot_slot).toISOString()).toBe(snapshotSlotOf(NOW).toISOString());
    expect(new Date(row.snapshot_slot).toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect((await sql<any>`select overall_status, reasons from branch_health_snapshots where branch_id = ${A2}`.execute(db)).rows[0]).toEqual({ overall_status: 'UNKNOWN', reasons: ['idle'] });
    expect(await snaps.snapshotTenant(A, new Date(NOW.getTime() + 15 * 60_000))).toBe(2);
    expect(await count('branch_health_snapshots', sql`tenant_id = ${A}`)).toBe(4);
  });

  it('dispatch: one job per ACTIVE salon per slot (the cancelled salon gets none); a second dispatch in the slot adds none', async () => {
    const first = await snaps.dispatch(NOW);
    const again = await snaps.dispatch(new Date(NOW.getTime() + 60_000));
    expect(first).toEqual({ salons: 2, enqueued: 2, duplicates: 0 });
    expect(again).toEqual({ salons: 2, enqueued: 0, duplicates: 2 });
    expect((await sql<any>`select tenant_id from jobs where job_type = ${BRANCH_SNAPSHOT_JOB} order by tenant_id`.execute(db)).rows.map((r) => r.tenant_id)).toEqual([A, B]);
  });

  it('the queue job handler snapshots the salon it was enqueued for', async () => {
    const handler = jobHandlerFor(BRANCH_SNAPSHOT_JOB)!;
    expect(handler).toBeTypeOf('function');
    const out = await handler({ observedAt: NOW.toISOString() }, { tenantId: B } as any);
    expect(out).toEqual({ stored: 1 });
    expect((await sql<any>`select overall_status from branch_health_snapshots where branch_id = ${B1}`.execute(db)).rows[0].overall_status).toBe('HEALTHY');
    await expect(handler({}, { tenantId: B } as any)).rejects.toThrow(/observedAt/);
  });

  it('owner: ONLY their own salon\'s branches, worst first; a branch never snapshotted shows snapshot null', async () => {
    await seedRow(pg, 'branches', { id: '00000000-0000-4000-8000-0000000000a3', tenant_id: A, name: 'Alpha New', status: 'active' });
    const a = await snaps.forTenant(A, NOW);
    expect(a.branches.map((b) => b.branchName)).toEqual(['Alpha Main', 'Alpha East', 'Alpha New']);
    expect(a.branches[0].snapshot?.overall).toBe('OUTAGE');
    expect(a.branches[0].snapshot?.observedAt).toBe(new Date(NOW.getTime() + 15 * 60_000).toISOString());   // the LATEST row
    expect(a.branches[2].snapshot).toBeNull();
    expect(JSON.stringify(a)).not.toContain(B1);
    const b = await snaps.forTenant(B, NOW);
    expect(b.branches.map((x) => x.branchId)).toEqual([B1]);
    expect(JSON.stringify(b)).not.toContain(A1);
  });

  it('Super Admin: latest per branch across salons, worst first, status filter, counts', async () => {
    const all = await snaps.list('worst', undefined, {}, NOW);
    expect(all.rows.map((r) => r.branchName)).toEqual(['Alpha Main', 'Alpha East', 'Bravo One']);
    expect(all.rows[0]).toMatchObject({ tenantId: A, tenantName: 'Alpha Nails', overall: 'OUTAGE', openTickets: 2 });
    expect(all.counts).toEqual({ OUTAGE: 1, UNKNOWN: 1, HEALTHY: 1 });
    const outage = await snaps.list('worst', 'OUTAGE', {}, NOW);
    expect(outage.rows.map((r) => r.branchId)).toEqual([A1]);
    expect(outage.total).toBe(1);
    const page = await snaps.list('name', undefined, { limit: 2 }, NOW);
    expect(page.rows).toHaveLength(2); expect(page.nextCursor).not.toBeNull();
    const next = await snaps.list('name', undefined, { limit: 2, cursor: page.nextCursor }, NOW);
    expect(next.rows.map((r) => r.branchName)).toEqual(['Bravo One']);
  });

  it('a fact query that fails is stored UNKNOWN + named — never zeros dressed as data', async () => {
    const bind = (o: any, k: PropertyKey) => { const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; };
    const failing = new Proxy(db, { get(t, p) {
      if (p !== 'getExecutor') return bind(t, p);
      return () => { const ex = t.getExecutor(); return new Proxy(ex, { get(e, q) {
        if (q !== 'executeQuery') return bind(e, q);
        return (c: any, id: any) => (/from sms_usage_records/.test(c.sql) ? Promise.reject(new Error('relation does not exist')) : e.executeQuery(c, id));
      } }); };
    } });
    await sql`update go_checkin_devices set last_seen_at = ${at(29)} where tenant_id = ${B}`.execute(db);   // still online at NOW+30
    const s = new BranchHealthSnapshots(new BranchHealthService(failing), db);
    expect(await s.snapshotTenant(B, new Date(NOW.getTime() + 30 * 60_000))).toBe(1);
    const row = (await sql<any>`select * from branch_health_snapshots where branch_id = ${B1} order by observed_at desc limit 1`.execute(db)).rows[0];
    expect(row.overall_status).toBe('UNKNOWN');
    expect(row.failed_queries).toEqual(['sms']);
    expect(row.sms_sent_last_hour).toBeNull();
    expect(row.open_tickets).toBe(1);   // the facts that worked are kept
  });
});
