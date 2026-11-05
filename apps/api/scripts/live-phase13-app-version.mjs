#!/usr/bin/env node
// live-phase13-app-version.mjs — BUILD_PLAN Phase 13 B (Constitution 6 §55–57, §219) proved on the real API and PostgreSQL:
// the UPDATE_REQUIRED gate through the real Nest pipeline (the /api/v1 rewrite, the middleware order, the session
// middleware's exclude list) and the public GET /app-config.
//
//   1. With NO policy row an ancient native build is not refused (nothing configured → nothing refused).
//   2. A policy row (tech / ios, min 1.5.0) → a native 1.4.0 build gets 426 UPDATE_REQUIRED with the store link on a
//      tech route; 1.5.0 passes the gate (then meets the session check, 401).
//   3. The same old build is NOT refused on: sign-in, refresh, health, /app-config; nor is the web platform, a request
//      without client headers, or the kiosk / display ids.
//   4. GET /api/v1/app-config with no session answers 200: UPDATE_REQUIRED + store link for the old build, SUPPORTED for web.
//   5. The installs seen land hashed in mobile_app_installs_seen.
// Run:  DATABASE_URL=postgres://… node scripts/live-phase13-app-version.mjs   (apps/api built; migration 558 applied).
// Never point it at production: it writes then restores the tech/ios version row.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3061, API = `http://127.0.0.1:${PORT}`;
const STORE = 'https://apps.apple.com/app/id0000000000';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const before = (await q(`select * from mobile_app_versions where app = 'tech' and platform = 'ios'`))[0] ?? null;
await q(`delete from mobile_app_versions where app = 'tech' and platform = 'ios'`);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT) };
for (const k of ['PROCESS_ROLE', 'JOBS_WORKER', 'MAINTENANCE_BREAK_GLASS']) delete env[k];
const proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
let errs = ''; proc.stderr.on('data', (d) => { errs += d; });
const restore = async () => {
  try { proc.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from mobile_app_versions where app = 'tech' and platform = 'ios'`);
  if (before) await q(`insert into mobile_app_versions (app, platform, min_supported, recommended, latest, store_url, message, reason, version, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [before.app, before.platform, before.min_supported, before.recommended, before.latest, before.store_url, before.message, before.reason, before.version, before.updated_by]);
  await q(`delete from mobile_app_installs_seen where device_hash in (select encode(sha256(convert_to(x, 'UTF8')), 'hex') from unnest($1::text[]) x)`, [DEVICES]);
  await client.end();
};
const DEVICES = ['live-p13-device-old-0001', 'live-p13-device-new-0002'];
const nat = (v, dev = DEVICES[0], platform = 'ios', app = 'tech') => ({ 'x-client-type': app, 'x-client-version': v, 'x-client-platform': platform, 'x-device-id': dev, 'content-type': 'application/json' });
const call = async (path, headers = {}, method = 'GET', body) => { const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b }; };

try {
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { try { ok = (await fetch(API + '/health/live')).ok; } catch { /* booting */ } if (!ok) await sleep(250); }
  if (!check('API boots', ok, ok ? '' : errs.slice(-400))) throw new Error('boot');

  const none = await call('/api/v1/tech/queue', nat('0.0.1'));
  check('no policy row: an ancient native build is not refused', none.status !== 426, `status ${none.status}`);

  await q(`insert into mobile_app_versions (app, platform, min_supported, recommended, latest, store_url, reason) values ('tech','ios','1.5.0','1.6.0','1.7.0',$1,'live phase 13 proof row')`, [STORE]);
  await sleep(31_000);   // the policy cache TTL (30 s)

  const old = await call('/api/v1/tech/queue', nat('1.4.0'));
  check('min 1.5.0: native 1.4.0 gets 426 UPDATE_REQUIRED with the store link', old.status === 426 && old.body?.code === 'UPDATE_REQUIRED' && old.body?.storeUrl === STORE && old.body?.minimumVersion === '1.5.0', JSON.stringify(old.body)?.slice(0, 160));
  const legacy = await call('/tech/queue', nat('1.4.0'));
  check('the legacy (un-versioned) path is gated the same', legacy.status === 426);
  const cur = await call('/api/v1/tech/queue', nat('1.5.0', DEVICES[1]));
  check('native 1.5.0 passes the gate (then the session check answers)', cur.status !== 426, `status ${cur.status}`);

  for (const [p, m, b] of [['/api/v1/auth/login', 'POST', { email: 'nobody@example.test', password: 'x' }], ['/api/v1/auth/refresh', 'POST', {}], ['/health', 'GET'], ['/api/v1/app-config?app=tech&platform=ios&version=1.4.0', 'GET']]) {
    const r = await call(p, nat('1.4.0'), m, b);
    check(`exempt for the old build: ${m} ${p.split('?')[0]}`, r.status !== 426, `status ${r.status}`);
  }
  check('web platform never refused', (await call('/api/v1/tech/queue', nat('0.0.1', DEVICES[0], 'web'))).status !== 426);
  check('no client headers never refused', (await call('/api/v1/tech/queue', {})).status !== 426);
  check('kiosk / display ids never refused', (await call('/api/v1/tech/queue', nat('0.0.1', DEVICES[0], 'ios', 'kiosk'))).status !== 426);

  const cfgOld = await call('/api/v1/app-config?app=tech&platform=ios&version=1.4.0');
  check('GET /app-config without a session: 200, UPDATE_REQUIRED + store link', cfgOld.status === 200 && cfgOld.body?.update?.state === 'UPDATE_REQUIRED' && cfgOld.body?.update?.storeUrl === STORE, JSON.stringify(cfgOld.body?.update));
  const cfgRec = await call('/api/v1/app-config?app=tech&platform=ios&version=1.5.2');
  check('GET /app-config: 1.5.2 → UPDATE_RECOMMENDED', cfgRec.body?.update?.state === 'UPDATE_RECOMMENDED');
  const cfgWeb = await call('/api/v1/app-config?app=tech&platform=web&version=0.0.1');
  check('GET /app-config: web → SUPPORTED, flags present', cfgWeb.body?.update?.state === 'SUPPORTED' && typeof cfgWeb.body?.flags?.update_prompts === 'boolean');
  check('GET /app-config: an unknown app is a 400', (await call('/api/v1/app-config?app=pos')).status === 400);

  await sleep(500);
  const seen = await q(`select app_version from mobile_app_installs_seen where device_hash in (select encode(sha256(convert_to(x, 'UTF8')), 'hex') from unnest($1::text[]) x) and platform = 'ios'`, [DEVICES]);
  check('installs seen are recorded by hashed device id', seen.length === 2, JSON.stringify(seen));
} catch (e) { if (String(e?.message) !== 'boot') check('unexpected error', false, String(e?.stack ?? e)); }
finally { await restore(); }
console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
