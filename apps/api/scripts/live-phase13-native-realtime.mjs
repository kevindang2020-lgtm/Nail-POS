#!/usr/bin/env node
// live-phase13-native-realtime.mjs — BUILD_PLAN Phase 13 (Constitution 6 §28–32, audit bug 1): NATIVE realtime, proved on
// the real API and PostgreSQL. Nothing is stubbed. The technician behaves exactly like the Capacitor app:
//   1. signs in with the NATIVE token flow — no Origin header (what the shell's HTTP client sends), so the server returns
//      the bearer; every later call carries `Authorization: Bearer` and NO cookie, plus the transport's client headers;
//   2. POST /api/v1/realtime/stream-ticket (bearer) → { ticket, expiresIn: 60 };
//   3. opens GET /api/v1/tech/stream?ticket=…&device=… with NO cookie and NO Authorization → 200 text/event-stream,
//      first frame `connected`;
//   4. a manager (web, cookie) checks a walk-in into the same branch → the technician's stream receives the event;
//   5. the SAME ticket again → 401 (single use); a ticket for the tech realm on /customer/stream → 401; a garbage ticket
//      → 401; no ticket and no credential → 401;
//   6. the technician signs out (bearer) → the open stream ends (session revoked → the stream's revocation check) and a
//      new ticket is refused;
//   7. the request context recorded the client labels (access log line has clientApp=tech);
//   8. cleanup: the proof branch, people, sessions and tickets.
// Run:  DATABASE_URL=postgres://… node scripts/live-phase13-native-realtime.mjs   (apps/api built). Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3063, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (x) => JSON.stringify(x ?? null).slice(0, 200);

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase13 RT Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id).catch(() => undefined);

