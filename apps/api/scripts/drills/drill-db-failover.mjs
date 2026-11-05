#!/usr/bin/env node
// drill-db-failover.mjs — PostgreSQL goes away under a running API and comes back (Constitution 4 §51–55, §99, §148–151;
// bug E1 fixed in Phase 10: packages/database/src/kysely.provider.ts keepPoolAlive + connect/statement timeouts).
//
//   node apps/api/scripts/drills/drill-db-failover.mjs              stop + start the local PostgreSQL service (a restart;
//                                                                   needs `service postgresql` — LOCAL machines only)
//   node apps/api/scripts/drills/drill-db-failover.mjs --terminate  the server kills every API connection
//                                                                   (pg_terminate_backend) — no restart, nothing else hit
//
// The API (PROCESS_ROLE=all, today's single-service deploy) runs against its own scratch database drill_failover
// (migrated fresh, dropped at the end). Readiness is probed every 100 ms and a database-backed request (a failed
// read of a checkout session) every 250 ms, each with its own deadline, all through the event. Asserts:
//   • the API process never exits (an idle-connection error is discarded, not fatal) and logs the discard;
//   • restart mode: /health/ready flips 200 → 503 while the database is down → 200 again, with no restart of the API;
//   • every request is answered (no hang) — the slowest well under the connect timeout + the statement timeout;
//   • after recovery the database-backed request answers as before;
//   • the local `postgres` database is intact afterwards (ledger and core row counts unchanged).
// Restart mode keeps PostgreSQL down only as long as it takes to observe one 503, and its cleanup starts PostgreSQL
// again if anything goes wrong.
import { randomUUID } from 'node:crypto';
import { startDrill, sourceDbUrl, createScratchDb, apiEnv, bootApi, timed, waitFor, run, sleep, pg, pct, API_DIR } from './_lib.mjs';

const TERMINATE = process.argv.includes('--terminate');
const drill = startDrill(TERMINATE ? 'db-failover (terminate connections)' : 'db-failover (restart)', { timeoutMs: 5 * 60_000 });
const { check, note, onCleanup, finish } = drill;
const SRC = sourceDbUrl();
const API_PORT = 3173, API = `http://127.0.0.1:${API_PORT}`;
const CONNECT_TIMEOUT_MS = Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000);
const STATEMENT_TIMEOUT_MS = 120_000;   // ROLE_TIMEOUTS.all.statement (kysely.provider.ts) — PROCESS_ROLE=all below

const pgUp = async () => (await run('pg_isready', ['-h', '127.0.0.1', '-p', String(new URL(SRC).port || 5432)])).code === 0;
const facts = async () => {
  const c = new pg.Client({ connectionString: SRC }); await c.connect();
  try { return (await c.query(`select (select count(*) from schema_migrations)::int m, (select count(*) from tenants)::int t, (select count(*) from payments)::int p, (select count(*) from tickets)::int k`)).rows[0]; }
  finally { await c.end(); }
};
const factsBefore = await facts();

const url = await createScratchDb(drill, SRC, 'drill_failover');
const mig = await run('node', ['scripts/migrate.mjs'], { cwd: API_DIR, env: { ...process.env, DATABASE_URL: url } });
check('scratch database migrated', mig.code === 0, mig.out.trim().split('\n').at(-1));
const api = await bootApi(drill, { label: 'api', port: API_PORT, env: apiEnv(url, { PROCESS_ROLE: 'all', HOSTNAME: 'drill-failover-api' }) });
if (!check('API booted (PROCESS_ROLE=all)', api.booted)) await finish();

// warm the pool so idle connections exist when the server drops them
// A public route that queries the database to answer: a customer-display checkout session that does not exist. Its
// repository swallows a query error and answers "not found" (KyselyDisplayRepository.getSession `.catch(() => undefined)`),
// so during the outage it still answers 404: it proves "no hang", readiness proves the outage.
const SESSION = randomUUID();
const login = () => timed(`${API}/customer-display/checkout/${SESSION}?token=drill-not-a-token`, { timeoutMs: STATEMENT_TIMEOUT_MS });
await Promise.all(Array.from({ length: 10 }, () => login()));
const base = await login();
check('baseline: the database-backed request answers', base.status > 0 && base.status < 500, `${base.status} in ${base.ms} ms`);

// ── probes through the event ─────────────────────────────────────────────────────────────────────────────────────────
const ready = [], db = [];
let probing = true;
const pending = new Set();
const fire = (arr, fn) => { const p = fn().then((r) => { arr.push({ at: Date.now(), ...r }); }); pending.add(p); p.finally(() => pending.delete(p)); };
const loopReady = (async () => { while (probing) { fire(ready, () => timed(`${API}/health/ready`, { timeoutMs: STATEMENT_TIMEOUT_MS })); await sleep(100); } })();
const loopDb = (async () => { while (probing) { fire(db, login); await sleep(250); } })();
await sleep(1_000);

