#!/usr/bin/env node
// live-pos-autolock.mjs — Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a
// full sign-in after 8 hours locked." Proved on the real API and PostgreSQL, with NO browser: a POS session (signed in with
// X-Client-Type: pos) that nobody used for the salon's 60 minutes is locked BY THE SERVER — every call answers 423 except the
// unlock paths, from any tab or a direct API call; a wrong PIN is refused and audited; the right PIN unlocks; a session locked
// more than 8 hours is ended (401 → full sign-in); five wrong PINs end the session; a session that is NOT a POS session (the
// apps, scripts) is never idle-locked.
// The clock: no real 60-minute wait. Time is moved by rewinding the session row's own clock columns (last_activity_at /
// locked_at) — the same thing as the server's clock moving forward — then waiting out the session store's 15-second cache.
// Run:  DATABASE_URL=postgres://… node scripts/live-pos-autolock.mjs   (apps/api built, migration 570 applied). Never point it
// at production: it creates one proof user and removes it (and its sessions / events) at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3049, API = `http://127.0.0.1:${API_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const CACHE_WAIT_MS = 16_000;   // KyselySessionStore caches a session's row for 15 s
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
const hasCols = (await q(`select count(*)::int n from information_schema.columns where table_name = 'sessions' and column_name in ('client_app','last_activity_at','pin_failures')`))[0].n === 3;
if (!hasCols) { console.error('migration 570 is not applied to this database'); process.exit(2); }
const B = (await q(`select id from branches where tenant_id = $1 and status = 'active' order by created_at limit 1`, [T]))[0]?.id;
const U = randomUUID(), EMAIL = `autolock-proof-${String(Date.now()).slice(-6)}@pilotsalon.test`, PASSWORD = 'Autolock!Proof-' + randomUUID().slice(0, 8), PIN = '4826';
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, pin_hash, status, role, mfa_enabled)
         values ($1,$2,$3,'Lena','Lock','Lena Lock',$4,$5,$6,'active','MANAGER',false)`, [U, T, B, EMAIL, await hashPassword(PASSWORD), await hashPassword(PIN)]);

const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' };
let apiProc = null, apiErr = '';
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const cleanup = async () => {
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from login_attempts where identifier = $1`, [EMAIL]).catch(() => undefined);
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [U]).catch(() => undefined);
  await q(`delete from users where id = $1`, [U]).catch(() => undefined);
  check('the proof user, its sessions and events are removed', (await q(`select count(*)::int n from users where id = $1`, [U]))[0].n === 0);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 4 * 60_000);

