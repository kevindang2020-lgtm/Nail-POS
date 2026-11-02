#!/usr/bin/env node
// drill-redis-loss.mjs — Redis dies under a running API; the API keeps serving and recovers (Constitution 4 §47, §112,
// §148–151). Redis is an accelerator here, never a system of record: booking and money never touch it.
//
//   node apps/api/scripts/drills/drill-redis-loss.mjs
//   DRILL_SALON_CODE=… DRILL_OWNER_EMAIL=… DRILL_OWNER_PASSWORD=… node …/drill-redis-loss.mjs   (adds the salon-staff paths)
//
// Starts its own redis-server (127.0.0.1:6391, no persistence) and the API (PROCESS_ROLE=api) with REDIS_URL and every
// Redis feature switched on (CACHE_STORE, RATE_LIMIT_STORE, LOGIN_THROTTLE_STORE, REALTIME_BUS = redis). Then:
//   1. baseline: readiness, a failed sign-in (login throttle → Redis), and — with an owner login — a cached catalogue
//      read and a KPI read (tenant cache + tenant rate limiter → Redis); Redis holds keys and connected clients;
//   2. SIGKILL redis-server (by the PID this drill started — a crash, not a shutdown): for ~10 s the same requests
//      answer with the SAME statuses, none hangs (each < 3 s), readiness stays 200, the API process stays up;
//   3. starts Redis again on the same port: the API's clients reconnect on their own and keys are written again.
// Owner credentials are read from the environment only (never stored in this file); without them step 1–3 run the
// unauthenticated paths and say so. Everything started is stopped by PID; Redis keeps nothing on disk.
import { startDrill, sourceDbUrl, apiEnv, bootApi, spawnOwned, timed, waitFor, run, sleep, pg } from './_lib.mjs';

const drill = startDrill('redis-loss', { timeoutMs: 6 * 60_000 });
const { check, note, finish } = drill;
const DB = sourceDbUrl();
const RPORT = Number(process.env.DRILL_REDIS_PORT || 6391), API_PORT = 3172, API = `http://127.0.0.1:${API_PORT}`;
const MAX_MS = 3_000;

const which = await run('sh', ['-c', 'command -v redis-server && command -v redis-cli']);
if (!check('redis-server and redis-cli are installed here', which.code === 0, which.out.trim().replace(/\n/g, ', '))) {
  note('no Redis on this machine: run the unit-level proof instead — cd apps/api && TZ=UTC npx vitest run src/common/redis-down.vitest.spec.ts');
  await finish();
}
const cli = async (...args) => (await run('redis-cli', ['-p', String(RPORT), ...args])).out.trim();
const startRedis = async (label) => {
  const h = spawnOwned(drill, label, 'redis-server', ['--port', String(RPORT), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--protected-mode', 'yes']);
  const ok = await waitFor(async () => (await cli('ping')) === 'PONG', { timeoutMs: 10_000 });
  return { h, ok: !!ok };
};
const redisInfo = async () => {
  const clients = Number((/connected_clients:(\d+)/.exec(await cli('info', 'clients')) ?? [])[1] ?? 0);
  const keys = Number(await cli('dbsize')) || 0;
  return { clients, keys };
};

const r1 = await startRedis('redis-1');
if (!check(`redis-server started on 127.0.0.1:${RPORT} (pid ${r1.h.pid})`, r1.ok)) await finish();
const api = await bootApi(drill, {
  label: 'api', port: API_PORT,
  env: apiEnv(DB, { PROCESS_ROLE: 'api', HOSTNAME: 'drill-redis-api', REDIS_URL: `redis://127.0.0.1:${RPORT}`, CACHE_STORE: 'redis', RATE_LIMIT_STORE: 'redis', LOGIN_THROTTLE_STORE: 'redis', REALTIME_BUS: 'redis' }),
});
if (!check('API booted with REDIS_URL and every Redis feature on (PROCESS_ROLE=api)', api.booted, api.booted ? '' : api.out.text.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300))) await finish();

// ── the requests each phase repeats ──────────────────────────────────────────────────────────────────────────────────
const json = { 'content-type': 'application/json' };
// ONE made-up identifier per run (many distinct ones from one IP would trip the credential-stuffing detector);
// its login_attempts rows are removed at the end.
const LOGIN_ID = `drill-redis-${process.pid}@example.invalid`;
drill.onCleanup(async () => {
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  try { const n = (await c.query(`delete from login_attempts where identifier = $1`, [LOGIN_ID])).rowCount; note(`cleanup: ${n} login_attempts rows of ${LOGIN_ID} removed`); } finally { await c.end(); }
});
let cookie = null;
const SALON = process.env.DRILL_SALON_CODE, OWNER = process.env.DRILL_OWNER_EMAIL, OWNER_PW = process.env.DRILL_OWNER_PASSWORD;
if (SALON && OWNER && OWNER_PW) {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: OWNER, password: OWNER_PW }) });
  cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const c = new pg.Client({ connectionString: DB }); await c.connect();
  const branch = (await c.query(`select b.id from branches b join tenants t on t.id = b.tenant_id where t.tenant_code = $1 and b.status = 'active' order by b.created_at limit 1`, [SALON])).rows[0]?.id;
  await c.end();
  if (branch) {
    const sel = await fetch(`${API}/auth/select-branch`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ branchId: branch }) });
    cookie = [cookie, ...(sel.headers.getSetCookie?.() ?? []).map((x) => x.split(';')[0])].join('; ');
  }
  check('salon owner signed in (tenant paths included)', login.status === 200 && !!cookie, `status ${login.status}`);
} else note('DRILL_SALON_CODE / DRILL_OWNER_EMAIL / DRILL_OWNER_PASSWORD not set — salon-staff paths (tenant cache, tenant rate limiter) skipped');

