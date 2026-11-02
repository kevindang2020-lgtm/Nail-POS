// ai-scheduling-proposals.postgres-race.vitest.spec — BUILD_PLAN Phase 7 (agent B): two customer approvals of ONE proposal
// at the same moment (two taps, two devices) record exactly ONE decision and hand exactly one to the engine. Real
// Postgres (opt-in: PG_RACE_URL=postgres://… a migrated database). DETERMINISTIC: a gate connection holds the proposal row
// FOR UPDATE, so both callers have read the same version and are blocked on their compare-and-swap UPDATE when the gate
// opens; the loser's UPDATE re-checks `version = expected` against the committed row and matches nothing.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyProposalStore, ScheduleProposalService } from './ai-scheduling-proposals';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e7e7e7e7-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), USER = id(3), CUST = id(4), TECH = id(5), APPT = id(6), REC = id(7);
let pool: pg.Pool; let db: Kysely<any>;

describe.skipIf(!url)('real-Postgres schedule proposal races (RACEP7B)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P7B', 'Race P7B', 'race-p7b', 'RACEP7B', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Race Branch', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, role, email) values (${USER}, ${T}, 'CUSTOMER', 'race-p7b@x.test') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) values (${CUST}, ${T}, ${B}, 'Race', 'Customer', 'Race Customer', ${USER}) on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Tech', 'T', 'Tech T') on conflict (id) do nothing`.execute(db);
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time) values (${APPT}, ${T}, ${B}, ${TECH}, ${CUST}, 'Race Customer', '2026-10-20', '10:00', '11:00') on conflict (id) do nothing`.execute(db);
    await sql`delete from schedule_change_proposals where tenant_id = ${T}`.execute(db);
    await sql`insert into schedule_optimization_recommendations (id, tenant_id, branch_id, type, status) values (${REC}, ${T}, ${B}, 'move_appointment', 'customer_approval_required') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from schedule_change_proposals where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from schedule_optimization_recommendations where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent approvals → exactly one decision recorded, one engine call, the other refused', async () => {
    const store = new KyselyProposalStore(db);
    const p = await store.insert({ tenantId: T, branchId: B, recommendationId: REC, appointmentId: APPT, customerId: CUST, status: 'customer_notified',
      proposedStart: '2026-10-20T17:00:00Z', proposedEnd: '2026-10-20T18:00:00Z', proposedTechnicianId: TECH, originalStart: '2026-10-20T14:00:00Z', originalTechnicianId: TECH, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(p).toBeTruthy();
    const engine: any = { customerDecided: vi.fn(async () => ({})), get: async () => null, effectiveConfig: async () => ({ config: {} }) };
    const svc = new ScheduleProposalService(store, engine, null, null);
    const me = { tenantId: T, userId: USER };

    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from schedule_change_proposals where id = $1 for update', [p!.id]);
    const pending = Promise.allSettled([svc.customerDecide(me, p!.id, true, p!.version), svc.customerDecide(me, p!.id, true, p!.version)]);
    await new Promise((r) => setTimeout(r, 600));       // both have read version N and are blocked on their UPDATE
    await gate.query('commit'); gate.release();
    const results = await pending;

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['VERSION_CONFLICT', 'INVALID_STATE']).toContain(lost.reason?.code);
    expect(engine.customerDecided).toHaveBeenCalledTimes(1);
    const row = (await sql<any>`select status, version, decision_channel from schedule_change_proposals where id = ${p!.id}`.execute(db)).rows[0];
    expect(row).toEqual({ status: 'customer_approved', version: p!.version + 1, decision_channel: 'customer_web' });
  });
});
