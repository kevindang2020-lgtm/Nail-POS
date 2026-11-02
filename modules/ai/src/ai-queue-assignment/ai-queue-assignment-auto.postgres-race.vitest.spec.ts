// ai-queue-assignment-auto.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 6, audit bug 5: the auto-run and a
// receptionist assign the SAME waiting guest at the same moment, both through the REAL QueueService + Kysely repository
// (round 2 — no fake). Exactly one assignment may win; the other is refused (never a silent overwrite), and the auto-run
// records an 'auto_assigned' decision only when IT won.
// TRUE concurrency needs real Postgres. Opt-in: PG_RACE_URL=postgres://... (a migrated database, e.g. race_p6_b).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { QueueService, KyselyQueueRepository } from '@aipowersalon/queue';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { QueueServiceDataAdapter, QueueAssignExecutionAdapter, QueueScanAdapter } from './ai-queue-assignment.adapters';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const url = process.env.PG_RACE_URL;
const T = 'a6b00000-0000-4000-8000-0000000000aa';
const B = 'a6b00000-0000-4000-8000-0000000000bb';
const CAT = 'a6b00000-0000-4000-8000-0000000000d1', SVC = 'a6b00000-0000-4000-8000-0000000000d2';
const AI_TECH = 'a6b00000-0000-4000-8000-0000000000c1';
const STAFF_TECH = 'a6b00000-0000-4000-8000-0000000000c2';
const USER = 'a6b00000-0000-4000-8000-0000000000ee';
const desk = { tenantId: T, branchId: B, userId: USER, role: 'FRONT_DESK', permissions: ['pos.queue.view', 'pos.queue.assign_technician'] } as any;
const system: QueueAssignmentContext = { tenantId: T, branchId: B, userId: '00000000-0000-0000-0000-000000000000', role: 'SYSTEM', permissions: [] };

let db: Kysely<any>; let pool: pg.Pool; let queue: QueueService; let svc: QueueAssignmentService;

