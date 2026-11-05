#!/usr/bin/env node
// drill-worker-loss.mjs — a worker dies mid-job; nothing is lost and nothing completes twice (Constitution 4 §28–34,
// §148–151; the jobs queue of BUILD_PLAN Phase 2, packages/database/src/job-queue.ts + apps/api/src/jobs/job-worker.ts).
//
//   node apps/api/scripts/drills/drill-worker-loss.mjs               real lease: waits out the 5-minute lease (~6–7 min)
//   node apps/api/scripts/drills/drill-worker-loss.mjs --fast-lease  ends the dead worker's leases early (~1–2 min)
//
// Runs in its OWN scratch database (drill_worker_loss, migrated fresh, dropped at the end) so no other process on this
// machine can claim its jobs. Starts the API with PROCESS_ROLE=api and worker A (dist/worker.js), enqueues 12
// `jobs.self_test` jobs that each hold their slot 1.5 s, SIGKILLs worker A (by the PID this drill started) while it has
// jobs in flight, starts worker B, and asserts:
//   • while the dead worker's lease is still valid nobody takes its jobs (no double execution);
//   • the lease lapses and the reaper (worker B's single-owner `jobs.reap_expired_leases` tick) puts them back;
//   • every job ends `succeeded` exactly once: the ones A finished are not re-run (attempts = 1, processed by A), the
//     interrupted ones are finished by B (attempts = 2), none dead, none processed by the API process;
//   • the API stays ready throughout.
// --fast-lease moves the dead worker's lease_until to now (what 5 minutes of waiting would do) — the reaper, the claim
// and the completion are still the real code. The documented run uses the real lease.
import { randomUUID } from 'node:crypto';
import { startDrill, sourceDbUrl, createScratchDb, apiEnv, bootApi, spawnOwned, timed, waitFor, run, sleep, pg, require, API_DIR } from './_lib.mjs';

const FAST = process.argv.includes('--fast-lease');
const drill = startDrill('worker-loss', { timeoutMs: (FAST ? 6 : 12) * 60_000 });
const { check, note, onCleanup, finish } = drill;
const SRC = sourceDbUrl();
const N = 12, HOLD_MS = 1_500, API_PORT = 3171;

const url = await createScratchDb(drill, SRC, 'drill_worker_loss');
const mig = await run('node', ['scripts/migrate.mjs'], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url } });
check('scratch database migrated', mig.code === 0, mig.out.trim().split('\n').at(-1));
if (mig.code !== 0) await finish();

const c = new pg.Client({ connectionString: url }); await c.connect();
onCleanup(async () => { await c.end().catch(() => undefined); });
const q = async (s, p = []) => (await c.query(s, p)).rows;

const base = { JOBS_IDLE_POLL_MS: '200', JOBS_CONCURRENCY_STANDARD: '4' };
const api = await bootApi(drill, { label: 'api', env: apiEnv(url, { ...base, PROCESS_ROLE: 'api', HOSTNAME: 'drill-api' }), port: API_PORT });
if (!check('API booted with PROCESS_ROLE=api', api.booted, api.booted ? '' : api.out.text.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300))) await finish();
const workerA = spawnOwned(drill, 'worker-A', 'node', ['dist/worker.js'], { cwd: API_DIR, env: apiEnv(url, { ...base, PROCESS_ROLE: 'worker', HOSTNAME: 'drill-worker-A' }) });
const aUp = await waitFor(() => /\[worker\] started/.test(workerA.out.text), { timeoutMs: 90_000 });
if (!check('worker A started (PROCESS_ROLE=worker, every job class)', !!aUp && workerA.alive(), (workerA.out.text.match(/\[worker\] started[^\n]*/) ?? [''])[0])) await finish();
await sleep(1_500);   // the job loops start in onModuleInit, just before the started line; give the first poll a moment

// enqueue through the queue's own API
const { Kysely, PostgresDialect } = require('kysely');
const { enqueueJob } = require('@aipowersalon/database');
const kdb = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 2 }) }) });
onCleanup(async () => { await kdb.destroy().catch(() => undefined); });
const tag = randomUUID().slice(0, 8);
const ids = [];
for (let i = 0; i < N; i++) ids.push((await enqueueJob(kdb, { jobClass: 'standard', jobType: 'jobs.self_test', payload: { holdMs: HOLD_MS }, idempotencyKey: `drill-${tag}-${i}`, createdBy: 'drill-worker-loss' })).id);
note(`enqueued ${ids.length} jobs.self_test (standard, hold ${HOLD_MS} ms)`);
const jobs = () => q(`select id, status, attempts, lease_owner, last_error, result->>'processedBy' by from jobs where id = any($1::uuid[])`, [ids]);

