// pay-merge.postgres-race.vitest.spec — merge Oct 12 2026 (PAY: ONE Service Done, durable sessions 586, line allocations
// 587, refund idempotency 588) under REAL concurrency. Real Postgres (opt-in: PG_RACE_URL=postgres://… a migrated database).
// DETERMINISTIC: a gate connection holds the row the code path locks (or the table it inserts into), both callers pile up
// behind it, the gate releases, and the database decides. PGlite (one session) cannot show any of these.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { CompensationService, KyselyCompensationPorts, allocateHelperOnLine } from '@aipowersalon/workforce';
import { completeServiceDone } from '../service-done/service-done-transition';
import { KyselyServingRepository } from './serving.kysely.repository';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e7a7a7a7-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), CUST = id(3), MIA = id(4), AVA = id(5), LEO = id(6), CAT = id(7), SVC = id(8), U = id(9);
let pool: pg.Pool; let db: Kysely<any>;
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['*'] } as any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 100;
async function ticket(techId: string | null, status = 'serving', paid = false) {
  const t = id(++seq);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, total_cents, paid_at) values ($1,$2,$3,$4,$5,$6,$7,4500,4500, case when $8 then now() else null end)`, [t, T, B, CUST, techId, status, 'R' + seq, paid]);
  const l = id(++seq);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,'Manicure',4500,45,4500,'serving','percent',60)`, [l, T, B, t, SVC, techId]);
  return { t, l };
}
async function cleanup() {
  for (const tbl of ['compensation_adjustments', 'ticket_compensation_snapshots', 'ticket_tip_allocations', 'ticket_service_line_allocations', 'ticket_service_sessions', 'ticket_service_lines', 'tickets', 'outbox_events']) await q(`delete from ${tbl} where tenant_id = $1`, [T]).catch(() => undefined);
}

describe.skipIf(!url)('real-Postgres PAY merge races', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await cleanup();
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'Race PAY','Race PAY','race-pay','RACEPAY','active',50) on conflict (id) do nothing`, [T]);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York') on conflict (id) do nothing`, [B, T]);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Race','Ann Race') on conflict (id) do nothing`, [CUST, T, B]);
    await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails') on conflict (id) do nothing`, [CAT, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Manicure',45,4500) on conflict (id) do nothing`, [SVC, T, B, CAT]);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$4,$5,'Mia','R','Mia R','active',true), ($2,$4,$5,'Ava','R','Ava R','active',true), ($3,$4,$5,'Leo','R','Leo R','active',true) on conflict (id) do nothing`, [MIA, AVA, LEO, T, B]);
  }, 60_000);
  afterAll(async () => { await cleanup(); await db?.destroy(); });

  it('mark-done and send-to-Service-Done of ONE ticket at once: one completion, one service.completed fact, the other is a duplicate', async () => {
    const { t } = await ticket(MIA);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select id from tickets where id = $1 for update', [t]);
    const outbox = new OutboxWriter();
    const pending = Promise.allSettled([
      completeServiceDone(db, { outbox }, { tenantId: T, branchId: B, ticketId: t, actor: { userId: U }, source: 'serving_mark_done' }),
      completeServiceDone(db, { outbox }, { tenantId: T, branchId: B, ticketId: t, actor: { userId: U }, source: 'serving_send', lock: true }),
    ]);
    await wait(600);
    await gate.query('commit'); gate.release();
    const rs = await pending;
    expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
    const vals = rs.map((r: any) => r.value);
    expect(vals.filter((v) => !v.duplicate)).toHaveLength(1);
    expect(Number((await q(`select count(*)::int n from outbox_events where tenant_id = $1 and aggregate_id = $2 and event_type = 'service.completed'`, [T, t]))[0].n)).toBe(1);
    expect(Number((await q(`select count(*)::int n from ticket_service_sessions where ticket_id = $1 and is_helper = false and idempotency_key is not null`, [t]))[0].n)).toBe(1);
    expect((await q(`select status from tickets where id = $1`, [t]))[0].status).toBe('service_done');
  });

  it('two tickets started for the SAME technician at once: the 586 partial unique index lets exactly one session live', async () => {
    const a = await ticket(AVA, 'accepted'); const b = await ticket(AVA, 'accepted');
    const repo = new KyselyServingRepository(db as any, null);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table ticket_service_sessions in share row exclusive mode');
    const pending = Promise.allSettled([repo.start(ctx, a.t), repo.start(ctx, b.t)]);
    await wait(600);
    await gate.query('commit'); gate.release();
    const rs = await pending;
    const ok = rs.filter((r: any) => r.status === 'fulfilled' && r.value === true);
    expect(ok).toHaveLength(1);
    expect(rs.some((r: any) => (r.status === 'rejected' && /ServingSessionConflict|already serving/i.test(String(r.reason?.name ?? '') + String(r.reason?.message ?? ''))) || (r.status === 'fulfilled' && r.value === false))).toBe(true);
    expect(Number((await q(`select count(*)::int n from ticket_service_sessions where tenant_id = $1 and technician_id = $2 and status in ('STARTED','PAUSED') and is_helper = false`, [T, AVA]))[0].n)).toBe(1);
  });

  it('the SAME refund reversal replayed concurrently: commission is reversed exactly once (588 unique index, ON CONFLICT DO NOTHING)', async () => {
    const { t } = await ticket(LEO, 'paid', true);
    const svc = new CompensationService(new KyselyCompensationPorts(db as any), { warn: () => undefined, error: () => undefined });
    expect((await svc.snapshotPaidTicket({ tenantId: T, branchId: B }, t)).ok).toBe(true);
    const refundPaymentId = id(++seq);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table compensation_adjustments in share row exclusive mode');
    const ev = { type: 'full' as const, tipRefunded: true, refundPaymentId };
    const pending = Promise.all([0, 1, 2].map(() => svc.reverseForRefund({ tenantId: T, branchId: B }, t, ev, { reason: 'race', requestedBy: U })));
    await wait(600);
    await gate.query('commit'); gate.release();
    await pending;
    const rows = await q(`select amount_cents from compensation_adjustments where ticket_id = $1 and refund_payment_id = $2`, [t, refundPaymentId]);
    const earned = Number((await q(`select coalesce(sum(tech_service_earnings_cents),0)::int s from ticket_compensation_snapshots where ticket_id = $1`, [t]))[0].s);
    expect(rows.reduce((s, r) => s + Number(r.amount_cents), 0)).toBe(-earned);   // once, not three times
  });

  it('two helpers accepted on ONE line at once: the line ends with ONE whole allocation set (Σ 10000 bps), neither call fails', async () => {
    const { t, l } = await ticket(MIA);
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('select id from ticket_service_lines where id = $1 for update', [l]);
    const pending = Promise.allSettled([
      allocateHelperOnLine(db as any, { tenantId: T, ticketId: t, lineId: l, helperTechnicianId: AVA }),
      allocateHelperOnLine(db as any, { tenantId: T, ticketId: t, lineId: l, helperTechnicianId: LEO }),
    ]);
    await wait(600);
    await gate.query('commit'); gate.release();
    const rs = await pending;
    expect(rs.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const rows = await q(`select technician_id, share_bps, role from ticket_service_line_allocations where line_id = $1`, [l]);
    expect(rows.reduce((s, r) => s + Number(r.share_bps), 0)).toBe(10000);
    expect(rows.filter((r) => r.role === 'PRIMARY')).toHaveLength(1);
    expect(rows.find((r) => r.role === 'PRIMARY')!.technician_id).toBe(MIA);
  });
});
