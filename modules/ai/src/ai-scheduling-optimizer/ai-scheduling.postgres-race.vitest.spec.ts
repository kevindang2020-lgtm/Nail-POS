// ai-scheduling.postgres-race.vitest.spec — BUILD_PLAN Phase 7, agent A: the engine under TRUE concurrency (real
// Postgres; PGlite is single-connection). Opt-in: PG_RACE_URL=postgres://... (a migrated database). Tenant RACEP7A.
//   • two concurrent applies of the same accepted recommendation → exactly ONE booking reschedule; the other 409s;
//   • two concurrent accepts with the same expectedVersion → one wins, one 409 VERSION_CONFLICT.
// Each race is DETERMINISTIC: a gate transaction holds the recommendation row FOR UPDATE, both callers read it and block on
// their conditional UPDATE (we wait until Postgres reports both backends waiting on the lock — no timers), then the gate
// commits and the database decides.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { AiSchedulingService, type AiSchedulingDeps, type SchedCtx } from './ai-scheduling.service';
import { KyselySchedStore } from './ai-scheduling.kysely.repository';
import { OutboxSchedEvents } from './ai-scheduling.events';
import type { RecInsert } from './ai-scheduling.store';
import type { SchedApptRecord } from './ai-scheduling.data-adapter';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e9e9e9e9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), TA = id(3), AP = id(4), U = id(5);
const DATE = '2026-10-09';
let pool: pg.Pool; let db: Kysely<any>;
const ctx: SchedCtx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['ai_scheduling.view', 'ai_scheduling.review', 'ai_scheduling.apply'], actor: 'user' };

const appt: SchedApptRecord = { id: AP, branchId: B, technicianId: TA, customerId: null, status: 'booked', source: 'manual', date: DATE, startTime: '11:00', endTime: '11:45', startMin: 660, endMin: 705, version: 1, depositStatus: null, serviceIds: [], manualLock: false };
const rec = (): RecInsert => ({
  branchId: B, runId: null, type: 'move_appointment', status: 'review_required',
  currentState: { appointmentId: AP, date: DATE, startTime: '11:00', endTime: '11:45', technicianId: TA, status: 'booked', version: 1, customerId: null },
  proposedState: { kind: 'reschedule', appointmentId: AP, date: DATE, startTime: '09:45', endTime: '10:30', technicianId: TA },
  affectedAppointmentIds: [AP], affectedTechnicianIds: [TA], violations: [],
  simulation: { before: { idleMin: 75, waitMin: 0, utilizationPct: 20, gapCount: 1, latenessRiskPct: 0 }, after: { idleMin: 0, waitMin: 0, utilizationPct: 20, gapCount: 0, latenessRiskPct: 0 }, deltas: { idleSavedMin: 75, waitSavedMin: 0, utilizationGainPct: 0, gapsRemoved: 1, latenessReducedPct: 0 }, improved: true },
  softObjectivesImproved: ['idleSavedMin'], expectedBenefit: ['saves ~75 min technician idle time'], possibleDownside: [], confidence: 0.55, dataQuality: 'partial',
  touchesConfirmedAppointment: false, requiresCustomerApproval: false, versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 0 },
  expiresAt: '2099-01-01T00:00:00.000Z', automated: false,
});

function service(bookingCalls: string[]) {
  const deps: AiSchedulingDeps = {
    store: new KyselySchedStore(db), events: new OutboxSchedEvents(db, new OutboxWriter()),
    reader: {
      async clock() { return { today: '2026-10-08', nowMinute: 600, timeZone: 'America/New_York' }; },
      async loadDay() { throw new Error('not used'); }, async appointment() { return { ...appt }; },
      async technicianIdForUser() { return null; }, async technicianExists() { return true; }, async serviceExists() { return true; },
    },
    forecast: { async getBusyHours() { return { available: false, version: null }; } },
    booking: { async reschedule(_c, apptId) { bookingCalls.push(apptId); await new Promise((r) => setImmediate(r)); return { appointmentId: apptId }; } },
    holds: null, audit: { async record() { /* */ } },
    proposals: { async open() { return {} as any; }, async resend() { return {} as any; }, async recordStaffDecision() { return {} as any; }, async withdraw() { /* */ }, async markApplied() { /* */ }, async summaries() { return {}; } },
    explanations: { async explain() { return { text: 'x', source: 'template' }; } },
    usage: { async record() { /* */ } }, platform: { async isKilled() { return false; } }, automation: { async afterRun() { /* */ } },
  };
  return new AiSchedulingService(deps);
}