const tag = String(Date.now()).slice(-6);
const PW = 'Phase13!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const BA = randomUUID(), TECHU = randomUUID(), MGR = randomUUID(), TECH = randomUUID(), CAT = randomUUID(), SVC = randomUUID();
const DEVICE = 'dev' + randomUUID().replace(/-/g, '');
const email = (k) => `phase13-${k}-${tag}@aipowersalon.test`;
const people = [TECHU, MGR];

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1, $2, $3, 'active', 'America/New_York', '13 Proof Way')`, [BA, TA, `Live Phase13 RT Proof ${tag}`]);
const addUser = async (id, role, key, level) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'P13','Thirteen','P13 Thirteen',$4,$5,'active',$6)`, [id, TA, BA, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [TA, BA, id, level]);
};
await addUser(TECHU, 'TECHNICIAN', 'tech', 'staff');
await addUser(MGR, 'MANAGER', 'mgr', 'manager');
await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1, $2, $3, $4, 'Tia', 'P13', $5, 'active')`, [TECH, TA, BA, TECHU, `Tia P13${tag}`]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1, $2, $3, 'P13 Nails')`, [CAT, TA, BA]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1, $2, $3, $4, 'P13 Manicure', 30, 2500)`, [SVC, TA, BA, CAT]);

const baseEnv = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true', LOG_LEVEL: 'info' };
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'WORKER_JOB_CLASSES']) delete baseEnv[k];
Object.assign(baseEnv, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' });
let api = null; let errs = '', outs = '';

const cleanup = async () => {
  try { api?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  await q(`delete from realtime_stream_tickets where user_id = any($1::text[])`, [people]).catch(() => undefined);
  for (const u of people) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'authorization_denials']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [['tech', 'mgr'].map(email)]).catch(() => undefined);
  const a = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [people]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from branches where id = $2)
      + (select count(*)::int from realtime_stream_tickets where user_id = any($3::text[])) as n`, [people, BA, people]))[0].n;
  check('cleanup: the proof branch, its people, their sessions and stream tickets are gone', a.removed && left === 0, `branch ${a.removed} [${(a.kept ?? []).join(', ')}] left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 5 * 60_000);

// The headers the ONE mobile transport sends (packages/mobile-sdk/src/network/transport.ts) — and no Origin, no cookie.
const nativeHeaders = (token) => ({ 'X-Client-Type': 'tech', 'X-Client-Version': '1.4.0', 'X-Client-Platform': 'ios', 'X-Device-ID': DEVICE, 'X-Request-ID': 'cli_' + randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) });
const nat = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { ...nativeHeaders(token), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, setCookie: r.headers.getSetCookie?.() ?? [] };
};
/** Open an SSE stream with fetch (exactly what EventSource does: a GET, no Authorization) and collect frames. */
function openStream(url, headers = {}) {
  const ac = new AbortController(); const frames = []; const s = { status: 0, frames, ended: false, ac, contentType: '' };
  s.ready = fetch(url, { headers: { accept: 'text/event-stream', ...headers }, signal: ac.signal }).then(async (r) => {
    s.status = r.status; s.contentType = r.headers.get('content-type') || '';
    if (!r.ok || !r.body) { try { s.body = await r.json(); } catch { /* */ } s.ended = true; return; }
    (async () => {
      const dec = new TextDecoder(); let buf = '';
      try { for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join(''); if (data) { try { frames.push(JSON.parse(data)); } catch { /* */ } } } } }
      catch { /* aborted */ }
      s.ended = true;
    })();
  }).catch(() => { s.ended = true; });
  return s;
}
const waitFor = async (pred, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(150); } return pred(); };

try {
  api = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...baseEnv, PORT: String(PORT), PROCESS_ROLE: 'all' }, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stderr.on('data', (c) => { errs += c; }); api.stdout.on('data', (c) => { outs += c; });
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // 1. native sign-in: no Origin, bearer back, no cookie used afterwards
  const login = await nat('POST', '/api/v1/auth/login', null, { portal: 'tenant', salonCode: SALON, identifier: email('tech'), password: PW, device: { id: DEVICE, name: 'iPhone · Tech app', platform: 'ios' } });
  let token = login.body?.accessToken || login.body?.token;
  if (token && login.body?.principal?.needsBranchSelection) {
    const sel = await nat('POST', '/api/v1/auth/select-branch', token, { branchId: BA });
    token = sel.body?.accessToken || sel.body?.token || token;
  }
  check('1. the technician signs in with the NATIVE flow (no Origin) and receives a bearer token', login.status === 200 && typeof token === 'string' && token.length > 20, `login ${login.status} ${short({ outcome: login.body?.outcome })}`);
  const me = await nat('GET', '/api/v1/auth/me', token);
  check('   …and the bearer alone (no cookie) authenticates: /auth/me is the technician in the proof branch', me.status === 200 && me.body?.userId === TECHU && me.body?.branchId === BA, `me ${me.status} ${short({ role: me.body?.role, branch: me.body?.branchId === BA })}`);

  // 2. ticket
  const t1 = await nat('POST', '/api/v1/realtime/stream-ticket', token);
  check('2. POST /api/v1/realtime/stream-ticket (bearer) → { ticket, expiresIn: 60 }', t1.status === 200 && typeof t1.body?.ticket === 'string' && t1.body?.expiresIn === 60, `${t1.status} expiresIn=${t1.body?.expiresIn}`);
  const row = (await q(`select realm, tenant_id, branch_id, device_id, used_at from realtime_stream_tickets where user_id = $1 order by created_at desc limit 1`, [TECHU]))[0];
  check('   the row is bound to realm tenant + the salon + the branch + this device, unused, and holds no ticket text', row?.realm === 'tenant' && row?.tenant_id === TA && row?.branch_id === BA && row?.device_id === DEVICE && row?.used_at === null,
    short(row && { ...row, tenant_id: row.tenant_id === TA, branch_id: row.branch_id === BA }));

  // 3. open the stream with ?ticket= — NO cookie, NO Authorization
  const streamUrl = `${API}/api/v1/tech/stream?ticket=${encodeURIComponent(t1.body.ticket)}&device=${DEVICE}`;
  const s1 = openStream(streamUrl, { origin: 'capacitor://localhost' });
  await s1.ready;
  const connected = await waitFor(() => s1.frames.some((f) => f.event === 'connected'), 8000);
  check('3. GET /api/v1/tech/stream?ticket=… with no cookie and no Authorization → 200 text/event-stream, first frame "connected"', s1.status === 200 && /text\/event-stream/.test(s1.contentType) && connected, `status ${s1.status} frames ${short(s1.frames.map((f) => f.event))}`);

  // 4. a real event reaches the native stream: a manager (web session, cookie) checks a walk-in into the same branch
  const ml = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email('mgr'), password: PW }) });
  const jar = new Map(); for (const c of ml.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); }
  const cookie = () => [...jar.values()].join('; ');
  const sel = await fetch(API + '/api/v1/auth/select-branch', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(), origin: 'http://localhost:5173' }, body: JSON.stringify({ branchId: BA }) });
  for (const c of sel.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); }
  const before = s1.frames.length;
  const walk = await fetch(API + '/api/v1/pos/check-in/walk-in', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(), origin: 'http://localhost:5173' }, body: JSON.stringify({ customerName: `P13 Walkin ${tag}`, customerPhone: '2155550' + tag.slice(-3), isNewCustomer: true, serviceIds: [SVC] }) });
  const walkBody = await walk.json().catch(() => null);
  const got = await waitFor(() => s1.frames.slice(before).some((f) => f.event && !['ping', 'presence_registered', 'connected'].includes(f.event)), 10_000);
  const evs = s1.frames.slice(before).map((f) => f.event);
  check('4. a manager checks a walk-in into the branch → the native stream receives the event', walk.status < 300 && got, `walk-in ${walk.status} ${walk.status >= 300 ? short(walkBody) : ''} events ${short(evs)}`);
  check('   the tech frame is event-only (no payload — §22 minimization)', s1.frames.slice(before).filter((f) => f.event && f.event !== 'ping').every((f) => f.payload === undefined), short(s1.frames.slice(before)[0]));

  // 5. single use, realm binding, garbage, no credential
  const reuse = openStream(streamUrl); await reuse.ready;
  check('5. the SAME ticket again → 401 (single use)', reuse.status === 401, `status ${reuse.status} ${short(reuse.body)}`);
  const t2 = await nat('POST', '/api/v1/realtime/stream-ticket', token);
  const wrong = openStream(`${API}/api/v1/customer/stream?ticket=${encodeURIComponent(t2.body?.ticket)}&device=${DEVICE}`); await wrong.ready;
  check('   a technician (tenant realm) ticket on /customer/stream → 401', wrong.status === 401, `status ${wrong.status}`);
  const t3 = await nat('POST', '/api/v1/realtime/stream-ticket', token);
  const otherDev = openStream(`${API}/api/v1/tech/stream?ticket=${encodeURIComponent(t3.body?.ticket)}&device=devffffffffffffffffffffffffffffffff`); await otherDev.ready;
  check('   a ticket presented from another device → 401', otherDev.status === 401, `status ${otherDev.status}`);
  const garbage = openStream(`${API}/api/v1/tech/stream?ticket=${'x'.repeat(43)}`); await garbage.ready;
  const none = openStream(`${API}/api/v1/tech/stream`); await none.ready;
  check('   a garbage ticket → 401; no ticket and no credential → 401', garbage.status === 401 && none.status === 401, `garbage ${garbage.status} none ${none.status}`);
  const tokenInUrl = /authorization|bearer|eyJ/i.test(streamUrl.replace(API, ''));
  check('   the stream URL carries no bearer token (only the single-use ticket and the device id)', !tokenInUrl, streamUrl.replace(API, '').replace(/ticket=[^&]+/, 'ticket=…'));

  // 6. logout closes it
  const t4 = await nat('POST', '/api/v1/realtime/stream-ticket', token);
  const out = await nat('POST', '/api/v1/auth/logout', token, {});
  const ended = await waitFor(() => s1.ended, 40_000);
  check('6. the technician signs out (bearer) → the open native stream is closed by the server (revoked session)', out.status < 300 && ended, `logout ${out.status} ended ${ended}`);
  const t5 = await nat('POST', '/api/v1/realtime/stream-ticket', token);
  const late = openStream(`${API}/api/v1/tech/stream?ticket=${encodeURIComponent(t4.body?.ticket)}&device=${DEVICE}`); await late.ready;
  check('   after sign-out no new ticket is issued, and a ticket minted before sign-out opens nothing', t5.status === 401 && late.status === 401, `new ticket ${t5.status}; pre-logout ticket ${late.status}`);

  // 7. the client labels in the access log
  const lines = (outs + errs).split('\n').filter((l) => l.includes('request.completed') && l.includes('stream-ticket'));
  const labelled = lines.some((l) => /"clientApp":"tech"/.test(l) && /"clientPlatform":"ios"/.test(l) && /"clientVersion":"1\.4\.0"/.test(l));
  const leaked = (outs + errs).includes(DEVICE);
  check('7. the access log line names the client (app / version / platform) and never the device id', labelled && !leaked, `${lines.length} lines, labelled ${labelled}, device id in logs ${leaked}`);
  for (const s of [s1, reuse, wrong, otherDev, garbage, none, late]) { try { s.ac.abort(); } catch { /* */ } }
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 300));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e)));
  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
