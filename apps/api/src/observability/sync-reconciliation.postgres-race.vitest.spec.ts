// sync-reconciliation.postgres-race.vitest.spec.ts — the 20 s server reconciliation on real Postgres (Smooth Refresh
// spec §34–§39, §73, §102, §103). Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { SyncReconciliation } from './sync-reconciliation';

const url = process.env.PG_RACE_URL;
const T = 'a4000000-0000-4000-8000-0000000000aa';
const B = 'b4000000-0000-4000-8000-0000000000bb';
const TECH = 'c4000000-0000-4000-8000-0000000000cc';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('real-Postgres 20 s sync reconciliation', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Recon Salon', 'Recon Salon', 'recon-salon', 'RECON', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Rae', 'Ho', 'Rae Ho', true) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from outbox_events where tenant_id = ${T} and event_type like 'booking.phone%'`.execute(db).catch(() => undefined);
    await sql`delete from booking_verification_sessions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from booking_holds where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from outbox_events where aggregate_id = 'recon-test'`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('§73: an EXPIRED hold that nobody released stops blocking the slot — the next run releases it; a live hold is untouched', async () => {
    await sql`delete from booking_holds where tenant_id = ${T}`.execute(db);
    const expired = (await sql<{ id: string }>`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at)
      values (${T}, ${B}, ${TECH}, now() + interval '2 hours', now() + interval '3 hours', now() - interval '1 minute') returning id`.execute(db)).rows[0].id;
    const live = (await sql<{ id: string }>`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at)
      values (${T}, ${B}, ${TECH}, now() + interval '5 hours', now() + interval '6 hours', now() + interval '5 minutes') returning id`.execute(db)).rows[0].id;
    // Before: the expired hold still occupies its slot in the database guard — a new hold for that slot is refused.
    await expect(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at)
      values (${T}, ${B}, ${TECH}, now() + interval '2 hours', now() + interval '3 hours', now() + interval '5 minutes')`.execute(db)).rejects.toThrow();
    const rep = await new SyncReconciliation(db).runOnce();
    expect(rep.outcome).toBe('ran');
    expect(rep.holdsReleased).toBeGreaterThanOrEqual(1);
    const rows = (await sql<{ id: string; released_at: Date | null; release_reason: string | null }>`select id, released_at, release_reason from booking_holds where tenant_id = ${T}`.execute(db)).rows;
    expect(rows.find((r) => r.id === expired)!.release_reason).toBe('hold_expired');
    expect(rows.find((r) => r.id === live)!.released_at).toBeNull();
    // After: the slot can be held again.
    await sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at)
      values (${T}, ${B}, ${TECH}, now() + interval '2 hours', now() + interval '3 hours', now() + interval '5 minutes')`.execute(db);
  });

  it('§103: while another worker holds the run lock, this worker SKIPS its turn instead of running a second copy', async () => {
    const other = await pool.connect();
    await other.query('begin');
    await other.query(`select pg_advisory_xact_lock(hashtextextended('aipowersalon:sync.reconciliation', 0))`);
    try {
      const rep = await new SyncReconciliation(db).runOnce();
      expect(rep.outcome).toBe('skipped_locked');
    } finally { await other.query('commit'); other.release(); }
    expect((await new SyncReconciliation(db).runOnce()).outcome).toBe('ran');   // lock released → next run proceeds
  });

  it('§100/§102: outbox lag and active scopes are measured', async () => {
    await sql`insert into outbox_events (id, event_type, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, created_at, publish_status, tenant_id)
      values (gen_random_uuid(), 'appointment.updated', 'appointment', 'recon-test', 'recon-test', '{}'::jsonb, now(), now() - interval '2 minutes', 'pending', ${T})`.execute(db);
    const rep = await new SyncReconciliation(db).runOnce();
    expect(rep.outcome).toBe('ran');
    expect(rep.outboxPendingOld).toBeGreaterThanOrEqual(1);
    expect(rep.oldestPendingSec).toBeGreaterThanOrEqual(100);
    expect(rep.activeBranches).toBeGreaterThanOrEqual(0);
    expect(rep.overran).toBe(false);
  });

  it('Phase 4: a phone verification past its deadline is EXPIRED, its hold released, and announced exactly once', async () => {
    const hold = (await sql<{ id: string }>`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, booking_session_id)
      values (${T}, ${B}, ${TECH}, now() + interval '8 hours', now() + interval '9 hours', now() + interval '5 minutes', gen_random_uuid()) returning id`.execute(db)).rows[0].id;
    const vs = (await sql<{ id: string }>`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, booking_hold_id, phone_hash, phone_mask, channel, status, expires_at)
      values (${T}, ${B}, gen_random_uuid(), ${hold}, 'h-recon', '••••0142', 'online', 'sent', now() - interval '1 minute') returning id`.execute(db)).rows[0].id;
    const [a, b] = await Promise.all([new SyncReconciliation(db).runOnce(), new SyncReconciliation(db).runOnce()]);
    expect(a.verificationsExpired + b.verificationsExpired).toBeGreaterThanOrEqual(1);
    expect((await sql<{ status: string }>`select status from booking_verification_sessions where id = ${vs}`.execute(db)).rows[0].status).toBe('expired');
    expect((await sql<{ release_reason: string }>`select release_reason from booking_holds where id = ${hold}`.execute(db)).rows[0].release_reason).toBe('hold_expired');
    const facts = (await sql<{ n: number }>`select count(*)::int as n from outbox_events where aggregate_id = ${vs} and event_type = 'booking.phone_verification_expired'`.execute(db)).rows[0];
    expect(facts.n).toBe(1);
  });
});