const probes = [
  { name: 'GET /health/ready', go: () => timed(`${API}/health/ready`, { timeoutMs: 10_000 }) },
  { name: 'POST /auth/login (unknown user → login throttle)', go: () => timed(`${API}/auth/login`, { method: 'POST', headers: json, timeoutMs: 10_000, body: JSON.stringify({ portal: 'super-admin', identifier: LOGIN_ID, password: 'wrong-password-for-drill' }) }) },
  ...(cookie ? [
    { name: 'GET /pos/services/categories (tenant cache)', go: () => timed(`${API}/pos/services/categories`, { headers: { cookie }, timeoutMs: 10_000 }) },
    { name: 'GET /pos/services/kpis (tenant rate limiter)', go: () => timed(`${API}/pos/services/kpis`, { headers: { cookie }, timeoutMs: 10_000 }) },
  ] : []),
];
const round = async () => { const out = []; for (const p of probes) out.push({ name: p.name, ...(await p.go()) }); return out; };
const show = (rs) => rs.map((r) => `${r.status}${r.error ? '(' + r.error + ')' : ''}/${r.ms}ms`).join(' ');

// ── 1: baseline ──────────────────────────────────────────────────────────────────────────────────────────────────────
const b0 = await round(); const b1 = await round();
const baseline = b1.map((r) => r.status);
check('baseline: every request answers (no 5xx)', b1.every((r) => r.status > 0 && r.status < 500), show(b1));
const i0 = await redisInfo();
check('Redis is really in use (connected clients and keys)', i0.clients > 0 && i0.keys > 0, `${i0.clients} clients, ${i0.keys} keys`);
void b0;

// ── 2: Redis crashes ─────────────────────────────────────────────────────────────────────────────────────────────────
process.kill(r1.h.pid, 'SIGKILL');
await r1.h.waitExit(5_000);
check('redis-server killed (SIGKILL by PID)', !r1.h.alive() && (await cli('ping')) !== 'PONG');
const tDown = Date.now();
const down = [];
while (Date.now() - tDown < 10_000) { down.push(await round()); await sleep(500); }
const flat = down.flat();
const slowest = Math.max(...flat.map((r) => r.ms));
check('during the outage every request answers with its baseline status', down.every((rs) => rs.every((r, i) => r.status === baseline[i])), down.map(show).slice(0, 3).join(' || '));
check(`during the outage no request hangs (each < ${MAX_MS} ms)`, flat.every((r) => r.status > 0 && r.ms < MAX_MS), `${flat.length} requests, slowest ${slowest} ms`);
check('the API process stayed up', api.alive());

// ── 3: Redis returns ─────────────────────────────────────────────────────────────────────────────────────────────────
const r2 = await startRedis('redis-2');
check(`redis-server restarted on the same port (pid ${r2.h.pid}, empty — no persistence)`, r2.ok);
const tUp = Date.now();
const back = await waitFor(async () => { await round(); const i = await redisInfo(); return i.clients > 0 && i.keys > 0 ? i : null; }, { timeoutMs: 30_000, stepMs: 500 });
check('the API reconnected on its own and writes keys again', !!back, back ? `${back.clients} clients, ${back.keys} keys after ${((Date.now() - tUp) / 1000).toFixed(1)} s` : 'no reconnect within 30 s');
const after = await round();
if (cookie) await timed(`${API}/auth/logout`, { method: 'POST', headers: { cookie }, timeoutMs: 5_000 });
check('after recovery every request answers with its baseline status', after.every((r, i) => r.status === baseline[i]), show(after));
await finish(`outage ${flat.length} requests, slowest ${slowest} ms`);
