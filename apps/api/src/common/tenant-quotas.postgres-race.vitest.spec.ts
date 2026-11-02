// tenant-quotas.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §113/§160), migration 552, on a real
// Postgres (PG_RACE_URL): the one read API (QuotaService.limitFor) over tenant → plan → platform and the existing AI /
// SMS sources; storage reserved atomically under concurrency; the jobs queue's per-tenant cap read from the quota; the
// upload guard's 429 QUOTA_EXCEEDED.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { EventEmitter } from 'node:events';
import { enqueueJob, claimJobs } from '@aipowersalon/database';
import { QuotaService, StorageQuotaGuard, QuotaExceededError, resolveQuota } from './tenant-quotas';

const url = process.env.PG_RACE_URL;
const T1 = 'a5520000-0000-4000-8000-000000000001', T2 = 'a5520000-0000-4000-8000-000000000002', T3 = 'a5520000-0000-4000-8000-000000000003';
const TAG = `tq${process.pid}`;
const env = { RATE_LIMIT_MAX_PER_TENANT: '600', JOBS_PER_TENANT_CAP: '3' } as any;

describe('resolveQuota (pure)', () => {
  it('tenant override → plan default → platform default; null inherits', () => {
    expect(resolveQuota('jobs_in_flight', null, null, env)).toEqual({ kind: 'jobs_in_flight', limit: 3, source: 'platform' });
    expect(resolveQuota('jobs_in_flight', { jobs_in_flight: null }, { jobs_in_flight: 5 }, env)).toEqual({ kind: 'jobs_in_flight', limit: 5, source: 'plan' });
    expect(resolveQuota('jobs_in_flight', { jobs_in_flight: 1 }, { jobs_in_flight: 5 }, env)).toEqual({ kind: 'jobs_in_flight', limit: 1, source: 'tenant' });
    expect(resolveQuota('storage_bytes', null, null, env)).toEqual({ kind: 'storage_bytes', limit: null, source: 'none' });
  });
});

