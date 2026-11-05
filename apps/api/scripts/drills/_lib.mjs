// _lib.mjs — shared plumbing for the disaster-recovery drills (Constitution 4 §99–101, §147–151; BUILD_PLAN Phase 11).
//
// Every drill: prints one PASS/FAIL line per check, ends with ONE result line (`DRILL <name>: PASS|FAIL …`), exits 0 only
// when every check passed, and cleans up everything it started — child processes by the PID it holds (never a pattern
// kill), scratch databases by name — on success, on failure, on a timeout and on Ctrl-C.
//
// Local only by default: the drills kill processes and (db-failover) restart PostgreSQL. A database URL that is not on
// this machine is refused unless DRILL_ALLOW_REMOTE=1 — and even then never point one at production.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const require = createRequire(import.meta.url);
export const pg = require('pg');
export const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // apps/api
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The source database the drill works against (default: the local development database). */
export function sourceDbUrl() {
  const url = process.env.DRILL_DATABASE_URL || process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/postgres';
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', ''].includes(host) && process.env.DRILL_ALLOW_REMOTE !== '1') {
    console.error(`refusing: ${host} is not this machine (set DRILL_ALLOW_REMOTE=1 for a scratch server — never production)`);
    process.exit(2);
  }
  return url;
}
/** The same server, another database name. */
export function withDb(url, name) { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); }

export function startDrill(name, { timeoutMs = 10 * 60_000 } = {}) {
  const t0 = Date.now();
  const lines = []; let failed = 0, total = 0;
  const cleanups = [];
  let finished = false;
  const check = (label, ok, detail = '') => {
    total++; if (!ok) failed++;
    const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`;
    lines.push(line); console.log(line);
    return !!ok;
  };
  const note = (msg) => console.log(`      ${msg}`);
  const onCleanup = (fn) => { cleanups.unshift(fn); };
  const runCleanups = async () => {
    for (const fn of cleanups.splice(0)) { try { await fn(); } catch (e) { console.log(`      cleanup step failed: ${e?.message ?? e}`); } }
  };
  const finish = async (extra = '') => {
    if (finished) return; finished = true;
    clearTimeout(timer);
    await runCleanups();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const verdict = failed === 0 && total > 0 ? 'PASS' : 'FAIL';
    console.log(`DRILL ${name}: ${verdict} (${total - failed}/${total} checks, ${secs}s)${extra ? ' — ' + extra : ''}`);
    process.exit(verdict === 'PASS' ? 0 : 1);
  };
  const abort = async (why) => { check(`drill completed (${why})`, false); await finish(); };
  const timer = setTimeout(() => { void abort(`timed out after ${timeoutMs / 1000}s`); }, timeoutMs);
  process.on('SIGINT', () => { void abort('interrupted'); });
  process.on('SIGTERM', () => { void abort('terminated'); });
  process.on('unhandledRejection', (e) => { void abort(`unhandled: ${String(e?.message ?? e).slice(0, 160)}`); });
  console.log(`== drill ${name} — ${new Date().toISOString()}`);
  return { check, note, onCleanup, finish, abort, elapsed: () => Date.now() - t0 };
}

/** A child process the drill owns. stop() signals ITS pid (never a pattern), escalates to SIGKILL, and waits for exit. */
export function spawnOwned(drill, label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const out = { text: '' };
  const keep = (c) => { out.text += c; if (out.text.length > 200_000) out.text = out.text.slice(-100_000); };
  child.stdout?.on('data', keep); child.stderr?.on('data', keep);
  let exited = null;
  const exitedP = new Promise((r) => child.on('exit', (code, signal) => { exited = { code, signal }; r(exited); }));
  const h = {
    label, pid: child.pid, child, out,
    alive: () => exited === null,
    exitInfo: () => exited,
    waitExit: (ms) => Promise.race([exitedP, sleep(ms).then(() => null)]),
    async stop(signal = 'SIGTERM', graceMs = 8_000) {
      if (exited) return exited;
      try { process.kill(child.pid, signal); } catch { /* already gone */ }
      const r = await h.waitExit(graceMs);
      if (r) return r;
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
      return h.waitExit(5_000);
    },
  };
  drill.onCleanup(async () => { if (h.alive()) await h.stop(); });
  return h;
}

/** Environment for a locally booted API/worker: the built dist, Postgres repositories, a throwaway session secret
 *  generated for this run (never a real credential), no SMS/email provider. */
export function apiEnv(dbUrl, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(TWILIO_|SENDGRID_|SMTP_|OPENAI_|ANTHROPIC_|CARDPOINTE_|CLOVER_|OTEL_|REDIS_URL|CACHE_|RATE_LIMIT_|LOGIN_THROTTLE_|REALTIME_REDIS|PROCESS_ROLE|WORKER_JOB_CLASSES|JOBS_)/.test(k)) delete env[k];
  }
  return {
    ...env,
    DATABASE_URL: dbUrl, REPO_DRIVER: 'postgres', NODE_ENV: 'development',
    AUTH_SESSION_SECRET: `drill-${randomBytes(24).toString('hex')}`,
    ...extra,
  };
}

/** GET/POST with a hard client-side deadline. Returns { status, ms, body?, error? } — never throws. */
export async function timed(url, { timeoutMs = 15_000, ...init } = {}) {
  const t = Date.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, ms: Date.now() - t, body, headers: r.headers };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: ac.signal.aborted ? `no answer within ${timeoutMs} ms` : String(e?.cause?.code ?? e?.message ?? e) };
  } finally { clearTimeout(to); }
}

export async function waitFor(fn, { timeoutMs = 60_000, stepMs = 250 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(stepMs); }
  return null;
}

/** Boot dist/main.js (or worker.js) and wait for it. */
export async function bootApi(drill, { label, env, port, entry = 'dist/main.js', readyPath = '/health/ready', timeoutMs = 90_000 }) {
  const h = spawnOwned(drill, label, 'node', [entry], { cwd: API_DIR, env: { ...env, ...(port ? { PORT: String(port) } : {}) } });
  if (!port) return h;
  const ok = await waitFor(async () => (await timed(`http://127.0.0.1:${port}${readyPath}`, { timeoutMs: 3_000 })).status === 200 || !h.alive(), { timeoutMs });
  h.booted = !!ok && h.alive();
  return h;
}

/** A scratch database on the same server, dropped by the drill's cleanup. */
export async function createScratchDb(drill, adminUrl, name) {
  if (!/^drill_[a-z0-9_]+$/.test(name)) throw new Error(`scratch database names start with drill_ (got ${name})`);
  const c = new pg.Client({ connectionString: adminUrl }); await c.connect();
  try {
    await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
    await c.query(`drop database if exists ${name}`);
    await c.query(`create database ${name}`);
  } finally { await c.end(); }
  drill.onCleanup(async () => {
    const d = new pg.Client({ connectionString: adminUrl }); await d.connect();
    try {
      await d.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
      await d.query(`drop database if exists ${name}`);
      const left = (await d.query(`select count(*)::int n from pg_database where datname = $1`, [name])).rows[0].n;
      console.log(`      cleanup: scratch database ${name} ${left === 0 ? 'dropped' : 'STILL PRESENT'}`);
    } finally { await d.end(); }
  });
  return withDb(adminUrl, name);
}

/** Run a command to completion (no shell). */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; }); p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

export const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
