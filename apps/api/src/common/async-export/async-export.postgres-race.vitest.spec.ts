// BUILD_PLAN Phase 12 (Constitution 5 §32–33): an async export runs ONCE on real Postgres (PG_RACE_URL) — two worker
// processes' loops (two pools) draining the same queue, and two runs of the same operation racing each other.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueJob, resetJobHandlers } from '@aipowersalon/database';
import { LocalDiskPrivateStore } from '@aipowersalon/media';
import { JobClassLoop } from '../../jobs/job-worker';
import { AsyncExportService } from './async-export.service';
import { OperationsRepository } from './operations.repository';
import { EXPORT_JOB_TYPE } from './async-export.core';

const url = process.env.PG_RACE_URL;
const T = 'a1210000-0000-4000-8000-000000000001';
const USER = `race-p12-${process.pid}`;
const quiet = { warn: () => undefined, error: () => undefined, log: () => undefined } as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!url)('an async export runs exactly once (real Postgres)', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 6 }) }) });
  const a = url ? mk() : (null as any), b = url ? mk() : (null as any);
  const root = mkdtempSync(join(tmpdir(), 'p12-race-'));
  const produced = new Map<string, number>();
  // the run under test is the production runExportJob; only the handler invocation (produce) is a counter here
  const svcFor = (db: any) => {
    const s = new AsyncExportService(db, undefined, undefined, undefined, new LocalDiskPrivateStore(root));
    (s as any).produce = async (op: any) => { produced.set(op.id, (produced.get(op.id) ?? 0) + 1); await sleep(30); return { bytes: Buffer.from('Name\nAnn\n'), contentType: 'text/csv', filename: 'x.csv', rows: 1 }; };
    return s;
  };
  const newOp = async (db: any) => new OperationsRepository(db).create({ tenantId: T, branchId: null, realm: 'pos', actorUserId: USER, actorRole: 'MANAGER', kind: 'race.export', route: '/pos/race/export', permission: null, params: { query: {}, path: {} }, principal: { permissions: [] } });
  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'race-p12', 'race-p12', 'race-p12', 'RACE-P12', 'active') on conflict (id) do nothing`.execute(a);
  });
  afterAll(async () => {
    if (!a) return;
    await sql`delete from jobs where job_type = ${EXPORT_JOB_TYPE} and tenant_id = ${T}`.execute(a);
    await sql`delete from api_operations where actor_user_id = ${USER}`.execute(a);
    await a.destroy(); await b.destroy(); rmSync(root, { recursive: true, force: true }); resetJobHandlers();
  });

  it('two workers draining 20 export jobs: every operation is produced once and succeeds once', async () => {
    resetJobHandlers();
    const sa = svcFor(a), sb = svcFor(b);
    sa.onModuleInit();   // registers the api.export handler (process-wide), bound to sa — its db is pool A
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) { const id = await newOp(a); ids.push(id); await enqueueJob(a, { jobClass: 'report', jobType: EXPORT_JOB_TYPE, tenantId: T, payload: { operationId: id }, idempotencyKey: id }); }
    const dup = await enqueueJob(b, { jobClass: 'report', jobType: EXPORT_JOB_TYPE, tenantId: T, payload: { operationId: ids[0] }, idempotencyKey: ids[0] });
    expect(dup.duplicate).toBe(true);   // one job per operation
    const opts = { pollMs: 10, idlePollMs: 20, leaseMs: 60_000, concurrency: 4, perTenantCap: 20 };
    const w1 = new JobClassLoop(a, 'report', 'p12-w1', opts, quiet), w2 = new JobClassLoop(b, 'report', 'p12-w2', opts, quiet);
    w1.start(); w2.start();
    for (let i = 0; i < 200 && (await sql<any>`select count(*)::int n from api_operations where id = any(${ids}::uuid[]) and status <> 'succeeded'`.execute(a)).rows[0].n > 0; i++) await sleep(50);
    await w1.stop(); await w2.stop();
    expect(ids.every((id) => produced.get(id) === 1)).toBe(true);
    expect((await sql<any>`select count(*)::int n from api_operations where id = any(${ids}::uuid[]) and status = 'succeeded'`.execute(a)).rows[0].n).toBe(20);
    expect(w1.processed.succeeded + w2.processed.succeeded).toBe(20);
    void sb;
  });

  it('two runs of the SAME operation at once (a duplicate delivery): one produces, the other finds nothing to do', async () => {
    const sa = svcFor(a), sb = svcFor(b);
    const id = await newOp(a);
    const [x, y] = await Promise.all([sa.runExportJob({ operationId: id }, { attempt: 1, tenantId: T }), sb.runExportJob({ operationId: id }, { attempt: 1, tenantId: T })]);
    expect(produced.get(id)).toBe(1);
    expect([x, y].filter((r: any) => r?.skipped)).toHaveLength(1);
    expect((await sql<any>`select status from api_operations where id = ${id}`.execute(a)).rows[0].status).toBe('succeeded');
    // and once finished, a late retry is a no-op too
    expect(await sb.runExportJob({ operationId: id }, { attempt: 2, tenantId: T })).toMatchObject({ skipped: 'succeeded' });
    expect(produced.get(id)).toBe(1);
  });
});
