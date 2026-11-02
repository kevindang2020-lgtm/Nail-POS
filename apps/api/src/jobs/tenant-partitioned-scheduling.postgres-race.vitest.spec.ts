// tenant-partitioned-scheduling.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §27/§107) on a real
// Postgres (PG_RACE_URL): the hourly tenant-health snapshot and usage-alert sweeps no longer loop every salon in one
// process — each tick enqueues ONE job per salon per hour on the durable queue. Two dispatchers racing in the same hour
// enqueue each salon once; the workers' handlers produce exactly what the in-process sweep produced; the next hour is a
// new set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { claimJobs, completeJob, jobHandlerFor, resetJobHandlers } from '@aipowersalon/database';
import { UsageAlertSweep } from '@aipowersalon/platform';
import { TenantHealthService, TenantHealthSnapshots, TENANT_SNAPSHOT_JOB } from '../observability/tenant-health';

const url = process.env.PG_RACE_URL;
const A = 'a5540000-0000-4000-8000-00000000000a', B = 'a5540000-0000-4000-8000-00000000000b', C = 'a5540000-0000-4000-8000-00000000000c', X = 'a5540000-0000-4000-8000-0000000000ff';
const MINE = [A, B, C, X];

describe.skipIf(!url)('tenant-partitioned scheduling on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 6 }) }) });
  const db = url ? mk() : (null as any), db2 = url ? mk() : (null as any);
  const clean = async () => {
    await sql`delete from jobs where job_type in (${TENANT_SNAPSHOT_JOB}, 'usage.alert.tenant')`.execute(db);
    await sql`delete from tenants where id in (${sql.join(MINE.map((t) => sql`${t}`))})`.execute(db);
  };
  /** Run every queued job of these types through its registered handler — what a worker does. */
  const work = async (types: string[]) => {
    let ran = 0;
    for (;;) {
      const got = (await claimJobs(db, 'standard', 'test-worker', { limit: 50, perTenantCap: 50 })).filter((j) => types.includes(j.jobType));
      if (!got.length) return ran;
      for (const j of got) { await jobHandlerFor(j.jobType)!(j.payload, { jobId: j.id, tenantId: j.tenantId, attempt: j.attempts, correlationId: null, renewLease: async () => true }); await completeJob(db, j.id, 'test-worker'); ran++; }
    }
  };
  beforeAll(async () => {
    resetJobHandlers();
    await clean();
    // only my salons are active in this window of the test (others' rows in this database are left alone: the
    // assertions filter to MINE)
    for (const [t, slug, st] of [[A, 'tp-a', 'active'], [B, 'tp-b', 'active'], [C, 'tp-c', 'active'], [X, 'tp-x', 'cancelled']]) {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active', ${st})`.execute(db);
    }
  });
  afterAll(async () => { if (!db) return; await clean(); await db.destroy(); await db2.destroy(); });

  it('tenant health: two dispatchers in one hour → one job per active salon; the jobs store one snapshot each; the next hour is new', async () => {
    const s1 = new TenantHealthSnapshots(new TenantHealthService(db), db), s2 = new TenantHealthSnapshots(new TenantHealthService(db2), db2);
    s1.onModuleInit();
    const at = new Date('2026-10-08T10:15:00Z');
    const [r1, r2] = await Promise.all([s1.dispatch(at), s2.dispatch(new Date('2026-10-08T10:40:00Z'))]);
    const mine = async (hourKey: string) => (await sql<any>`select tenant_id from jobs where job_type = ${TENANT_SNAPSHOT_JOB} and idempotency_key like ${'%:' + hourKey} and tenant_id in (${sql.join(MINE.map((t) => sql`${t}`))}) order by tenant_id`.execute(db)).rows.map((r: any) => r.tenant_id);
    expect(await mine('2026-10-08T10:00:00.000Z')).toEqual([A, B, C]);                   // the cancelled salon is not dispatched
    expect(r1.enqueued + r2.enqueued).toBe(r1.salons);                                  // every salon enqueued exactly once between the two
    expect(r1.duplicates + r2.duplicates).toBe(r1.salons);
    await work([TENANT_SNAPSHOT_JOB]);
    const snaps = (await sql<any>`select tenant_id, snapshot_hour from tenant_health_snapshots where tenant_id in (${A}, ${B}, ${C}, ${X}) order by tenant_id`.execute(db)).rows;
    expect(snaps.map((r: any) => r.tenant_id)).toEqual([A, B, C]);
    expect(new Date(snaps[0].snapshot_hour).toISOString()).toBe('2026-10-08T10:00:00.000Z');
    await s1.dispatch(new Date('2026-10-08T11:05:00Z'));
    expect(await mine('2026-10-08T11:00:00.000Z')).toEqual([A, B, C]);
    await work([TENANT_SNAPSHOT_JOB]);
    expect(Number((await sql<any>`select count(*)::int n from tenant_health_snapshots where tenant_id in (${A}, ${B}, ${C})`.execute(db)).rows[0].n)).toBe(6);
  });

  it('usage alerts: one job per salon per hour; the per-salon job writes the same once-per-month alerts the platform sweep did', async () => {
    const limits = [{ metric: 'customers', used: 95, effectiveValue: 100, evaluation: { usedPct: 95, status: 'warning' } }, { metric: 'branches', used: null, effectiveValue: 3, evaluation: { usedPct: null, status: 'ok' } }];
    const ent: any = { utilizationTenantIds: async () => [A, B, A], getEntitlements: async () => ({ limits }) };
    const sweep = new UsageAlertSweep(ent, db);
    sweep.onModuleInit();
    const at = new Date('2026-10-08T10:15:00Z');
    const first = await sweep.dispatch(at), again = await sweep.dispatch(new Date('2026-10-08T10:50:00Z'));
    expect(first).toMatchObject({ tenants: 3, enqueued: 2, duplicates: 1 });             // A listed twice → one job
    expect(again).toMatchObject({ enqueued: 0, duplicates: 3 });
    await work(['usage.alert.tenant']);
    const rows = (await sql<any>`select tenant_id, metric, threshold from usage_alerts where tenant_id in (${A}, ${B}) order by tenant_id, threshold`.execute(db)).rows;
    expect(rows.map((r: any) => [r.tenant_id, r.metric, Number(r.threshold)])).toEqual([[A, 'customers', 80], [A, 'customers', 90], [B, 'customers', 80], [B, 'customers', 90]]);
    await sweep.dispatch(new Date('2026-10-08T11:15:00Z')); await work(['usage.alert.tenant']);   // next hour: still once per month
    expect(Number((await sql<any>`select count(*)::int n from usage_alerts where tenant_id in (${A}, ${B})`.execute(db)).rows[0].n)).toBe(4);
  });
});
