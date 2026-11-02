#!/usr/bin/env node
// m4-clock-burst-bench.mjs — M4 200-technician scale (Oct 24 2026): the clock-in burst and the POS queue state, measured
// in isolation and repeatably, against the real API (dist/main.js) on a COPY of a pilot database that holds the
// 200-technician salon (default template: pilot_r5, the M5 pilot run). The pilot's phase 11 measures the same two things
// once per ~6-minute run; this answers in ~1 minute per round, so a change can be profiled before / after.
//
//   1. CREATE DATABASE <BENCH_DB> TEMPLATE <BENCH_TEMPLATE>, migrate it (scripts/migrate.mjs);
//   2. per round: put the salon back to "the doors just opened" — every open punch of the salon closed and moved to an
//      older day, the workforce state CLOCKED_OUT, today's turn rotation moved to an older day (replica role, so the
//      append-only trigger is bypassed in this scratch copy only) — then give 100 active technicians of the branch a
//      fresh Clock PIN (hashed exactly as the API does) and fire 100 kiosk clock-ins at once;
//   3. reports wall / p50 / p95 / max, checks 100 open shifts and 100 rotation joins, then times GET /pos/queue/state
//      (5 samples) with the 100 clocked in, signed in as the salon's front desk.
//   DATABASE_URL=postgres://…/postgres node apps/api/scripts/m4-clock-burst-bench.mjs [--rounds 3] [--keep] [--pin-hash pin|password]
// --pin-hash (M4-1, Oct 26 2026): how the 100 PINs are seeded. `pin` (default) = the Clock PIN cost (clock-pin-hash.ts,
// N = 2048) — the steady state after every technician has clocked in once; `password` = the pre-M4-1 cost (N = 16384):
// round 1 then measures the transition (each tap verifies at the old cost AND re-hashes at the new one), rounds 2+ the
// steady state, since the API re-hashes on the first successful clock-in.
// Never point it at production: it creates and DROPS the database named BENCH_DB (default bench_clock).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const { hashPassword } = require(join(ROOT, 'packages/auth/dist/password.js'));
const { pinLookupKeyFromEnv } = require(join(ROOT, 'modules/workforce/dist/technician-clock-pin/clock-pin-lookup.js'));
const { hashClockPin } = require(join(ROOT, 'modules/workforce/dist/technician-clock-pin/clock-pin-hash.js'));

