// queue-assign.postgres-race.vitest.spec.ts — Smooth Refresh spec §77/§106: several receptionists assigning the same
// waiting guest at once must produce ONE assignment, not a silent last-write-wins with every technician notified.
// TRUE concurrency needs real Postgres. Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { QueueAssignmentConflict } from './queue.dto';

const url = process.env.PG_RACE_URL;
const T = 'a4000000-0000-4000-8000-0000000000aa';
const B = 'b4000000-0000-4000-8000-0000000000bb';
const Q = 'f4000000-0000-4000-8000-0000000000ff';
const tech = (i: number) => `c4000000-0000-4000-8000-0000000000${(10 + i).toString(16).padStart(2, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: 'e4000000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyQueueRepository;

describe.skipIf(!url)('real-Postgres queue assignment race (Smooth Refresh spec §77, §106)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyQueueRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon Q', 'Race Salon Q', 'race-salon-q', 'RACEQ', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    for (let i = 0; i < 10; i++) await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${tech(i)}, ${T}, ${B}, ${'Tech' + i}, 'X', ${'Tech ' + i}, true) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('ten receptionists assign one waiting guest to ten technicians at once — one assignment, nine VERSION_CONFLICTs', async () => {
    await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db);
    await sql`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, status, source, priority) values (${Q}, ${T}, ${B}, 'Walk-in Guest', 'waiting', 'walk_in', 'normal')`.execute(db);
    // DETERMINISTIC race: hold SHARE on the table so every caller READS 'waiting / unassigned' and then blocks on its
    // UPDATE until released (a plain Promise.all finishes each transaction before the next connection opens).
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table pos_queue_items in share mode');
    const pending = Promise.allSettled(Array.from({ length: 10 }, (_, i) => repo.assign(ctx, Q, tech(i), { status: 'waiting', technicianId: null })));
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const results = await pending;
    const won = results.filter((r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<boolean>).value === true);
    expect(won).toHaveLength(1);
    const losers = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(losers).toHaveLength(9);
    expect(losers.every((r) => r.reason instanceof QueueAssignmentConflict && r.reason.code === 'VERSION_CONFLICT')).toBe(true);
    const row = (await sql<{ s: string; t: string }>`select status as s, assigned_technician_id as t from pos_queue_items where id = ${Q}`.execute(db)).rows[0];
    expect(row.s).toBe('assigned');
    expect(losers.every((r) => (r.reason as QueueAssignmentConflict).currentTechnicianId === row.t)).toBe(true);   // losers learn who won
  });

  it('a legitimate REASSIGNMENT (the caller saw the current technician) goes through; one based on the old assignee is refused', async () => {
    await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db);
    await sql`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, status, source, priority, assigned_technician_id) values (${Q}, ${T}, ${B}, 'Walk-in Guest', 'assigned', 'walk_in', 'normal', ${tech(0)})`.execute(db);
    expect(await repo.assign(ctx, Q, tech(1), { status: 'assigned', technicianId: tech(0) })).toBe(true);
    const err = await repo.assign(ctx, Q, tech(2), { status: 'assigned', technicianId: tech(0) }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentConflict);
    expect(err.currentTechnicianId).toBe(tech(1));
  });
});