// A browser-style sign-in (httpOnly cookies, like the POS). Returns a caller bound to that session's cookies.
const signIn = async (clientType) => {
  const headers = { 'content-type': 'application/json', ...(clientType ? { 'x-client-type': clientType } : {}) };
  const r = await fetch(API + '/auth/login', { method: 'POST', headers, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const body = await r.json().catch(() => ({}));
  const sid = (await q(`select id from sessions where user_id = $1 order by created_at desc limit 1`, [U]))[0]?.id;
  const call = async (method, path, b, extra = {}) => {
    const res = await fetch(API + path, { method, headers: { cookie: cookies, ...(b ? { 'content-type': 'application/json' } : {}), ...(clientType ? { 'x-client-type': clientType } : {}), ...extra }, body: b ? JSON.stringify(b) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { ok: r.ok && body?.outcome === 'SUCCESS', status: r.status, sid, call };
};
const row = async (sid) => (await q(`select client_app, status, locked_at, last_activity_at, pin_failures from sessions where id = $1`, [sid]))[0];
const READ = '/pos/settings/security';   // any staff route (MANAGER has settings.view)

try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  if (!check('API booted (health/ready)', await up(API + '/health/ready'), apiErr.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');

  // 1 — a POS sign-in is a POS device session with an activity clock; the salon default is on, 60 minutes
  const pos = await signIn('pos');
  if (!check('the POS signs in (X-Client-Type: pos)', pos.ok && !!pos.sid, String(pos.status))) throw new Error('no POS session');
  const r0 = await row(pos.sid);
  check('… stored as a POS session with its activity clock started', r0.client_app === 'pos' && !!r0.last_activity_at && !r0.locked_at, JSON.stringify(r0));
  const st0 = await pos.call('GET', '/auth/lock-status');
  check('lock status: POS session, salon auto-lock ON at 60 minutes, unlocked', st0.status === 200 && st0.body?.posSession === true && st0.body?.salon?.enabled === true && st0.body?.salon?.minutes === 60 && st0.body?.locked === false, JSON.stringify(st0.body));
  check('an ordinary call works', (await pos.call('GET', READ)).status === 200);
  const act = await pos.call('POST', '/auth/session-activity');
  check('the activity report is accepted', act.status === 200 && act.body?.ok === true, JSON.stringify(act.body));

  // 2 — 61 idle minutes later (the clock moved; nobody touched the screen — reads and polling never count)
  await q(`update sessions set last_activity_at = now() - interval '61 minutes' where id = $1`, [pos.sid]);
  const idleSince = new Date((await row(pos.sid)).last_activity_at).getTime();
  await sleep(CACHE_WAIT_MS);
  const l1 = await pos.call('GET', READ);
  check('after 60 idle minutes the SERVER answers 423 SESSION_LOCKED — no browser involved', l1.status === 423 && l1.body?.code === 'SESSION_LOCKED', `${l1.status} ${JSON.stringify(l1.body)}`);
  check('… locked AT last activity + 60 minutes (the 8 hours run from there)', Date.parse(l1.body?.lockedAt) === idleSince + 60 * 60_000, `${l1.body?.lockedAt} vs ${new Date(idleSince + 3_600_000).toISOString()}`);
  const r1 = await row(pos.sid);
  check('… and the lock is on the session row (every API server sees it)', !!r1.locked_at && new Date(r1.locked_at).getTime() === idleSince + 60 * 60_000, String(r1.locked_at));
  const noHeader = await pos.call('GET', READ, undefined, { 'x-client-type': '' });
  check('a direct API call with the same cookie but no client header is locked too', noHeader.status === 423, String(noHeader.status));
  check('activity cannot unlock it (POST /auth/session-activity → 423)', (await pos.call('POST', '/auth/session-activity')).status === 423);
  const st1 = await pos.call('GET', '/auth/lock-status');
  check('the lock status is readable while locked, with the full-sign-in time', st1.status === 200 && st1.body?.locked === true && Date.parse(st1.body?.fullSignInAt) === idleSince + 60 * 60_000 + 8 * 3_600_000, JSON.stringify(st1.body));

  // 3 — the PIN
  const wrong = await pos.call('POST', '/auth/verify-pin', { pin: '0000' });
  check('a wrong PIN is refused (403) and the session stays locked', wrong.status === 403 && (await pos.call('GET', READ)).status === 423, String(wrong.status));
  let ev = 0;
  for (let i = 0; i < 30 && ev === 0; i++) { ev = (await q(`select count(*)::int n from auth_events where session_id = $1 and event_type = 'PIN_UNLOCK_FAILED'`, [pos.sid]))[0].n; if (!ev) await sleep(100); }
  check('… and audited (auth_events PIN_UNLOCK_FAILED)', ev === 1, String(ev));
  const right = await pos.call('POST', '/auth/verify-pin', { pin: PIN });
  check('the right PIN unlocks (200)', right.status === 200 && right.body?.success === true, JSON.stringify(right.body));
  check('… calls work again', (await pos.call('GET', READ)).status === 200);
  const r2 = await row(pos.sid);
  check('… the idle clock restarted and the wrong-PIN count reset', !r2.locked_at && Date.now() - new Date(r2.last_activity_at).getTime() < 60_000 && r2.pin_failures === 0, JSON.stringify(r2));

  // 4 — locked for more than 8 hours → the session ends
  await q(`update sessions set locked_at = now() - interval '8 hours 1 minute' where id = $1`, [pos.sid]);
  await sleep(CACHE_WAIT_MS);
  const exp = await pos.call('GET', READ);
  check('locked more than 8 hours: 401 SESSION_LOCK_EXPIRED (full sign-in)', exp.status === 401 && exp.body?.code === 'SESSION_LOCK_EXPIRED', `${exp.status} ${JSON.stringify(exp.body)}`);
  check('… the session is revoked on the row', (await row(pos.sid)).status === 'revoked');
  check('… and the PIN cannot bring it back (401)', (await pos.call('POST', '/auth/verify-pin', { pin: PIN })).status === 401);

  // 5 — five wrong PINs end the session (holds without Redis)
  const pos2 = await signIn('pos');
  let last = null;
  for (let i = 0; i < 5; i++) last = await pos2.call('POST', '/auth/verify-pin', { pin: '1111' });
  check('the 5th wrong PIN ends the session (429 too_many_attempts, row revoked)', last?.status === 429 && last?.body?.code === 'too_many_attempts' && (await row(pos2.sid)).status === 'revoked', `${last?.status} ${JSON.stringify(last?.body)}`);
  check('… and its next call is refused (401)', (await pos2.call('GET', READ)).status === 401);

  // 6 — not a POS session: never idle-locked (the apps, scripts, the other live proofs)
  for (const ct of ['native', null]) {
    const other = await signIn(ct);
    const ro = await row(other.sid);
    await q(`update sessions set last_activity_at = now() - interval '10 hours' where id = $1`, [other.sid]);
    const r = await other.call('GET', READ);
    check(`a ${ct ?? 'no-header'} sign-in is not a POS session and is never idle-locked`, other.ok && ro.client_app === null && r.status === 200, `${ro.client_app} ${r.status}`);
  }
} catch (e) {
  check('proof ran to the end', false, String(e?.message || e));
} finally {
  clearTimeout(timer);
  await cleanup();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
