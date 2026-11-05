#!/usr/bin/env node
// live-refresh-authorization.mjs — Phase 1 of BUILD_PLAN_2026-10-06, proved on the real API and PostgreSQL.
// A manager signs in. While the session is open, the owner narrows the manager's role, then suspends the account.
// Before Oct 6 2026 /auth/refresh re-signed the old claims, so both changes waited until the session ended (12 h, or
// 30 days with "remember me"). Now each refresh carries what the account may do NOW, and a suspended account's
// session ends at its next refresh. Also proved here: the manager cannot change their OWN role.
// Run:  DATABASE_URL=postgres://… node scripts/live-refresh-authorization.mjs   (apps/api built). Never point it at
// production: it creates one proof user and removes it at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3047, API = `http://127.0.0.1:${API_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
const B = (await q(`select id from branches where tenant_id = $1 and status = 'active' order by created_at limit 1`, [T]))[0]?.id;
const U = randomUUID(), EMAIL = `refresh-proof-${String(Date.now()).slice(-6)}@pilotsalon.test`, PASSWORD = 'Refresh!Proof-' + randomUUID().slice(0, 8);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
         values ($1,$2,$3,'Rae','Refresh','Rae Refresh',$4,$5,'active','MANAGER',false)`, [U, T, B, EMAIL, await hashPassword(PASSWORD)]);

const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' };
let apiProc = null, apiErr = '';
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const cleanup = async () => {
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from login_attempts where identifier = $1`, [EMAIL]).catch(() => undefined);
  for (const t of ['staff_role_assignments', 'refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) {
    await q(`delete from ${t} where user_id = $1`, [U]).catch(() => undefined);
  }
  await q(`delete from users where id = $1`, [U]).catch(() => undefined);
  check('the proof user is removed', (await q(`select count(*)::int n from users where id = $1`, [U]))[0].n === 0);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 3 * 60_000);

const decode = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
// The token omits `permissions` when they are exactly the role's defaults (cookie size); the server re-derives them.
const permsOf = (token) => decode(token).permissions ?? 'ROLE_DEFAULTS';
try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  if (!check('API booted (health/ready)', await up(API + '/health/ready'), apiErr.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');

  // Native-style sign-in so the response carries the token pair (the web uses the same endpoint with cookies).
  const native = { 'content-type': 'application/json', 'x-client-type': 'native' };
  const loginR = await fetch(API + '/auth/login', { method: 'POST', headers: native, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const login = await loginR.json().catch(() => ({}));
  let access = login.accessToken ?? login.token, refreshTok = login.refreshToken;
  if (!check('the manager signs in (access + refresh token)', loginR.ok && !!access && !!refreshTok, `${loginR.status} ${JSON.stringify(login).slice(0, 160)}`)) throw new Error('no token pair');
  const before = permsOf(access);
  check('… as a full manager (the role defaults, which include checkout.process_payment)', before === 'ROLE_DEFAULTS' || before.includes('checkout.process_payment'), Array.isArray(before) ? `${before.length} permissions` : before);

  const refresh = async () => {
    const r = await fetch(API + '/auth/refresh', { method: 'POST', headers: { ...native, authorization: `Bearer ${access}` }, body: JSON.stringify({ refreshToken: refreshTok }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) { access = b.accessToken; refreshTok = b.refreshToken; }
    return { status: r.status, body: b };
  };

  // The manager tries to change their own role (a narrowed manager's way back to full rights).
  // (Phase 9: the one role-change route is PUT /pos/access/members/:userId/role; the old staff-roles assignment route was retired)
  const self = await fetch(API + `/pos/access/members/${U}/role`, { method: 'PUT', headers: { ...native, authorization: `Bearer ${access}` }, body: JSON.stringify({ templateKey: 'GENERAL_MANAGER', reason: 'trying to widen my own role' }) });
  check('the manager cannot change their OWN role (403)', self.status === 403, String(self.status));

  // The owner narrows the manager to the Accountant role while the session is open.
  await q(`insert into staff_role_assignments (tenant_id, user_id, template_key, assigned_by) values ($1,$2,'ACCOUNTANT',$2)
           on conflict (tenant_id, user_id) do update set template_key = excluded.template_key`, [T, U]);
  const r1 = await refresh();
  const after = r1.status === 200 && Array.isArray(permsOf(access)) ? permsOf(access) : [];
  check('the next refresh succeeds and carries the NARROWED role (no checkout.process_payment)', r1.status === 200 && !after.includes('checkout.process_payment') && after.includes('reports.view'), `${r1.status} ${after.length} permissions`);
  // Taking a cash payment needs checkout.process_payment — refused by the permission guard before any ticket lookup.
  const pay = await fetch(API + `/pos/checkout/tickets/${randomUUID()}/pay/cash`, { method: 'POST', headers: { ...native, authorization: `Bearer ${access}`, 'idempotency-key': 'refresh-proof-' + randomUUID() }, body: JSON.stringify({ amountReceivedCents: 100 }) });
  const payBody = await pay.text().catch(() => '');
  check('… and taking a payment is now refused for this session (403)', pay.status === 403, String(pay.status) + ' ' + payBody.slice(0, 200));

  // The owner suspends the account.
  await q(`update users set status = 'suspended' where id = $1`, [U]);
  const r2 = await refresh();
  check('a suspended account: the next refresh ends the session (401 SESSION_ENDED)', r2.status === 401 && r2.body?.code === 'SESSION_ENDED' && r2.body?.reason === 'account_inactive', `${r2.status} ${JSON.stringify(r2.body)}`);
  const sess = (await q(`select count(*)::int n from refresh_tokens where user_id = $1 and revoked_at is null`, [U]))[0].n;
  check('… and every refresh token of that session is revoked', sess === 0, `${sess} live`);
  // The event is written fire-and-forget after the 401 goes out (the log never blocks the action) — wait for it, up to 3 s.
  let ev = 0;
  for (let i = 0; i < 30 && ev === 0; i++) { ev = (await q(`select count(*)::int n from auth_events where user_id = $1 and event_type = 'SESSION_ENDED_ACCESS_CHANGED'`, [U]))[0].n; if (ev === 0) await new Promise((r) => setTimeout(r, 100)); }
  check('… recorded in the sign-in activity log', ev === 1, String(ev));
} catch (e) {
  check('proof ran to the end', false, String(e?.message || e));
} finally {
  clearTimeout(timer);
  await cleanup();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