let outageMs = null;
if (TERMINATE) {
  const c = new pg.Client({ connectionString: SRC }); await c.connect();
  const n = (await c.query(`select count(*)::int n from (select pg_terminate_backend(pid) from pg_stat_activity where datname = 'drill_failover' and pid <> pg_backend_pid()) x`)).rows[0].n;
  await c.end();
  note(`terminated ${n} API connections (pg_terminate_backend)`);
  await sleep(4_000);
} else {
  onCleanup(async () => { if (!(await pgUp())) { note('cleanup: PostgreSQL was down — starting it'); await run('service', ['postgresql', 'start']); await waitFor(pgUp, { timeoutMs: 20_000 }); } });
  const t0 = Date.now();
  const stop = await run('service', ['postgresql', 'stop']);
  const saw503 = await waitFor(() => ready.some((r) => r.at > t0 && r.status === 503), { timeoutMs: 5_000, stepMs: 50 });
  const start = await run('service', ['postgresql', 'start']);
  await waitFor(pgUp, { timeoutMs: 20_000, stepMs: 100 });
  outageMs = Date.now() - t0;
  check('PostgreSQL stopped and started again (one restart)', stop.code === 0 && start.code === 0 && await pgUp(), `database unavailable ${(outageMs / 1000).toFixed(1)} s${saw503 ? '' : ' (no 503 observed within 5 s)'}`);
  await waitFor(() => ready.some((r) => r.at > t0 + outageMs && r.status === 200), { timeoutMs: 30_000, stepMs: 100 });
  await sleep(2_000);
}
probing = false; await loopReady; await loopDb;
await Promise.race([Promise.allSettled([...pending]), sleep(STATEMENT_TIMEOUT_MS + 5_000)]);

// ── verdicts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
check('the API process never exited', api.alive(), api.alive() ? `pid ${api.pid}` : `exit ${JSON.stringify(api.exitInfo())}: ${api.out.text.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`);
check('the pool discarded the broken idle connections and said so (keepPoolAlive)', /an idle connection failed and was discarded/.test(api.out.text), (api.out.text.match(/\[database\] an idle connection failed[^\n]*/) ?? ['no such log line'])[0].slice(0, 160));
const seq = ready.sort((a, b) => a.at - b.at).map((r) => r.status);
const compact = seq.reduce((m, s) => (m.length && m[m.length - 1][0] === s ? (m[m.length - 1][1]++, m) : [...m, [s, 1]]), []).map(([s, n]) => `${s}×${n}`).join(' → ');
if (!TERMINATE) check('readiness flipped 200 → 503 → 200 without restarting the API', /^200×\d+ → 503×\d+( → 0×\d+)?( → 503×\d+)* → 200×\d+$/.test(compact) || (seq[0] === 200 && seq.includes(503) && seq.at(-1) === 200 && !seq.includes(0)), compact);
else check('readiness recovered by itself: at most the probes that drew a killed connection failed, then 200 again', seq.length > 0 && !seq.includes(0) && seq.slice(-10).every((s) => s === 200) && seq.filter((s) => s !== 200).length <= 3, compact);
const all = [...ready, ...db];
const unanswered = all.filter((r) => r.status === 0);
const slowest = Math.max(...all.map((r) => r.ms));
check(`no request hung: all ${all.length} answered, the slowest under the connect timeout (${CONNECT_TIMEOUT_MS / 1000} s) and the statement timeout (${STATEMENT_TIMEOUT_MS / 1000} s)`, unanswered.length === 0 && slowest < Math.min(CONNECT_TIMEOUT_MS + 2_000, STATEMENT_TIMEOUT_MS), `slowest ${slowest} ms, p95 ${pct(all.map((r) => r.ms), 95)} ms, ${unanswered.length} unanswered`);
const dbStatuses = [...new Set(db.map((r) => r.status))].join(',');
const after = await login();
check('after recovery the database-backed request answers as before', after.status === base.status, `${after.status} (baseline ${base.status}); during the event: ${dbStatuses}`);
const factsAfter = await facts();
check('the source database is intact — nothing lost (ledger, tenants, payments, tickets; other processes may add rows)', ['m', 't', 'p', 'k'].every((k) => factsAfter[k] >= factsBefore[k]), `${JSON.stringify(factsBefore)} → ${JSON.stringify(factsAfter)}`);
await finish(TERMINATE ? `slowest ${slowest} ms` : `PostgreSQL down ${(outageMs / 1000).toFixed(1)}s, slowest request ${slowest} ms`);