/** Hold the row FOR UPDATE, start the callers, wait until Postgres shows `n` backends waiting on a lock, release. */
async function gated<T>(recId: string, n: number, run: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  const gate = await pool.connect();
  await gate.query('begin');
  await gate.query('select id from schedule_optimization_recommendations where tenant_id = $1 and id = $2 for update', [T, recId]);
  const pending = Promise.allSettled(run());
  const gatePid = (await gate.query('select pg_backend_pid() as pid')).rows[0].pid;
  let reached = false;
  // poll until BOTH callers are parked behind the gate (directly, or behind the first caller in the row's lock queue) —
  // counted by pg_blocking_pids, so other sessions on a shared database can never satisfy the condition. The deadline is
  // only a safety net; the condition, not the clock, releases the gate. Polled from ANOTHER connection: pg_stat_activity is
  // snapshotted once per transaction, so the gate's own view would never change.
  for (const deadline = Date.now() + 20_000; !reached && Date.now() < deadline;) {
    const { rows } = await pool.query(`with recursive w(pid) as (
        select a.pid from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid))
        union select a.pid from pg_stat_activity a join w on w.pid = any(pg_blocking_pids(a.pid)))
      select count(*)::int as n from w`, [gatePid]);
    reached = rows[0].n >= n;
    if (!reached) await new Promise((r) => setTimeout(r, 5));
  }
  await gate.query('commit'); gate.release();
  if (!reached) throw new Error('gate: the callers never blocked on the row lock — the race was not forced');
  return pending;
}

describe.skipIf(!url)('real-Postgres optimizer races (RACEP7A)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P7 A', 'Race P7 A', 'race-p7-a', 'RACEP7A', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Race branch', 'active') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    if (!db) return;
    for (const t of ['schedule_change_applications', 'schedule_recommendation_decisions', 'schedule_recommendation_impacts', 'schedule_optimization_recommendations', 'outbox_events']) {
      await db.deleteFrom(t as any).where('tenant_id', '=', T).execute().catch(() => undefined);
    }
    await db.destroy();
  });

  it('two concurrent applies of one accepted recommendation → exactly one booking reschedule, the other 409', async () => {
    const store = new KyselySchedStore(db);
    const r = await store.insertRec(T, rec());
    const acc = (await store.casRec(T, r.id, 1, ['review_required'], { status: 'accepted' }))!;
    const calls: string[] = [];
    const svc = service(calls);
    const results = await gated(r.id, 2, () => [svc.apply(ctx, r.id, { expectedVersion: acc.version }), svc.apply(ctx, r.id, { expectedVersion: acc.version })]);
    expect(calls).toEqual([AP]);
    const ok = results.filter((x) => x.status === 'fulfilled');
    const bad = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad.map((b) => b.reason?.code)).toEqual(['VERSION_CONFLICT']);
    expect((await store.getRec(T, r.id))!.status).toBe('applied');
    const apps = await db.selectFrom('schedule_change_applications').where('tenant_id', '=', T).where('recommendation_id', '=', r.id).select(['status', 'attempt']).execute();
    expect(apps).toEqual([{ status: 'applied', attempt: 1 }]);
  }, 30_000);

  it('two concurrent accepts with the same expectedVersion → one wins, one 409 VERSION_CONFLICT', async () => {
    const store = new KyselySchedStore(db);
    const r = await store.insertRec(T, rec());
    const svc = service([]);
    const results = await gated(r.id, 2, () => [svc.decide(ctx, r.id, 'accept', { expectedVersion: 1 }), svc.decide(ctx, r.id, 'accept', { expectedVersion: 1 })]);
    const ok = results.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const bad = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad.map((b) => b.reason?.code)).toEqual(['VERSION_CONFLICT']);
    const final = (await store.getRec(T, r.id))!;
    expect(final.version).toBe(2);
    expect(final.status).toBe('accepted');
    // only the winner's decisions were recorded (the loser's transaction wrote nothing)
    const decisions = await store.listDecisions(T, r.id);
    expect(decisions.map((d) => d.action)).toEqual(['start_review', 'accept']);
  }, 30_000);
});
