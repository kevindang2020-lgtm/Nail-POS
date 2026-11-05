// ai-queue-assignment-ops.postgres-race.vitest.spec — BUILD_PLAN Phase 6, round 2: the ops background work under TRUE
// concurrency (real Postgres; PGlite is single-connection). Opt-in: PG_RACE_URL=postgres://... (a migrated database).
//   • two dispatchers ticking at the same moment (two processes whose runTick leases overlapped, or a clock skew)
//     enqueue exactly ONE scan job per branch per minute — the jobs (job_type, idempotency_key) unique index;
//   • several scans of one branch at once (the per-minute job + staff "Scan now" + a retried job) raise exactly ONE
//     alert per (guest, type) — the per-branch advisory lock, backed by uq_qalerts_active — and none of them fails
//     with a raw database error.
// Each race is DETERMINISTIC: a gate connection holds a SHARE lock on the table the writers insert into, so every
// caller has read its state and is blocked on its write when the gate opens (a plain Promise.all would mostly run them
// one after another).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { dispatchQueueOpsJobs, QUEUE_OPS_JOB } from './ai-queue-assignment-ops.jobs';
import { QueueAlertService } from './ai-queue-assignment-alerts.service';
import { KyselyQueueAlertRepository } from './ai-queue-assignment-alerts.repository';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueOps, queueOpsSystemContext } from './ai-queue-assignment-ops.ports';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `c6c6c6c6-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B1 = id(2), B2 = id(3);
let pool: pg.Pool; let db: Kysely<any>;

async function gated<T>(table: string, run: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query(`lock table ${table} in share mode`);
  const pending = Promise.allSettled(run());
  await new Promise((r) => setTimeout(r, 500));
  await gate.query('commit'); gate.release();
  return pending;
}

describe.skipIf(!url)('real-Postgres AI queue ops races', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Ops C', 'Race Ops C', 'race-ops-c', 'RACEOPSC', 'active') on conflict (id) do nothing`.execute(db);
    for (const b of [B1, B2]) await sql`insert into branches (id, tenant_id, name, status) values (${b}, ${T}, ${'Branch ' + b.slice(-1)}, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into tenant_ai_subscriptions (tenant_id, package_code, status) select ${T}, 'ai_queue_technician_assignment', 'active'
              where not exists (select 1 from tenant_ai_subscriptions where tenant_id = ${T} and package_code = 'ai_queue_technician_assignment')`.execute(db);
    await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db);
    for (const b of [B1, B2]) await sql`insert into pos_queue_items (tenant_id, branch_id, customer_name, status) values (${T}, ${b}, 'Race Guest', 'waiting')`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from jobs where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from queue_alerts where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('eight dispatchers at the same moment → exactly one scan job per branch for that minute, none fails', async () => {
    await sql`delete from jobs where tenant_id = ${T}`.execute(db);
    const now = Date.parse('2026-10-07T21:30:15Z');
    const results = await gated('jobs', () => Array.from({ length: 8 }, () => dispatchQueueOpsJobs(db, now)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const rows = (await sql<{ branch: string; n: number }>`select payload->>'branchId' as branch, count(*)::int as n from jobs where tenant_id = ${T} and job_type = ${QUEUE_OPS_JOB.scan} group by 1 order by 1`.execute(db)).rows;
    expect(rows).toEqual([{ branch: B1, n: 1 }, { branch: B2, n: 1 }]);
    // between them the dispatchers report each branch's job as new exactly once
    const fresh = results.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value.scan : 0), 0);
    expect(fresh).toBe(2);
    // the next minute is a new job
    await dispatchQueueOpsJobs(db, now + 60_000);
    expect(Number((await sql<{ n: number }>`select count(*)::int as n from jobs where tenant_id = ${T} and job_type = ${QUEUE_OPS_JOB.scan}`.execute(db)).rows[0].n)).toBe(4);
  });

  it('eight scans of one branch at once → one alert per (guest, type), one raised event each, no raw DB error', async () => {
    await sql`delete from queue_alerts where tenant_id = ${T}`.execute(db);
    const guest = id(50);
    const snapshot = { entries: [{ queueEntryId: guest, status: 'waiting', waitMinutes: 33, assignedTechnicianId: null, isAppointment: false, updatedAt: new Date().toISOString() }],
      technicians: [{ technicianId: id(60), status: 'available' }] };
    const make = () => new QueueAlertService(new KyselyQueueAlertRepository(db, new OutboxWriter()), new KyselyQueueAssignmentSettings(db, null), new InMemoryQueueOps(snapshot as any), null, null, null);
    const before = Number((await sql<{ n: number }>`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = 'queue.alert_raised'`.execute(db)).rows[0].n);
    const results = await gated('queue_alerts', () => Array.from({ length: 8 }, () => make().runScan(queueOpsSystemContext(T, B1))));
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => String(r.reason?.message))).toEqual([]);
    const rows = (await sql<{ type: string; n: number }>`select type, count(*)::int as n from queue_alerts where tenant_id = ${T} and branch_id = ${B1} and status <> 'resolved' group by type order by type`.execute(db)).rows;
    expect(rows).toEqual([{ type: 'unassigned', n: 1 }, { type: 'waiting_too_long', n: 1 }]);
    const raised = results.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value.raised : 0), 0);
    expect(raised).toBe(2);
    const after = Number((await sql<{ n: number }>`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = 'queue.alert_raised'`.execute(db)).rows[0].n);
    expect(after - before).toBe(2);
  });
});
