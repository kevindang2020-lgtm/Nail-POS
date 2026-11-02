// worker-role.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12 "Workers least privileged") on a REAL
// Postgres. PG_RACE_URL must be a superuser login (CI: postgres). The test makes its OWN scratch database, migrates it with
// the real runner, provisions uniquely-named copies of aps_api / aps_worker with the real script (dry-run first, then
// twice — idempotent), and then:
//   • runs the worker's job types AS the worker login: the real JobClassLoop claims / leases / completes / retries / buries
//     jobs (tenant-quota subqueries included), the reaper requeues a dead worker's job, the telemetry sink writes, and the
//     central retention executor purges every table it owns without a single permission error;
//   • proves the worker is refused everything else (DDL, TRUNCATE, role management, temp tables, tables it never touches);
//   • proves the API login has rows but no structure (and that a table a later migration creates reaches the API at once
//     but NOT the worker).
// Everything is dropped at the end (database + roles). No process clock is compared with the database's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { enqueueJob, registerJobHandler, jobHandlerFor, reapExpiredLeases } from '@aipowersalon/database';
import { RetentionExecutorService } from '@aipowersalon/super-admin';
import { JobClassLoop, registerBuiltInJobHandlers, SELF_TEST_JOB } from '../jobs/job-worker';
import { writeTelemetryBatch } from '../observability/telemetry-store';

const url = process.env.PG_RACE_URL;
const API_DIR = join(__dirname, '..', '..');
const TAG = `p${process.pid}${randomBytes(2).toString('hex')}`;
const DB = `race_roles_${TAG}`;
const API_ROLE = `aps_api_${TAG}`, WORKER_ROLE = `aps_worker_${TAG}`;
const PW = { api: randomBytes(12).toString('hex'), worker: randomBytes(12).toString('hex') };
const T1 = 'c1410000-0000-4000-8000-000000000001';
const quiet = { warn() {}, error() {}, log() {} };

function urlFor(base: string, db: string, user?: string, password?: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  if (user) { u.username = user; u.password = password ?? ''; }
  return u.toString();
}
const mk = (cs: string) => {
  const pool = new pg.Pool({ connectionString: cs, max: 4 });
  pool.on('error', () => undefined);   // DROP DATABASE … WITH (FORCE) at the end terminates whatever is still idle
  return new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
};
/** The statement is refused for lack of privilege (42501) — not merely failing for some other reason. */
async function refused(db: Kysely<any>, text: string): Promise<void> {
  const err: any = await sql.raw(text).execute(db).then(() => null, (e) => e);
  expect(err, `expected "${text}" to be refused`).not.toBeNull();
  expect(String(err.code), `"${text}" failed with ${err?.code}: ${err?.message}`).toBe('42501');
}