const base = process.env.DATABASE_URL;
if (!base) { console.error('DATABASE_URL is required'); process.exit(2); }
const NAME = process.env.BENCH_DB || 'bench_clock';
const TEMPLATE = process.env.BENCH_TEMPLATE || 'pilot_r5';
if (!/^bench_[a-z0-9_]+$/.test(NAME)) { console.error('BENCH_DB must start with bench_'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg('--rounds', 3));
const PIN_HASH = arg('--pin-hash', 'pin') === 'password' ? hashPassword : hashClockPin;
const url = (db) => { const u = new URL(base); u.pathname = '/' + db; return u.toString(); };
const PORT = Number(process.env.BENCH_PORT || 3291), API = `http://127.0.0.1:${PORT}`;
const SECRET = 'live-proof-session-secret-0123456789abcdef';   // the pilot's: its PIN digests and sessions stay valid
const STAFF_PW = 'Bench!Desk-2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t), headers: r.headers }; } catch { return { status: r.status, body: t, headers: r.headers }; } };

if (!process.argv.includes('--reuse')) {
  const admin = new pg.Client({ connectionString: url('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${NAME} TEMPLATE ${TEMPLATE}`);
  await admin.end();
}
const mig = spawnSync(process.execPath, [join(HERE, 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: url(NAME) }, encoding: 'utf8' });
if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(1); }
const c = new pg.Client({ connectionString: url(NAME) });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;

const T = (await q(`select tenant_id from technicians group by 1 order by count(*) desc limit 1`))[0].tenant_id;
const B = (await q(`select branch_id from technicians where tenant_id = $1 and is_active group by 1 order by count(*) desc limit 1`, [T]))[0].branch_id;
const SALON = (await q(`select tenant_code from tenants where id = $1`, [T]))[0].tenant_code;
const SLUG = (await q(`select checkin_slug from go_checkin_devices where tenant_id = $1 and branch_id = $2 and status = 'active' limit 1`, [T, B]))[0]?.checkin_slug;
const REC = (await q(`select id, email from users where tenant_id = $1 and email like 'rec.%' and status = 'active' order by created_at limit 1`, [T]))[0];
await c.query(`update users set password_hash = $1 where id = $2`, [await hashPassword(STAFF_PW), REC.id]);
const techs = (await q(`select id from technicians where tenant_id = $1 and branch_id = $2 and is_active and archived_at is null order by full_name limit 100`, [T, B])).map((r) => r.id);
const key = pinLookupKeyFromEnv({ AUTH_SESSION_SECRET: SECRET });
const pins = techs.map((_, i) => String(1000 + ((i + 1) * 7919) % 9000));
console.error(`salon ${SALON}: ${techs.length} technicians at the branch get a PIN; kiosk ${SLUG ? 'found' : 'MISSING'}`);
for (let i = 0; i < techs.length; i += 10) {
  await Promise.all(techs.slice(i, i + 10).map(async (id, k) => {
    const pin = pins[i + k]; const h = await PIN_HASH(pin);
    await c.query(`insert into technician_clock_pins (tenant_id, technician_id, pin_hash, pin_lookup, pin_lookup_kid, failed_attempts, locked_until, disabled_at)
                   values ($1, $2, $3, $4, $5, 0, null, null)
                   on conflict (tenant_id, technician_id) do update set pin_hash = excluded.pin_hash, pin_lookup = excluded.pin_lookup, pin_lookup_kid = excluded.pin_lookup_kid, failed_attempts = 0, locked_until = null, disabled_at = null`,
    [T, id, h, key.digest(T, pin), key.kid]);
  }));
}
// any other technician of the salon holding one of these PINs would make it ambiguous: disable theirs in this copy
await c.query(`update technician_clock_pins set disabled_at = now() where tenant_id = $1 and not (technician_id = any($2::uuid[]))`, [T, techs]);

async function reset(round) {
  await c.query('BEGIN');
  await c.query(`SET LOCAL session_replication_role = replica`);
  await c.query(`update technician_shifts set end_time = coalesce(end_time, start_time + interval '1 minute'), status = 'completed', shift_date = date '2026-09-01' where tenant_id = $1`, [T]);
  await c.query(`update technician_breaks set ended_at = coalesce(ended_at, started_at) where tenant_id = $1`, [T]).catch(() => undefined);
  await c.query(`update technician_workforce_state set clock_status = 'CLOCKED_OUT', shift_status = 'OFF_SHIFT', queue_status = 'OFF_SHIFT', service_state = 'IDLE', open_shift_id = null, break_started_at = null, current_ticket_id = null, version = version + 1 where tenant_id = $1`, [T]);
  await c.query(`update technician_turn_events set business_date = business_date - (3650 + $2::int) where tenant_id = $1 and business_date > date '2026-01-01'`, [T, round]);
  await c.query(`update technician_turn_state set business_date = business_date - (3650 + $2::int) where tenant_id = $1 and business_date > date '2026-01-01'`, [T, round]);
  await c.query(`update technician_statuses set status = 'off_shift' where tenant_id = $1`, [T]).catch(() => undefined);
  await c.query('COMMIT');
  await c.query(`ANALYZE technician_shifts; ANALYZE technician_turn_state; ANALYZE technician_turn_events; ANALYZE technician_workforce_state`);
}

const env = { ...process.env, REPO_DRIVER: 'postgres', DATABASE_URL: url(NAME), AUTH_SESSION_SECRET: SECRET, NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: process.env.BENCH_PUBLISHER ?? 'true',
  AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' };
for (const k of ['PAYMENTS_SANDBOX', 'CARDPOINTE_BASE_URL', 'PROCESS_ROLE', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SENDGRID_API_KEY']) delete env[k];
let errs = ''; let errBytes = 0;
const proc = spawn('node', ['dist/main.js'], { cwd: join(HERE, '..'), env, stdio: ['ignore', 'ignore', 'pipe'] });
proc.stderr.on('data', (d) => { errBytes += d.length; errs += d; if (errs.length > 200_000) errs = errs.slice(-100_000); });
let up = false; for (let i = 0; i < 480 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
if (!up) { console.error('API did not boot', errs.slice(-2000)); proc.kill(); process.exit(1); }

// the front desk (for GET /pos/queue/state)
const jar = new Map();
const call = (method, path, body) => fetch(API + path, { method, headers: { 'content-type': 'application/json', cookie: [...jar.values()].join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then((r) => { for (const ck of r.headers.getSetCookie?.() ?? []) { const kv = ck.split(';')[0]; jar.set(kv.split('=')[0], kv); } return j(r); });
const li = await call('POST', '/auth/login', { portal: 'tenant', salonCode: SALON, identifier: REC.email, password: STAFF_PW });
const sel = await call('POST', '/auth/select-branch', { branchId: B });
if (li.status >= 300 || sel.status >= 300) console.error('front desk sign-in', li.status, JSON.stringify(li.body).slice(0, 200), sel.status);

process.on('exit', () => { try { proc.kill('SIGTERM'); } catch { /* */ } });
process.on('uncaughtException', (e) => { console.error(e); try { proc.kill('SIGTERM'); } catch { /* */ } process.exit(1); });
// CPU seconds (user + system) used by the API process and by every postgres backend during the burst (Linux /proc)
const { readFileSync, readdirSync } = await import('node:fs');
const cpuTicks = () => { let api = 0, pgs = 0; for (const d of readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const st = readFileSync(`/proc/${d}/stat`, 'utf8'); const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')')); const f = st.slice(st.lastIndexOf(')') + 2).split(' '); const t = Number(f[11]) + Number(f[12]); if (Number(d) === proc.pid) api += t; else if (name.startsWith('postgres')) pgs += t; } catch { /* gone */ } } return { api: api / 100, pg: pgs / 100 }; };
const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  await reset(round + (Math.floor(Date.now() / 1000) % 20000) * 10);
  const ks = await j(await fetch(`${API}/go-check-in/${SLUG}/start-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  const KS = ks.body?.sessionId, KT = ks.body?.sessionToken;
  if (!KS) { console.error('kiosk session', ks.status, JSON.stringify(ks.body).slice(0, 300)); break; }
  const kiosk = (path, body) => fetch(`${API}/go-check-in/session/${KS}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-checkin-token': KT }, body: JSON.stringify(body) }).then(j);
  const eb0 = errBytes; const cpu0 = cpuTicks();
  const t0 = performance.now();
  const clk = await Promise.all(techs.map((_, k) => { const t = performance.now(); return kiosk('/technician/clock-in', { pin: pins[k], idempotencyKey: `bench-${round}-${k}-${Date.now()}` }).then((r) => ({ status: r.status, ms: performance.now() - t, body: r.body })); }));
  const wall = performance.now() - t0; const cpu1 = cpuTicks();
  const open = (await q(`select count(*)::int n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n;
  const joins = (await q(`select count(*)::int n from technician_turn_events where tenant_id = $1 and event_type = 'JOIN' and business_date > date '2026-01-01'`, [T]))[0].n;
  if (process.env.BENCH_PROF) { proc.kill('SIGUSR2'); await sleep(300); }   // a locally instrumented build dumps its timings (profiling only)
  const lat = clk.map((r) => r.ms);
  // 30 guests check in on the kiosk at once (the pilot's 11f), then the front desk opens the queue (the pilot's one sample)
  const svcs = (await q(`select id from services where tenant_id = $1 and (branch_id = $2 or branch_id is null) and status = 'active' and name not ilike '%add%' order by name limit 2`, [T, B])).map((r) => r.id);
  const wb = performance.now();
  const walks = await Promise.all(Array.from({ length: 30 }, (_, k) => kiosk('/check-in-walk-in', { customerName: `Bench Guest ${round}-${k}`, phone: `+1609558${String(round * 100 + k).padStart(4, '0')}`, serviceIds: [svcs[k % svcs.length]], addOnIds: [] })));
  const walkMs = Math.round(performance.now() - wb);
  const qs = [];
  const qsProfile = process.argv.includes('--qs-profile');   // pg_stat_statements over the queue-state samples only (needs the extension)
  if (qsProfile) await c.query('select pg_stat_statements_reset()');
  for (let i = 0; i < 5; i++) { const t = performance.now(); const r = await call('GET', '/pos/queue/state'); qs.push({ ms: performance.now() - t, status: r.status, bytes: JSON.stringify(r.body ?? '').length }); }
  if (qsProfile) {
    const top = await q(`select calls, round(total_exec_time::numeric, 1) as total_ms, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as query from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database()) order by total_exec_time desc limit 25`);
    console.error(top.map((r) => `${r.calls}\t${r.total_ms}\t${r.rows}\t${r.query}`).join('\n'));
    const n = await q(`select sum(calls)::int n, round(sum(total_exec_time)::numeric, 1) ms, sum(rows)::int r from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())`);
    console.error('queue state x5 — statements:', JSON.stringify(n[0]));
  }
  const row = { round, pinHash: arg('--pin-hash', 'pin'), ok: clk.filter((r) => r.status < 300).length, statuses: [...new Set(clk.map((r) => r.status))], wallMs: Math.round(wall), p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)), max: Math.round(Math.max(...lat)),
    openShifts: open, joins, apiLogBytes: errBytes - eb0, cpuSec: { api: +(cpu1.api - cpu0.api).toFixed(2), postgres: +(cpu1.pg - cpu0.pg).toFixed(2) }, walkIns: { ok: walks.filter((w) => w.status < 300).length, ms: walkMs, statuses: [...new Set(walks.map((w) => w.status))] }, queueState: { first: Math.round(qs[0].ms), p50: Math.round(pct(qs.map((x) => x.ms), 50)), max: Math.round(Math.max(...qs.map((x) => x.ms))), status: qs[0].status, bytes: qs[0].bytes } };
  if (row.ok < techs.length) row.firstError = clk.find((r) => r.status >= 300)?.body;
  results.push(row);
  console.log(JSON.stringify(row));
}
proc.kill('SIGTERM');
await sleep(500);
await c.end();
if (!process.argv.includes('--keep')) { const admin = new pg.Client({ connectionString: url('postgres') }); await admin.connect(); await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`); await admin.end(); }
