// queue-phase6.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 6: TRUE concurrency on real Postgres (PGlite is
// single-connection). Two staff / AI callers assigning one guest at the same moment → exactly one assignment; a caller
// holding a stale version is refused; two retries of the same idempotent decision → one write.
// Opt-in: PG_RACE_URL=postgres://postgres@localhost:5432/race_p6_a (a database migrated through 525).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueService, QueueAssignmentConflict } from './queue.service';

const url = process.env.PG_RACE_URL;
const T = 'a6100000-0000-4000-8000-0000000000aa';
const B = 'a6100000-0000-4000-8000-0000000000bb';
const Q = 'a6100000-0000-4000-8000-0000000000ff';
const tech = (i: number) => `a6100000-0000-4000-8000-0000000000${(10 + i).toString(16).padStart(2, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: 'a6100000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: ['pos.queue.view', 'pos.queue.assign_technician'] } as any;

let db: Kysely<any>; let pool: pg.Pool; let svc: QueueService;
async function freshGuest() {
  await sql`delete from pos_queue_status_history where tenant_id = ${T}`.execute(db);
  await sql`delete from pos_queue_audit where tenant_id = ${T}`.execute(db);
  await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db);
  await sql`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, status, source, priority) values (${Q}, ${T}, ${B}, 'Walk-in Guest', 'waiting', 'walk_in', 'normal')`.execute(db);
}
/** Hold SHARE on the table so every caller reads "waiting / unassigned / version 1" and then queues on its UPDATE. */
async function race<T>(calls: (() => Promise<T>)[]) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query('lock table pos_queue_items in share mode');
  const pending = Promise.allSettled(calls.map((c) => c()));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query('commit'); gate.release();
  return pending;
}

describe.skipIf(!url)('real-Postgres: one guest, concurrent assigns (BUILD_PLAN Phase 6)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    svc = new QueueService(new KyselyQueueRepository(db as any));
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P6 A', 'Race P6 A', 'race-p6-a', 'RACEP6A', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    for (let i = 0; i < 4; i++) await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${tech(i)}, ${T}, ${B}, ${'Tech' + i}, 'X', ${'Tech ' + i}, 'active') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('a receptionist and the AI assign the same waiting guest at once → exactly one wins, the other gets 409', async () => {
    await freshGuest();
    const results = await race([
      () => svc.assignTechnician(ctx, Q, { technicianId: tech(0), expectedTechnicianId: null, expectedVersion: 1 }),
      () => svc.assignTechnician(ctx, Q, { technicianId: tech(1), expectedTechnicianId: null, expectedVersion: 1, source: 'ai_suggestion' }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(QueueAssignmentConflict);
    const row = (await sql<{ t: string; v: number }>`select assigned_technician_id as t, version as v from pos_queue_items where id = ${Q}`.execute(db)).rows[0];
    expect(row.v).toBe(2);
    expect((lost[0].reason as QueueAssignmentConflict).currentTechnicianId).toBe(row.t);
    const h = (await sql<{ n: number }>`select count(*)::int as n from pos_queue_status_history where queue_item_id = ${Q} and action = 'assign'`.execute(db)).rows[0];
    expect(h.n).toBe(1);   // one assignment, one history row — the loser left nothing behind
  });

  it('two older boards that send only expectedTechnicianId (no version) still produce ONE assignment', async () => {
    await freshGuest();
    const results = await race([0, 1, 2].map((i) => () => svc.assignTechnician(ctx, Q, { technicianId: tech(i), expectedTechnicianId: null })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason instanceof QueueAssignmentConflict)).toHaveLength(2);
    expect((await sql<{ n: number }>`select count(*)::int as n from pos_queue_status_history where queue_item_id = ${Q} and action = 'assign'`.execute(db)).rows[0].n).toBe(1);
  });

  it('a stale expectedVersion is refused even when the assignee looks unchanged', async () => {
    await freshGuest();
    await sql`update pos_queue_items set priority = 'vip' where id = ${Q}`.execute(db);   // version 2 (the trigger)
    const err = await svc.assignTechnician(ctx, Q, { technicianId: tech(2), expectedTechnicianId: null, expectedVersion: 1, source: 'auto_assign' }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err.currentVersion).toBe(2);
  });

  it('the same idempotency key retried concurrently writes once; both callers get the assignment', async () => {
    await freshGuest();
    const body = { technicianId: tech(3), expectedTechnicianId: null, source: 'ai_suggestion' as const, idempotencyKey: 'race-p6-key' };
    const results = await race([() => svc.assignTechnician(ctx, Q, body), () => svc.assignTechnician(ctx, Q, body)]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(2);   // the twin that lost the compare-and-set replays the key instead of a 409
    expect(ok.every((r) => r.value.assignedTechnicianId === tech(3) && r.value.version === 2)).toBe(true);
    const n = (await sql<{ n: number }>`select count(*)::int as n from pos_queue_status_history where tenant_id = ${T} and action = 'assign'`.execute(db)).rows[0].n;
    expect(n).toBe(1);
  });
});