describe.skipIf(!url)('tenant quotas on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 12 }) }) });
  const db = url ? mk() : (null as any);
  let planId = '';
  beforeAll(async () => {
    await sql`delete from ai_budgets where tenant_id in (${T1}, ${T2}, ${T3})`.execute(db);
    await sql`delete from tenants where id in (${T1}, ${T2}, ${T3})`.execute(db);
    await sql`delete from subscription_plans where code = ${TAG + '_pro'}`.execute(db);
    for (const [t, slug] of [[T1, 'tq-one'], [T2, 'tq-two'], [T3, 'tq-three']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
    planId = (await sql<any>`insert into subscription_plans (code, name) values (${TAG + '_pro'}, ${TAG + ' Pro'}) returning id`.execute(db)).rows[0].id;
    await sql`insert into tenant_subscriptions (tenant_id, plan, status) values (${T2}, ${TAG + '_pro'}, 'active')`.execute(db);
    await sql`insert into plan_quota_defaults (plan_id, jobs_in_flight, storage_bytes, api_requests_per_min) values (${planId}, 5, 5000, 1200)`.execute(db);
    await sql`insert into tenant_quotas (tenant_id, jobs_in_flight, storage_bytes) values (${T1}, 1, 1000)`.execute(db);
    await sql`insert into ai_budgets (tenant_id, scope_key, period, limit_micro_usd) values (${T1}, '*', 'daily', 2500000)`.execute(db);
  });
  afterAll(async () => {
    if (!db) return;
    await sql`delete from jobs where job_type like ${TAG + '.%'}`.execute(db);
    await sql`delete from ai_budgets where tenant_id in (${T1}, ${T2}, ${T3})`.execute(db);
    await sql`delete from tenants where id in (${T1}, ${T2}, ${T3})`.execute(db);
    await sql`delete from subscription_plans where id = ${planId}`.execute(db);
    await db.destroy();
  });

  it('limitFor: tenant row, then the active plan\'s default, then the platform; AI budget from ai_budgets', async () => {
    const q = new QuotaService(db, env);
    expect(await q.limitFor(T1, 'jobs_in_flight')).toEqual({ kind: 'jobs_in_flight', limit: 1, source: 'tenant' });
    expect(await q.limitFor(T1, 'api_requests_per_min')).toEqual({ kind: 'api_requests_per_min', limit: 600, source: 'platform' });
    expect(await q.limitFor(T2, 'jobs_in_flight')).toEqual({ kind: 'jobs_in_flight', limit: 5, source: 'plan' });
    expect(await q.limitFor(T2, 'api_requests_per_min')).toEqual({ kind: 'api_requests_per_min', limit: 1200, source: 'plan' });
    expect(await q.limitFor(T3, 'storage_bytes')).toEqual({ kind: 'storage_bytes', limit: null, source: 'none' });
    expect(await q.limitFor(T1, 'ai_budget_daily_micro_usd')).toEqual({ kind: 'ai_budget_daily_micro_usd', limit: 2500000, source: 'ai_budgets' });
    expect(await q.limitFor(T1, 'ai_budget_monthly_micro_usd')).toEqual({ kind: 'ai_budget_monthly_micro_usd', limit: null, source: 'none' });
    expect(await q.limitFor(T3, 'sms_cycle_allowance')).toEqual({ kind: 'sms_cycle_allowance', limit: null, source: 'none' });
  });

  it('20 concurrent 100-byte reservations against a 1000-byte quota: exactly 10 succeed, never over', async () => {
    const services = Array.from({ length: 20 }, () => new QuotaService(db, env));
    const out = await Promise.allSettled(services.map((s) => s.reserveStorage(T1, 100)));
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const rejected = out.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(10);
    expect(rejected[0].reason).toBeInstanceOf(QuotaExceededError);
    expect(rejected[0].reason.getResponse()).toMatchObject({ code: 'QUOTA_EXCEEDED', kind: 'storage_bytes', limit: 1000 });
    expect(await new QuotaService(db, env).storageUsed(T1)).toBe(1000);
    await new QuotaService(db, env).releaseStorage(T1, 300);
    expect(await new QuotaService(db, env).storageUsed(T1)).toBe(700);
  });

  it('the upload guard: a multipart request over the quota gets 429 QUOTA_EXCEEDED; a failed upload gives its bytes back', async () => {
    const q = new QuotaService(db, env);
    const guard = new StorageQuotaGuard(q);
    const ctx = (len: number, res: any) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(len) }, ctx: { tenantId: T1, role: 'OWNER' } }), getResponse: () => res }) }) as any;
    await expect(guard.canActivate(ctx(400, new EventEmitter()))).rejects.toMatchObject({ status: 429 });   // 700 + 400 > 1000
    const res: any = Object.assign(new EventEmitter(), { statusCode: 500 });
    expect(await guard.canActivate(ctx(200, res))).toBe(true);
    expect(await q.storageUsed(T1)).toBe(900);
    res.emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    expect(await q.storageUsed(T1)).toBe(700);                // released: the upload failed
    const ok: any = Object.assign(new EventEmitter(), { statusCode: 201 });
    expect(await guard.canActivate(ctx(300, ok))).toBe(true); ok.emit('finish');
    await new Promise((r) => setTimeout(r, 50));
    expect(await q.storageUsed(T1)).toBe(1000);               // kept: the upload succeeded
    const json: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ headers: { 'content-type': 'application/json', 'content-length': '99999' }, ctx: { tenantId: T1 } }), getResponse: () => new EventEmitter() }) };
    expect(await guard.canActivate(json)).toBe(true);          // not an upload
  });

  it('the jobs queue reads the per-tenant cap from the quota (tenant override 1, plan 5, platform default)', async () => {
    for (const t of [T1, T2, T3]) for (let i = 0; i < 8; i++) await enqueueJob(db, { jobClass: 'import', jobType: `${TAG}.cap`, tenantId: t, payload: { i } });
    // a worker claims as many as it has free slots; the cap is checked against jobs already RUNNING, so claim one at a
    // time (the tightest a worker gets) until nothing more is admitted
    for (let i = 0; i < 40; i++) { const more = await claimJobs(db, 'import', `w${i}`, { limit: 1, perTenantCap: 3 }); if (!more.length) break; }
    const running = async (t: string) => (await sql<any>`select count(*)::int n from jobs where job_type = ${TAG + '.cap'} and tenant_id = ${t} and status = 'running'`.execute(db)).rows[0].n;
    expect(await running(T1)).toBe(1);   // tenant override
    expect(await running(T2)).toBe(5);   // plan default
    expect(await running(T3)).toBe(3);   // platform default (perTenantCap)
  });
});
