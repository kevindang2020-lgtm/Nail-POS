// BUILD_PLAN Phase 11 (Constitution 4 §27/§107) on a real Postgres (PG_RACE_URL): the AI customer-profile scan enqueues
// ONE 'ai' job per active salon per interval (no more "first 200 salons, unordered"); racing dispatchers enqueue each
// salon once; each job refreshes exactly its salon.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { claimJobs, completeJob, jobHandlerFor, resetJobHandlers } from '@aipowersalon/database';
import { AiCustomerProfileScanScheduler, AI_PROFILE_SCAN_JOB } from './ai-customer-profile-scan.scheduler';

const url = process.env.PG_RACE_URL;
const T = Array.from({ length: 5 }, (_, i) => `a5550000-0000-4000-8000-00000000000${i}`);

describe.skipIf(!url)('AI customer-profile scan, tenant-partitioned', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const db = url ? mk() : (null as any), db2 = url ? mk() : (null as any);
  const clean = async () => { await sql`delete from jobs where job_type = ${AI_PROFILE_SCAN_JOB}`.execute(db); await sql`delete from tenants where id in (${sql.join(T.map((t) => sql`${t}`))})`.execute(db); };
  beforeAll(async () => {
    resetJobHandlers(); await clean();
    for (const [i, t] of T.entries()) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state, status) values (${t}, ${'ai' + i}, ${'ai' + i}, ${'aiscan' + i}, ${'AISC' + i}, 'active', ${i === 4 ? 'cancelled' : 'active'})`.execute(db);
  });
  afterAll(async () => { if (!db) return; await clean(); await db.destroy(); await db2.destroy(); });

  it('two dispatchers, one interval: each active salon queued once; each job refreshes its own salon once', async () => {
    const refreshed: string[] = [];
    const svc: any = { refreshTenantOverview: async (ctx: any) => { refreshed.push(ctx.tenantId); } };
    const a = new AiCustomerProfileScanScheduler(svc, db), b = new AiCustomerProfileScanScheduler(svc, db2);
    a.onModuleInit();
    const at = new Date('2026-10-08T10:05:00Z');
    const [r1, r2] = await Promise.all([a.dispatch(at), b.dispatch(new Date('2026-10-08T10:20:00Z'))]);   // same 30-minute interval
    expect(r1.enqueued + r2.enqueued).toBe(r1.tenants);
    const queued = (await sql<any>`select tenant_id from jobs where job_type = ${AI_PROFILE_SCAN_JOB} and tenant_id in (${sql.join(T.map((t) => sql`${t}`))}) order by tenant_id`.execute(db)).rows.map((r: any) => r.tenant_id);
    expect(queued).toEqual(T.slice(0, 4));
    for (;;) {
      const got = (await claimJobs(db, 'ai', 'w', { limit: 50, perTenantCap: 50 })).filter((j) => j.jobType === AI_PROFILE_SCAN_JOB);
      if (!got.length) break;
      for (const j of got) { await jobHandlerFor(j.jobType)!(j.payload, { jobId: j.id, tenantId: j.tenantId, attempt: 1, correlationId: null, renewLease: async () => true }); await completeJob(db, j.id, 'w'); }
    }
    expect(refreshed.filter((t) => T.includes(t)).sort()).toEqual(T.slice(0, 4));
    expect((await a.dispatch(new Date('2026-10-08T10:35:00Z'))).enqueued).toBeGreaterThanOrEqual(4);    // the next interval is new work
  });
});
