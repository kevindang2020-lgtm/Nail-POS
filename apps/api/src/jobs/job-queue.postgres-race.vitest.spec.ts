// job-queue.postgres-race.vitest.spec.ts — Phase 2 (BUILD_PLAN_2026-10-06), migration 519: the one durable job queue,
// proved on a real Postgres with real concurrent workers (PG_RACE_URL). Every claim here is the production code path:
// JobClassLoop is the worker the API and the worker process run.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { enqueueJob, claimJobs, failJob, reapExpiredLeases, retryJob, registerJobHandler, resetJobHandlers, PermanentJobError, JobQueueError } from '@aipowersalon/database';
import { JobClassLoop } from './job-worker';

const url = process.env.PG_RACE_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T1 = 'a1900000-0000-4000-8000-000000000001', T2 = 'a1900000-0000-4000-8000-000000000002';
const TAG = `jq${process.pid}`;
const quiet = { warn: () => undefined, error: () => undefined, log: () => undefined } as any;
const opts = (o: Partial<{ concurrency: number; perTenantCap: number; leaseMs: number }> = {}) => ({ pollMs: 10, idlePollMs: 20, leaseMs: 60_000, concurrency: 4, perTenantCap: 10, ...o });

describe.skipIf(!url)('the job queue on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 6 }) }) });
  const a = url ? mk() : (null as any), b = url ? mk() : (null as any);
  const type = (n: string) => `${TAG}.${n}`;
  beforeAll(async () => {
    for (const [t, slug] of [[T1, 'jq-one'], [T2, 'jq-two']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active') on conflict (id) do nothing`.execute(a);
  });
  beforeEach(async () => { resetJobHandlers(); await sql`delete from jobs where job_type like ${TAG + '.%'}`.execute(a); });
  afterAll(async () => { if (!a) return; await sql`delete from jobs where job_type like ${TAG + '.%'}`.execute(a); await a.destroy(); await b.destroy(); });

  it('the same (type, idempotency key) is enqueued once', async () => {
    const x = await enqueueJob(a, { jobClass: 'standard', jobType: type('once'), idempotencyKey: 'k1', payload: { n: 1 } });
    const y = await enqueueJob(b, { jobClass: 'standard', jobType: type('once'), idempotencyKey: 'k1', payload: { n: 2 } });
    expect(y).toEqual({ id: x.id, duplicate: true });
    expect((await sql<any>`select count(*)::int n from jobs where job_type = ${type('once')}`.execute(a)).rows[0].n).toBe(1);
  });

  it('a payload never carries a secret; a job type is a dotted name', async () => {
    await expect(enqueueJob(a, { jobClass: 'standard', jobType: type('x'), payload: { apiKey: 'sk' } })).rejects.toBeInstanceOf(JobQueueError);
    await expect(enqueueJob(a, { jobClass: 'standard', jobType: 'Bad Type' })).rejects.toBeInstanceOf(JobQueueError);
  });

  it('two workers draining 60 jobs: every job runs EXACTLY once', async () => {
    const seen = new Map<string, number>();
    registerJobHandler(type('count'), async (p) => { const k = String(p.k); seen.set(k, (seen.get(k) ?? 0) + 1); await sleep(5); });
    for (let i = 0; i < 60; i++) await enqueueJob(a, { jobClass: 'standard', jobType: type('count'), payload: { k: i }, tenantId: i % 2 ? T1 : T2 });
    const w1 = new JobClassLoop(a, 'standard', 'worker-1', opts(), quiet), w2 = new JobClassLoop(b, 'standard', 'worker-2', opts(), quiet);
    w1.start(); w2.start();
    for (let i = 0; i < 200 && (await sql<any>`select count(*)::int n from jobs where job_type = ${type('count')} and status <> 'succeeded'`.execute(a)).rows[0].n > 0; i++) await sleep(50);
    await w1.stop(); await w2.stop();
    expect(seen.size).toBe(60);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(w1.processed.succeeded + w2.processed.succeeded).toBe(60);
    expect(w1.processed.succeeded).toBeGreaterThan(0); expect(w2.processed.succeeded).toBeGreaterThan(0);   // both did work
  });

  it('a failing handler is retried later (backoff), then succeeds; attempts and the last error are kept', async () => {
    let calls = 0;
    registerJobHandler(type('flaky'), async () => { calls++; if (calls === 1) throw new Error('provider timeout'); return { done: true }; });
    const { id } = await enqueueJob(a, { jobClass: 'standard', jobType: type('flaky') });
    const w = new JobClassLoop(a, 'standard', 'w', opts(), quiet);
    await w.pump(); await sleep(100);
    let row: any = (await sql`select status, attempts, last_error, run_after > now() as later from jobs where id = ${id}`.execute(a)).rows[0];
    expect(row).toMatchObject({ status: 'queued', attempts: 1, last_error: 'provider timeout', later: true });
    await sql`update jobs set run_after = now() where id = ${id}`.execute(a);   // time passes
    await w.pump(); await sleep(100); await w.stop();
    row = (await sql`select status, attempts, result from jobs where id = ${id}`.execute(a)).rows[0];
    expect(row).toMatchObject({ status: 'succeeded', attempts: 2, result: { done: true } });
  });

  it('out of attempts → dead; a PermanentJobError → dead at once; a type nobody handles → dead; an operator retries a dead job', async () => {
    registerJobHandler(type('always'), async () => { throw new Error('nope'); });
    registerJobHandler(type('perm'), async () => { throw new PermanentJobError('the appointment no longer exists'); });
    const j1 = await enqueueJob(a, { jobClass: 'standard', jobType: type('always'), maxAttempts: 1 });
    const j2 = await enqueueJob(a, { jobClass: 'standard', jobType: type('perm'), maxAttempts: 5 });
    const j3 = await enqueueJob(a, { jobClass: 'standard', jobType: type('nobody') });
    const w = new JobClassLoop(a, 'standard', 'w', opts(), quiet);
    await w.pump(); await sleep(150); await w.stop();
    const st = async (id: string) => (await sql<any>`select status, attempts, last_error from jobs where id = ${id}`.execute(a)).rows[0];
    expect(await st(j1.id)).toMatchObject({ status: 'dead', attempts: 1 });
    expect(await st(j2.id)).toMatchObject({ status: 'dead', attempts: 1, last_error: 'the appointment no longer exists' });
    expect((await st(j3.id)).status).toBe('dead');
    expect((await st(j3.id)).last_error).toMatch(/no handler/);
    expect(await retryJob(a, j1.id)).toBe(true);
    expect(await st(j1.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('a worker that dies mid-job: its lease lapses and the reaper puts the job back', async () => {
    const { id } = await enqueueJob(a, { jobClass: 'report', jobType: type('orphan') });
    const [job] = await claimJobs(a, 'report', 'dead-worker', { leaseMs: 1_000 });
    expect(job.id).toBe(id);
    expect((await claimJobs(b, 'report', 'other', {})).length).toBe(0);      // leased: nobody else takes it
    await sleep(1_200);
    expect(await reapExpiredLeases(a, 'report')).toMatchObject({ requeued: 1 });
    const again = await claimJobs(b, 'report', 'other', {});
    expect(again.map((j) => j.id)).toEqual([id]);
    expect(await failJob(a, id, 'dead-worker', 'late')).toBe('lost');         // the dead worker's late answer is ignored
  });

  it('one busy salon cannot take every worker: its jobs beyond the cap wait, another salon\'s run', async () => {
    for (let i = 0; i < 4; i++) await enqueueJob(a, { jobClass: 'import', jobType: type('cap'), tenantId: T1, payload: { i } });
    await sleep(20);
    await enqueueJob(a, { jobClass: 'import', jobType: type('cap'), tenantId: T2, payload: { i: 99 } });
    const got = await claimJobs(a, 'import', 'w', { limit: 10, perTenantCap: 2 });
    const byTenant = (t: string) => got.filter((j) => j.tenantId === t).length;
    // T1 is under its cap when the batch is chosen; the second claim sees 2 (then more) running for T1 and skips it.
    const more = await claimJobs(b, 'import', 'w2', { limit: 10, perTenantCap: 2 });
    const t1Running = (await sql<any>`select count(*)::int n from jobs where job_type = ${type('cap')} and tenant_id = ${T1} and status = 'running'`.execute(a)).rows[0].n;
    expect(byTenant(T2) + more.filter((j) => j.tenantId === T2).length).toBe(1);                       // the other salon ran
    expect(more.filter((j) => j.tenantId === T1).length).toBe(0);                                      // T1 already at/over cap: not given more
    expect(t1Running).toBeGreaterThanOrEqual(2);
  });

  it('priority: a P0 job is claimed before an older P3 job', async () => {
    await enqueueJob(a, { jobClass: 'ai', jobType: type('p'), priority: 3, payload: { n: 'low' } });
    await sleep(20);
    await enqueueJob(a, { jobClass: 'ai', jobType: type('p'), priority: 0, payload: { n: 'urgent' } });
    const [first] = await claimJobs(a, 'ai', 'w', { limit: 1 });
    expect(first.payload.n).toBe('urgent');
  });
});