// kill A while it has jobs running and has finished at least one
const inFlight = await waitFor(async () => { const r = await jobs(); const run = r.filter((j) => j.status === 'running' && /^drill-worker-A:/.test(j.lease_owner ?? '')); const done = r.filter((j) => j.status === 'succeeded'); return run.length >= 2 && done.length >= 1 ? r : null; }, { timeoutMs: 60_000, stepMs: 50 });
if (!check('worker A is mid-run (≥ 2 jobs in flight, ≥ 1 finished)', !!inFlight)) await finish();
process.kill(workerA.pid, 'SIGKILL');
const tKill = Date.now();
await workerA.waitExit(5_000);
const atKill = await jobs();
const doneByA = atKill.filter((j) => j.status === 'succeeded').map((j) => j.id);
const stranded = atKill.filter((j) => j.status === 'running' && /^drill-worker-A:/.test(j.lease_owner ?? '')).map((j) => j.id);
check('worker A killed with SIGKILL (by its PID) — no graceful shutdown', !workerA.alive() && workerA.exitInfo()?.signal === 'SIGKILL', `pid ${workerA.pid}; ${doneByA.length} done by A, ${stranded.length} stranded mid-run, ${atKill.filter((j) => j.status === 'queued').length} still queued`);

const workerB = spawnOwned(drill, 'worker-B', 'node', ['dist/worker.js'], { cwd: API_DIR, env: apiEnv(url, { ...base, PROCESS_ROLE: 'worker', HOSTNAME: 'drill-worker-B' }) });
const bUp = await waitFor(() => /\[worker\] started/.test(workerB.out.text), { timeoutMs: 90_000 });
check('worker B started', !!bUp && workerB.alive());

// while A's lease is valid, its jobs stay with A (B finishes the queued ones only)
await waitFor(async () => (await jobs()).filter((j) => j.status === 'queued').length === 0, { timeoutMs: 60_000 });
await sleep(3_000);
const mid = await jobs();
const stillA = mid.filter((j) => stranded.includes(j.id) && j.status === 'running' && /^drill-worker-A:/.test(j.lease_owner ?? ''));
check('while the dead worker\'s lease is valid, nobody takes its jobs (no double execution)', stillA.length === stranded.length, `${stillA.length}/${stranded.length} still leased to A`);

const readyDuring = [];
const probe = setInterval(async () => { readyDuring.push((await timed(`http://127.0.0.1:${API_PORT}/health/ready`, { timeoutMs: 5_000 })).status); }, 2_000);
onCleanup(() => clearInterval(probe));
if (FAST) {
  await q(`update jobs set lease_until = now() - interval '1 second' where id = any($1::uuid[]) and status = 'running'`, [stranded]);
  note('--fast-lease: the dead worker\'s leases set to lapse now (production: they lapse 5 minutes after the last renewal)');
} else note('waiting for the real 5-minute lease to lapse, then the reaper (every 60 s)…');

const leaseMs = 5 * 60_000;
const reaped = await waitFor(async () => { const r = await jobs(); return stranded.every((id) => r.find((j) => j.id === id)?.status !== 'running' || !/^drill-worker-A:/.test(r.find((j) => j.id === id)?.lease_owner ?? '')) ? r : null; }, { timeoutMs: (FAST ? 0 : leaseMs) + 150_000, stepMs: 1_000 });
check('the dead worker\'s leases lapsed and the reaper put its jobs back', !!reaped, reaped ? `after ${((Date.now() - tKill) / 1000).toFixed(0)} s` : 'still leased to the dead worker');
const all = await waitFor(async () => { const r = await jobs(); return r.every((j) => j.status === 'succeeded') ? r : null; }, { timeoutMs: 60_000 });
const tRecovered = Date.now() - tKill;
clearInterval(probe);
const fin = all ?? await jobs();
const byStatus = fin.reduce((m, j) => ({ ...m, [j.status]: (m[j.status] ?? 0) + 1 }), {});
check(`every job succeeded (${N}/${N}), none dead, none lost`, !!all && fin.length === N, JSON.stringify(byStatus));
const reRun = fin.filter((j) => doneByA.includes(j.id) && (Number(j.attempts) !== 1 || !/^drill-worker-A:/.test(j.by ?? '')));
check('jobs worker A finished before it died were not run again (attempts = 1, processed by A)', doneByA.length > 0 && reRun.length === 0, `${doneByA.length} checked`);
const finishedByB = fin.filter((j) => stranded.includes(j.id));
check('the interrupted jobs were finished once by worker B (attempts = 2: A\'s lost attempt + B\'s)', stranded.length > 0 && finishedByB.every((j) => Number(j.attempts) === 2 && /^drill-worker-B:/.test(j.by ?? '')), finishedByB.map((j) => `${j.attempts}/${(j.by ?? '').split(':')[0]}`).join(' '));
check('the API process (PROCESS_ROLE=api) ran no job', fin.every((j) => !/^drill-api:/.test(j.by ?? '')));
check('the API stayed ready while the worker was down', readyDuring.length > 0 && readyDuring.every((s) => s === 200), `${readyDuring.length} probes: ${[...new Set(readyDuring)].join(',')}`);
const how = FAST ? ' (lease fast-forwarded)' : ' (real lease)';
note(all ? `recovery: kill → every job succeeded in ${(tRecovered / 1000).toFixed(0)} s${how}` : `NOT recovered ${(tRecovered / 1000).toFixed(0)} s after the kill${how}`);
await finish(all ? `recovered in ${(tRecovered / 1000).toFixed(0)}s${FAST ? ' (fast lease)' : ' (real 5-min lease)'}` : 'not recovered');