describe.skipIf(!url)('real-Postgres race: auto-run vs a receptionist on one guest, real QueueService (bug 5)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon P6B', 'Race Salon P6B', 'race-salon-p6b', 'RACEP6B', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, full_name, status, role) values (${USER}, ${T}, 'Desk', 'active', 'FRONT_DESK') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicures') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 4500) on conflict (id) do nothing`.execute(db);
    for (const [id, n] of [[AI_TECH, 'Kim'], [STAFF_TECH, 'Ana']]) {
      await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${id}, ${T}, ${B}, ${n}, 'X', ${n + ' X'}, 'active') on conflict (id) do nothing`.execute(db);
      await sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B}, ${id}, ${SVC}) on conflict do nothing`.execute(db);
    }
    await sql`delete from queue_assignment_settings where tenant_id = ${T}`.execute(db);
    // only Kim may be auto-picked, so the two writers always want DIFFERENT technicians for the one guest
    await new KyselyQueueAssignmentSettings(db).update({ tenantId: T, branchId: B }, { autoEnabled: true, autoConfidenceFloor: 0.5, autoDelaySeconds: 0, autoExclusions: { technicianIds: [STAFF_TECH] } }, { userId: null });
    queue = new QueueService(new KyselyQueueRepository(db as any, new OutboxWriter()));
    svc = new QueueAssignmentService(new KyselyQueueAssignmentRepository(db, new OutboxWriter()), new QueueServiceDataAdapter(queue), new InMemoryQueueAssignmentEntitlement(() => true), undefined,
      { settings: new KyselyQueueAssignmentSettings(db), scan: new QueueScanAdapter(queue), assign: new QueueAssignExecutionAdapter(queue) });
  });
  afterAll(async () => {
    for (const t of ['pos_queue_items', 'pos_queue_status_history', 'pos_queue_audit', 'queue_assignment_decisions', 'queue_assignment_candidates', 'queue_assignment_recommendations', 'outbox_events']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  const outcomes = { auto: 0, staff: 0 };
  for (let round = 0; round < 6; round++) {
    it(`round ${round + 1}: one assignment wins, the loser is refused, nothing is overwritten`, async () => {
      await sql`delete from queue_assignment_decisions where tenant_id = ${T}`.execute(db);
      await sql`update pos_queue_items set status = 'completed' where tenant_id = ${T} and status not in ('completed', 'cancelled')`.execute(db);
      const Q = String((await sql<any>`insert into pos_queue_items (tenant_id, branch_id, customer_name, status, source, priority, requested_services, checked_in_at)
        values (${T}, ${B}, 'Walk-in Guest', 'waiting', 'walk_in', 'normal', ${JSON.stringify([{ serviceId: SVC, serviceName: 'Gel Manicure', estimatedDurationMinutes: 45, priceCents: 4500 }])}::jsonb, now() - interval '10 minutes')
        returning id`.execute(db)).rows[0].id);

      // DETERMINISTIC race: the gate below holds the guest row so both writers READ "waiting / unassigned / version 1" and then
      // block on their UPDATE until released. Alternate who queues first so both orders are exercised.
      // The gate holds the guest's ROW (reads still see "waiting / unassigned / version 1"); writers queue on it in
      // arrival order — the tuple lock makes that queue FIFO, unlike a table lock both writers are granted together.
      const gate = await pool.connect();
      await gate.query('begin'); await gate.query('select 1 from pos_queue_items where id = $1 for update', [Q]);
      const gatePid = Number((await gate.query('select pg_backend_pid() as p')).rows[0].p);
      const settle = (p: Promise<any>) => p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
      // The order is made, not hoped for: the first writer is started and we WAIT until Postgres shows it queued on the
      // table lock; only then does the second start. Lock waiters are granted in arrival order, so the first one in
      // wins. (A timer-only stagger was flaky: the auto-run reads for longer than the stagger under load.)
      const blocked = async (n: number) => {   // n writers waiting, directly or in line, behind the gate
        for (let i = 0; i < 200; i++) {
          const rows = (await sql<{ pid: number; b: number[] }>`select pid, pg_blocking_pids(pid) as b from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`.execute(db)).rows;
          const behind = new Set<number>([gatePid]);
          for (let grew = true; grew;) { grew = false; for (const r of rows) if (!behind.has(r.pid) && r.b.some((x) => behind.has(Number(x)))) { behind.add(r.pid); grew = true; } }
          if (behind.size - 1 >= n) return; await new Promise((res) => setTimeout(res, 25));
        }
        throw new Error(`expected ${n} writer(s) waiting behind the gate`);
      };
      const runAuto = () => settle(svc.runAutoAssignment(system, { system: true }));
      const runDesk = () => settle(queue.assignTechnician(desk, Q, { technicianId: STAFF_TECH, expectedTechnicianId: null, expectedVersion: 1 } as any));
      const autoFirst = round % 2 === 0;
      const firstP = autoFirst ? runAuto() : runDesk();
      await blocked(1);
      const secondP = autoFirst ? runDesk() : runAuto();
      await blocked(2);
      await gate.query('commit'); gate.release();
      const [autoP, deskP] = autoFirst ? [firstP, secondP] : [secondP, firstP];
      const [a, d] = await Promise.all([autoP, deskP]);
      expect(a.ok).toBe(true);
      const auto = (a as any).v;

      const row = (await sql<any>`select assigned_technician_id as t, version from pos_queue_items where id = ${Q}`.execute(db)).rows[0];
      const autoWon = auto.assigned === 1;
      expect(autoWon).toBe(autoFirst);                                         // the first writer in line wins
      const deskWon = d.ok;
      expect(Number(autoWon) + Number(deskWon)).toBe(1);                         // exactly one assignment
      expect(row.t).toBe(autoWon ? AI_TECH : STAFF_TECH);                         // and it is the one that stands
      expect(Number(row.version)).toBe(2);                                       // one write, one version bump
      const assigns = (await sql<any>`select source from pos_queue_status_history where queue_item_id = ${Q} and action in ('assign', 'auto_assign')`.execute(db)).rows;
      expect(assigns).toHaveLength(1);
      const decisions = (await sql<any>`select decision, chosen_technician from queue_assignment_decisions where tenant_id = ${T}`.execute(db)).rows;
      if (autoWon) {
        outcomes.auto++;
        expect(assigns[0].source).toBe('auto_assign');
        expect(decisions).toEqual([{ decision: 'auto_assigned', chosen_technician: AI_TECH }]);
        expect((d as any).e?.code).toBe('VERSION_CONFLICT');
      } else {
        outcomes.staff++;
        expect(assigns[0].source).toBe('staff');
        expect(auto.skipped).toEqual([{ queueEntryId: Q, reason: 'changed_meanwhile' }]);
        expect(decisions).toEqual([]);                                          // the auto-run logs nothing it did not do
      }
    });
  }
  it('both orders were exercised', () => { expect(outcomes.auto).toBeGreaterThan(0); expect(outcomes.staff).toBeGreaterThan(0); });
});