describe.skipIf(!url)('least-privilege database roles on real Postgres', () => {
  let admin: pg.Client; let owner: Kysely<any>; let api: Kysely<any>; let worker: Kysely<any>;
  let prov: any; const logs: string[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`CREATE DATABASE ${DB}`);
    const scratch = urlFor(url!, DB);
    const m = spawnSync(process.execPath, ['scripts/migrate.mjs'], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: scratch, MIGRATE_DATABASE_URL: '' }, encoding: 'utf8' });
    if (m.status !== 0) throw new Error(`migrate failed: ${m.stderr || m.stdout}`);
    prov = await import(pathToFileURL(join(API_DIR, 'scripts', 'db-provision-roles.mjs')).href);
    owner = mk(scratch);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T1}, 'roles', 'roles', ${'roles-' + TAG}, 'ROLES1', 'active')`.execute(owner);
  }, 120_000);

  afterAll(async () => {
    for (const k of [api, worker, owner]) await k?.destroy().catch(() => undefined);
    if (!admin) return;
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => undefined);
    for (const r of [API_ROLE, WORKER_ROLE]) await admin.query(`DROP ROLE IF EXISTS "${r}"`).catch(() => undefined);
    await admin.end();
  }, 60_000);

  it('--dry-run changes nothing; provisioning twice converges to the same grants', async () => {
    const scratch = urlFor(url!, DB);
    const dry = await prov.provision({ url: scratch, apiRole: API_ROLE, workerRole: WORKER_ROLE, dryRun: true, log: (s: string) => logs.push(s) });
    expect(dry.before.roles).toEqual([]);
    expect(dry.after.roles.map((r: any) => r.rolname).sort()).toEqual([API_ROLE, WORKER_ROLE].sort());
    expect((await admin.query(`select 1 from pg_roles where rolname = any($1)`, [[API_ROLE, WORKER_ROLE]])).rowCount).toBe(0);   // rolled back

    const first = await prov.provision({ url: scratch, apiRole: API_ROLE, workerRole: WORKER_ROLE, passwords: PW, log: (s: string) => logs.push(s) });
    const second = await prov.provision({ url: scratch, apiRole: API_ROLE, workerRole: WORKER_ROLE, passwords: PW, log: (s: string) => logs.push(s) });
    expect(second.before).toEqual(first.after);
    expect(second.after).toEqual(first.after);
    for (const r of first.after.roles) expect(r).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolcanlogin: true });
    expect(logs.join('\n')).not.toContain(PW.api);   // the passwords are never printed
    expect(logs.join('\n')).not.toContain(PW.worker);
    api = mk(urlFor(url!, DB, API_ROLE, PW.api));
    worker = mk(urlFor(url!, DB, WORKER_ROLE, PW.worker));
    expect((await sql<any>`select current_user u`.execute(worker)).rows[0].u).toBe(WORKER_ROLE);
  }, 60_000);

  it("the worker's job types run as the worker login: claim, lease, complete, retry, bury, reap", async () => {
    registerBuiltInJobHandlers('roles-test');
    if (!jobHandlerFor('roles_test.fails')) registerJobHandler('roles_test.fails', async () => { throw new Error('boom'); });
    // the API enqueues (its own login), the worker runs
    const ok = await enqueueJob(api, { jobClass: 'standard', jobType: SELF_TEST_JOB, tenantId: T1, payload: { holdMs: 0 } });
    const platform = await enqueueJob(api, { jobClass: 'standard', jobType: SELF_TEST_JOB, payload: {} });
    const bad = await enqueueJob(api, { jobClass: 'standard', jobType: 'roles_test.fails', tenantId: T1, maxAttempts: 1 });
    const orphan = await enqueueJob(api, { jobClass: 'standard', jobType: 'roles_test.nobody_handles', maxAttempts: 3 });
    const loop = new JobClassLoop(worker, 'standard', 'roles-test', { pollMs: 10, idlePollMs: 10, leaseMs: 60_000, concurrency: 8, perTenantCap: 3 }, quiet);
    expect(await loop.pump()).toBe(4);
    await loop.stop(10_000);
    const st = Object.fromEntries((await sql<any>`select id, status from jobs where id in (${ok.id}, ${platform.id}, ${bad.id}, ${orphan.id})`.execute(owner)).rows.map((r: any) => [r.id, r.status]));
    expect(st).toEqual({ [ok.id]: 'succeeded', [platform.id]: 'succeeded', [bad.id]: 'dead', [orphan.id]: 'dead' });
    expect(loop.processed).toEqual({ succeeded: 2, retried: 0, dead: 2 });

    // a job whose worker died (lease in the past): the reaper, as the worker, puts it back in the queue
    const stuck = await enqueueJob(api, { jobClass: 'standard', jobType: SELF_TEST_JOB, payload: {} });
    await sql`update jobs set status = 'running', lease_owner = 'gone', lease_until = now() - interval '1 minute', attempts = 1 where id = ${stuck.id}`.execute(owner);
    expect(await reapExpiredLeases(worker)).toMatchObject({ requeued: 1 });
    expect((await sql<any>`select status from jobs where id = ${stuck.id}`.execute(owner)).rows[0].status).toBe('queued');
  }, 60_000);

  it('the telemetry sink writes as the worker', async () => {
    const ts = (await sql<any>`select now() n`.execute(owner)).rows[0].n;
    await writeTelemetryBatch(worker, {
      logs: [{ ts, level: 'warn', service: 'api', process_role: 'all', request_id: `r-${TAG}`, correlation_id: null, trace_id: null, span_id: null, tenant_id: null, route: '/x', status: 500, duration_ms: 3, msg: 'roles test', fields: {} }],
      spans: [{ trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), parent_span_id: null, name: 'GET /x', kind: 'server', service: 'api', start_ts: ts, duration_ms: 1, status: 'ok', status_message: null, attributes: {}, tenant_id: null }],
    } as any);
    expect((await sql<any>`select count(*)::int n from telemetry_log_events where request_id = ${'r-' + TAG}`.execute(owner)).rows[0].n).toBe(1);
  });

  it('the central retention executor purges every table it owns, as the worker, with no permission error', async () => {
    const seeded = (await sql<any>`insert into login_attempts (identifier, success, created_at) values (${'roles-' + TAG}, false, now() - interval '400 days') returning id`.execute(owner)).rows[0].id;
    const res = await new RetentionExecutorService(worker as any).run({ dryRun: false, trigger: 'job' });
    expect(res.invalidEntries).toEqual([]);
    const errors = res.results.filter((r: any) => r.error);
    expect(errors, JSON.stringify(errors)).toEqual([]);
    expect(res.results.length).toBe(prov.deriveWorkerGrants().filter((g: any) => g.why.includes('retention-policy.json (central executor)') && g.privs.includes('DELETE')).length);
    expect((await sql<any>`select count(*)::int n from data_retention_purge_runs where triggered_by = 'job'`.execute(owner)).rows[0].n).toBeGreaterThan(0);
    expect((await sql<any>`select count(*)::int n from login_attempts where id = ${seeded}`.execute(owner)).rows[0].n).toBe(0);   // really purged
  }, 60_000);

  it('the worker is refused everything else', async () => {
    for (const s of [
      'CREATE TABLE roles_probe (id int)', 'CREATE TEMP TABLE roles_probe_tmp (id int)', 'DROP TABLE jobs', 'ALTER TABLE jobs ADD COLUMN probe int',
      'TRUNCATE jobs', 'CREATE INDEX roles_probe_idx ON jobs (job_type)', `CREATE ROLE roles_probe_${TAG}`, `ALTER ROLE "${WORKER_ROLE}" CREATEROLE`,
      'SELECT * FROM customers LIMIT 1', 'SELECT email FROM users LIMIT 1', 'SELECT * FROM payments LIMIT 1', 'SELECT * FROM gift_cards LIMIT 1',
      `UPDATE tenants SET display_name = 'x' WHERE false`, `INSERT INTO payments (tenant_id) VALUES ('${T1}')`, 'DELETE FROM audit_logs WHERE false',
      `INSERT INTO jobs (job_class, job_type) VALUES ('standard', 'x')`,           // only the API enqueues
      'SELECT * FROM tenant_subscriptions LIMIT 1',                              // column grant only: no billing details
      'DELETE FROM telemetry_log_events WHERE false',                            // insert-only sink
    ]) await refused(worker, s);
  });

  it('the API login has rows, never structure; a later migration reaches the API at once and the worker not at all', async () => {
    expect((await sql<any>`select count(*)::int n from tenants where id = ${T1}`.execute(api)).rows[0].n).toBe(1);
    await sql`update tenants set display_name = 'roles api' where id = ${T1}`.execute(api);
    for (const s of [
      'CREATE TABLE roles_probe (id int)', 'CREATE TEMP TABLE roles_probe_tmp (id int)', 'DROP TABLE jobs', 'ALTER TABLE jobs ADD COLUMN probe int',
      'TRUNCATE jobs', `CREATE ROLE roles_probe_${TAG}`, `GRANT "${WORKER_ROLE}" TO "${API_ROLE}"`, 'ALTER TABLE tenants DISABLE ROW LEVEL SECURITY',
    ]) await refused(api, s);
    await sql`create table roles_later_migration (id int)`.execute(owner);   // what the owner's next migration does
    await sql`insert into roles_later_migration values (1)`.execute(api);
    expect((await sql<any>`select count(*)::int n from roles_later_migration`.execute(api)).rows[0].n).toBe(1);
    await refused(worker, 'SELECT * FROM roles_later_migration');
  });
});
