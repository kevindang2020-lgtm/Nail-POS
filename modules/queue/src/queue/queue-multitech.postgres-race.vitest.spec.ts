// queue-multitech.postgres-race.vitest.spec.ts — multi-technician routing (contract §3/§8) under TRUE concurrency on
// real Postgres (PGlite is single-connection):
//   • the same plan from two desks with the same key → ONE write, both callers get the assignment
//   • two desks, two different plans on one guest → one winner, the loser 409, zero partial lines
//   • a party {X, Y} vs a visit plan {Y} at once, in both lock orders → no deadlock, exactly one owns Y (the party is
//     all or none, so X is assigned only when the party won)
//   • the auto-run (source auto_assign) vs a desk on a split visit → one winner
//   • both parts of a split visit finished at the same moment → the visit completes ONCE, one service.completed
// Opt-in: PG_RACE_URL=postgres://postgres@localhost:5432/race_mt_b (a database migrated through 569).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueService, QueueAssignmentConflict } from './queue.service';
import { KyselyTechRepository } from '../tech/tech.kysely.repository';

const url = process.env.PG_RACE_URL;
const P = 'a5699000-0000-4000-8000-';
const T = P + '000000000001', B = P + '000000000002', USER = P + '0000000000e1', CUST = P + '0000000000f1';
const CP = P + '0000000000c1', CM = P + '0000000000c2', CA = P + '0000000000c3';
const SP = P + '0000000000d1', SM = P + '0000000000d2', SA = P + '0000000000d3';
const TP = P + '0000000000a1', TM = P + '0000000000a2', TX = P + '0000000000a3', TY = P + '0000000000a4';
const LO = P + '000000000100', MID = P + '000000000200', HI = P + '000000000300';   // guest ids: fixed order
const SVCS = JSON.stringify([
  { serviceId: SP, serviceName: 'Pedicure', estimatedDurationMinutes: 50, priceCents: 6000 },
  { serviceId: SM, serviceName: 'Manicure', estimatedDurationMinutes: 40, priceCents: 4000 },
  { serviceId: SA, serviceName: 'Nail Art', estimatedDurationMinutes: 20, priceCents: 2000, isAddon: true, parentServiceId: SM },
]);
const PERMS = ['pos.queue.view', 'pos.queue.edit', 'pos.queue.assign_technician', 'pos.queue.move_to_tech_queue'];
const desk = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: PERMS } as any;
const tctx = { tenantId: T, branchId: B, userId: USER, role: 'TECHNICIAN', permissions: [] } as any;

let db: Kysely<any>; let pool: pg.Pool; let svc: QueueService; let tech: KyselyTechRepository;
const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
async function reset() {
  await q(`delete from outbox_events where tenant_id = $1`, [T]);
  for (const t of ['pos_tech_queue_tickets', 'queue_service_assignments', 'pos_queue_status_history', 'pos_queue_audit']) await q(`delete from ${t} where tenant_id = $1`, [T]);
  await q(`update pos_queue_items set ticket_id = null, group_id = null where tenant_id = $1`, [T]);
  await q(`delete from ticket_service_lines where tenant_id = $1`, [T]);
  await q(`delete from tickets where tenant_id = $1`, [T]);
  await q(`delete from pos_queue_items where tenant_id = $1`, [T]);
  await q(`delete from queue_groups where tenant_id = $1`, [T]);
}
async function guest(id: string, customerId: string | null = null) {
  await q(`insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, status, source, priority, requested_services) values ($1, $2, $3, $6, $4, 'waiting', 'walk_in', 'normal', $5)`, [id, T, B, 'Guest ' + id.slice(-3), SVCS, customerId]);
}
const version = async (id: string) => Number((await q(`select version from pos_queue_items where id = $1`, [id]))[0].version);
const plan = (id: string, v: number, [p, m, a]: string[]) => ({ queueItemId: id, expectedVersion: v, expectedTechnicianId: null,
  lines: [{ serviceId: SP, technicianId: p, expectedTechnicianId: null }, { serviceId: SM, technicianId: m, expectedTechnicianId: null }, { serviceId: SA, technicianId: a, expectedTechnicianId: null }] });
const linesOf = async (id: string) => (await q(`select technician_id from queue_service_assignments where queue_item_id = $1 and status <> 'cancelled' order by sequence`, [id])).map((r: any) => r.technician_id);
const planRows = async (id: string) => Number((await q(`select count(*)::int n from pos_queue_status_history where queue_item_id = $1 and action = 'assign_plan'`, [id]))[0].n);
/** Hold SHARE on the queue table so every caller reads the same state, then let them queue on their writes. */
async function race<R>(calls: (() => Promise<R>)[]) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query('lock table pos_queue_items in share mode');
  const pending = Promise.allSettled(calls.map((c) => c()));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query('commit'); gate.release();
  return pending;
}

describe.skipIf(!url)('real-Postgres: multi-technician plans under concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const outbox = new OutboxWriter();
    svc = new QueueService(new KyselyQueueRepository(db as any, outbox)); tech = new KyselyTechRepository(db as any, outbox);
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, 'Race MT B', 'Race MT B', 'race-mt-b', 'RACEMTB', 'active') on conflict (id) do nothing`, [T]);
    await q(`insert into branches (id, tenant_id, name, status) values ($1, $2, 'Main', 'active') on conflict (id) do nothing`, [B, T]);
    await q(`insert into users (id, tenant_id, full_name, status, role) values ($1, $2, 'Desk', 'active', 'CUSTOMER') on conflict (id) do nothing`, [USER, T]);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'Rita', 'R', 'Rita R') on conflict (id) do nothing`, [CUST, T, B]);
    await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1, $4, $5, 'Pedicure'), ($2, $4, $5, 'Manicure'), ($3, $4, $5, 'Nail Art') on conflict (id) do nothing`, [CP, CM, CA, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1, $7, $8, $4, 'Pedicure', 50, 6000), ($2, $7, $8, $5, 'Manicure', 40, 4000), ($3, $7, $8, $6, 'Nail Art', 20, 2000) on conflict (id) do nothing`, [SP, SM, SA, CP, CM, CA, T, B]);
    for (const [id, n] of [[TP, 'Pia'], [TM, 'Mo'], [TX, 'Xi'], [TY, 'Yu']]) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1, $2, $3, $4, 'T', $4, 'active') on conflict (id) do nothing`, [id, T, B, n]);
    for (const [t, s] of [[TP, SP], [TY, SP], [TM, SM], [TM, SA], [TX, SM], [TX, SA]]) await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1, $2, $3, $4) on conflict do nothing`, [T, B, t, s]);
  }, 120000);
  afterAll(async () => { await reset().catch(() => undefined); await db?.destroy(); });

  it('the same plan from two desks with the same key → one write; both callers get the assignment', async () => {
    await reset(); await guest(MID);
    const body = { items: [plan(MID, 1, [TP, TM, TM])], idempotencyKey: 'race-mt-same', source: 'staff' as const };
    const res = await race([() => svc.assignPlan(desk, body), () => svc.assignPlan(desk, body)]);
    const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(2);
    expect(ok.filter((r) => r.value.replayed)).toHaveLength(1);
    expect(ok.every((r) => r.value.items[0].assignedTechnicianId === TM && r.value.items[0].version === 2)).toBe(true);
    expect(await planRows(MID)).toBe(1);
    expect(await linesOf(MID)).toEqual([TP, TM, TM]);
  });

  it('two desks, two different plans on one guest → one winner, the loser 409, no partial lines', async () => {
    await reset(); await guest(MID);
    const res = await race([
      () => svc.assignPlan(desk, { items: [plan(MID, 1, [TP, TM, TM])], idempotencyKey: 'race-mt-a', source: 'staff' }),
      () => svc.assignPlan(desk, { items: [plan(MID, 1, [TY, TX, TX])], idempotencyKey: 'race-mt-b', source: 'staff' }),
    ]);
    const won = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const lost = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1); expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(QueueAssignmentConflict);
    const lines = await linesOf(MID);
    expect([[TP, TM, TM], [TY, TX, TX]]).toContainEqual(lines);   // all of one plan, nothing of the other
    expect(await planRows(MID)).toBe(1);
    expect((lost[0].reason as QueueAssignmentConflict).currentTechnicianId).toBe(won[0].value.items[0].assignedTechnicianId);
    expect(Number((await q(`select count(*)::int n from outbox_events where aggregate_id = $1 and event_type = 'queue.service_lines_assigned'`, [MID]))[0].n)).toBe(1);
  });

  for (const [label, X, Y] of [['Y locked first', HI, LO], ['X locked first', LO, HI]] as const) {
    it(`a party {X, Y} and a visit plan {Y} at once (${label}) → no deadlock, exactly one owns Y, the party is all or none`, async () => {
      await reset(); await guest(X); await guest(Y);
      const g = await svc.createGroup(desk, { label: 'Race party', queueItemIds: [X, Y], together: true });
      const vx = await version(X); const vy = await version(Y);
      const res = await race([
        () => svc.assignPlan(desk, { groupId: g.groupId, idempotencyKey: `race-mt-party-${label}`, source: 'staff', items: [plan(Y, vy, [TP, TM, TM]), plan(X, vx, [TY, TX, TX])] }),
        () => svc.assignPlan(desk, { idempotencyKey: `race-mt-visit-${label}`, source: 'staff', items: [plan(Y, vy, [TY, TX, TX])] }),
      ]);
      const won = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const lost = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(won).toHaveLength(1); expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(QueueAssignmentConflict);   // a 409, never a deadlock (40P01)
      expect(await planRows(Y)).toBe(1);
      const partyWon = won[0].value.items.length === 2;
      expect(await linesOf(Y)).toEqual(partyWon ? [TP, TM, TM] : [TY, TX, TX]);
      expect(await linesOf(X)).toEqual(partyWon ? [TY, TX, TX] : []);
      expect(await planRows(X)).toBe(partyWon ? 1 : 0);
    });
  }

  it('the auto-run and a desk on one split visit at once → one winner, the other refused, one set of lines', async () => {
    await reset(); await guest(MID);
    const res = await race([
      () => svc.assignPlan({ ...desk, system: true, permissions: PERMS } as any, { items: [plan(MID, 1, [TP, TM, TM])], idempotencyKey: 'auto:race-mt', source: 'auto_assign' }),
      () => svc.assignPlan(desk, { items: [plan(MID, 1, [TY, TX, TX])], idempotencyKey: 'race-mt-desk', source: 'staff' }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(QueueAssignmentConflict);
    expect([[TP, TM, TM], [TY, TX, TX]]).toContainEqual(await linesOf(MID));
    expect(await planRows(MID)).toBe(1);
  });

  it('both parts of a split visit finished at the same moment → the visit completes once, ONE service.completed', async () => {
    await reset(); await guest(MID, CUST);
    await svc.assignPlan(desk, { items: [plan(MID, 1, [TP, TM, TM])], idempotencyKey: 'race-mt-serve', source: 'staff' });
    await svc.moveToTechQueue(desk, MID);
    const parts = (await q(`select id from pos_tech_queue_tickets where queue_item_id = $1 order by visit_part`, [MID])).map((r: any) => r.id);
    expect(parts).toHaveLength(2);
    for (const p of parts) { await tech.accept(tctx, p); await tech.start(tctx, p); }
    const ticketId = (await q(`select ticket_id from pos_queue_items where id = $1`, [MID]))[0].ticket_id;
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table tickets in share mode');   // both reach their ticket write together
    const pending = Promise.allSettled(parts.map((p: string) => tech.complete(tctx, p, {} as any)));
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const settled = await pending;
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await q(`select status from tickets where id = $1`, [ticketId]))[0].status).toBe('service_done');
    expect((await q(`select status from pos_queue_items where id = $1`, [MID]))[0].status).toBe('completed');
    expect(Number((await q(`select count(*)::int n from outbox_events where event_type = 'service.completed' and aggregate_id = $1`, [ticketId]))[0].n)).toBe(1);
    expect(Number((await q(`select count(*)::int n from pos_queue_status_history where queue_item_id = $1 and to_status = 'completed'`, [MID]))[0].n)).toBe(1);
  });
});
