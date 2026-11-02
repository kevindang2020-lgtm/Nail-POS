#!/usr/bin/env node
// live-phase12-v1.mjs — BUILD_PLAN Phase 12 (Constitution 5 DoD #57), proved IN A REAL BROWSER (headless Chromium) against
// the real compiled API and the local PostgreSQL: every API request the built POS, Owner and Super Admin apps make goes
// to /api/v1/<path>, and none of them fails.
//   1. pos-web, owner-web and admin-web (their `npx vite build` dist/) are served behind a same-origin static + API proxy
//      (so the session cookie flows exactly as in production — the Phase 8 harness pattern);
//   2. a MANAGER signs in to the POS (a proof branch of PILOT01) and opens Dashboard, Queue and Customers; an OWNER signs
//      in to the Owner app and opens Live, Approvals and Reports; a Super Admin signs in to admin-web (password + MFA
//      bootstrap) and opens Dashboard, Tenants and Alerts;
//   3. every fetch / XHR / EventSource request in each page's network log is checked: its path is /api/v1/… (or one of
//      the paths that stay put by the shared list — /auth/refresh, /media, /platform/branding); after sign-in none is
//      answered 4xx/5xx;
//   4. a LEGACY-path request (an app already installed in the field) still works and carries Deprecation / Sunset / Link,
//      a /api/v1 request carries none, and the legacy hit is counted on /metrics.
// It removes everything it made (the proof branch, the three users, their sessions and login attempts).
//
// Run (apps/api built; apps/pos-web, apps/owner-web and apps/admin-web built with `npx vite build`):
//   DATABASE_URL=postgres://postgres@localhost:5432/postgres node scripts/live-phase12-v1.mjs
// Never point it at production. CHROMIUM_PATH picks the browser binary.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import { existsSync, statSync, readFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const DIST = { pos: join(API_DIR, '..', 'pos-web', 'dist'), owner: join(API_DIR, '..', 'owner-web', 'dist'), admin: join(API_DIR, '..', 'admin-web', 'dist') };
for (const d of Object.values(DIST)) if (!existsSync(join(d, 'index.html'))) { console.error(`build first: ${d}/index.html is missing (npx vite build)`); process.exit(2); }
const API_PORT = Number(process.env.P12_API_PORT) || 3072;
const PORTS = { pos: 4272, owner: 4273, admin: 4274 };
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = Object.fromEntries(Object.entries(PORTS).map(([k, p]) => [k, `http://127.0.0.1:${p}`]));
const SALON = process.env.SALON_CODE || 'PILOT01';
const OUT = process.env.OUT || '/tmp/claude-0/-home-claude/59f94190-34ea-56af-bac0-4d60a89b63f0/scratchpad/p12/E/live';
mkdirSync(OUT, { recursive: true });
const CHROMIUM = process.env.CHROMIUM_PATH || (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) for (const sub of ['chrome-linux64', 'chrome-linux']) { const p = join(root, d, sub, 'chrome'); if (existsSync(p)) return p; } } catch { /* none */ }
  return undefined;
})();
/** Paths that stay where they are (packages/api-client/src/api-version.ts — the refresh cookie's Path, pictures, branding). */
const STAYS_PUT = /^\/(auth\/refresh|media|platform|health|readyz|livez|metrics|webhooks?|oauth|integrations\/inbound|\.well-known|api)(\/|$|\?)/;

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const TA = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!TA) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase12 Proof%'`, [TA])) await removeProofBranchTx(client, TA, r.id);
const tag = String(Date.now()).slice(-6);
const BA = randomUUID(), MGR = randomUUID(), OWN = randomUUID(), SA = randomUUID();
const PW = 'Phase12!' + randomUUID().slice(0, 10);
const BRANCH = `Live Phase12 Proof ${tag}`;
const MGR_EMAIL = `phase12-mgr-${tag}@aipowersalon.test`, OWN_EMAIL = `phase12-own-${tag}@aipowersalon.test`, SA_EMAIL = `phase12-sa-${tag}@aipowersalon.test`;
const hash = await hashPassword(PW);
const users = [MGR, OWN, SA];
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','12 Proof Way')`, [BA, TA, BRANCH]);
for (const [u, email, role, fn, level] of [[MGR, MGR_EMAIL, 'MANAGER', 'Max', 'manager'], [OWN, OWN_EMAIL, 'OWNER', 'Ona', 'owner']]) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Twelve',$4 || ' Twelve',$5,$6,'active',$7)`, [u, TA, BA, fn, email, hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [TA, BA, u, level]).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [TA, BA, u]).catch(() => undefined));
}
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Sam', 'Twelve', 'Sam Twelve', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);

// ── processes: compiled API + three same-origin static/proxy servers ────────────────────────────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(API_PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'API_LEGACY_SUNSET', 'METRICS_TOKEN']) delete env[k];
env.COMMUNITY_JOBS = 'off'; env.AI_QUEUE_OPS_JOBS = 'off'; env.AI_SCHEDULING_JOBS = 'off';
let apiProc = null, apiErr = '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
/** A browser NAVIGATION (Accept: text/html) gets the SPA; a real file in dist is served; everything else is the API. */
function sameOrigin(dist) {
  return http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1));
    const isFile = path !== '/' && existsSync(file) && statSync(file).isFile();
    const wantsHtml = req.method === 'GET' && /text\/html/.test(String(req.headers.accept || ''));
    if (isFile || wantsHtml) {
      const f = isFile ? file : join(dist, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
    delete headers.connection; delete headers['keep-alive'];
    const pr = http.request({ hostname: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers }, (br) => {
      const sc = br.headers['set-cookie'];
      if (sc) br.headers['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/ig, '').replace(/;\s*Partitioned/ig, '').replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*SameSite=None/ig, '; SameSite=Lax'));
      try { res.writeHead(br.statusCode || 502, br.headers); } catch { /* closed */ }
      br.pipe(res);
    });
    pr.on('error', () => { try { res.writeHead(502); res.end('proxy error'); } catch { /* closed */ } });
    req.pipe(pr);
  });
}
const servers = Object.fromEntries(Object.entries(DIST).map(([k, d]) => [k, sameOrigin(d)]));

// ── the network log ─────────────────────────────────────────────────────────────────────────────────────────────────
let browser = null;
const pageErrors = [];
/** Every API call a page makes: { app, phase, method, path, status }. `phase` flips to 'signed-in' after the login. */
const calls = [];
async function newPage(app) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  page.__phase = 'sign-in';
  page.on('pageerror', (e) => pageErrors.push(`${app}: ${String(e?.message || e).slice(0, 160)}`));
  const isApi = (req) => {
    const u = new URL(req.url());
    if (u.origin !== ORIGIN[app]) return null;
    if (!['fetch', 'xhr', 'eventsource'].includes(req.resourceType())) return null;
    return u.pathname + u.search;
  };
  page.on('response', async (r) => {
    const p = isApi(r.request()); if (!p) return;
    const c = { app, phase: page.__phase, method: r.request().method(), path: p, status: r.status() };
    calls.push(c);
    if (c.status >= 400) { try { const b = JSON.parse(await r.text()); c.code = b?.error?.code ?? b?.code; c.message = String(b?.error?.message ?? b?.message ?? '').slice(0, 120); } catch { /* not JSON */ } }
  });
  page.on('requestfailed', (r) => { const p = isApi(r); if (p && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) calls.push({ app, phase: page.__phase, method: r.method(), path: p, status: 0, failure: r.failure()?.errorText }); });
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);
const visible = async (l, ms = 1500) => { try { await l.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } };
const settle = async (page) => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await sleep(700); };

/** A 4xx/5xx on /api/v1 is replayed on the LEGACY spelling with the same session: the same answer there means it is the
 *  screen's own behaviour on this salon (not the /api/v1 move); a different answer is a /api/v1 regression. */
async function replayLegacy(app, page) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  for (const c of calls.filter((x) => x.app === app && x.phase === 'signed-in' && x.status >= 400 && x.method === 'GET')) {
    if (c.legacyStatus !== undefined) continue;
    const r = await fetch(API + c.path.replace(/^\/api\/v1/, ''), { headers: { cookie } }).catch(() => null);
    c.legacyStatus = r ? r.status : 0;
  }
}
function judge(app) {
  const mine = calls.filter((c) => c.app === app);
  const legacy = mine.filter((c) => !c.path.startsWith('/api/v1/') && !STAYS_PUT.test(c.path));
  const stayed = mine.filter((c) => !c.path.startsWith('/api/v1/') && STAYS_PUT.test(c.path));
  const bad = mine.filter((c) => c.phase === 'signed-in' && (c.status >= 400 || c.status === 0));
  const regress = bad.filter((c) => c.legacyStatus === undefined || c.legacyStatus !== c.status);
  check(`${app}: every API request in the network log went to /api/v1/… (${mine.length} requests, ${new Set(mine.map((c) => c.path.split('?')[0])).size} distinct paths)`,
    mine.length > 0 && legacy.length === 0, legacy.length ? legacy.slice(0, 5).map((c) => `${c.method} ${c.path}`).join(' | ') : (stayed.length ? `paths that stay put: ${[...new Set(stayed.map((c) => c.path.split('?')[0]))].join(', ')}` : ''));
  const uniq = [...new Map(bad.map((c) => [`${c.status} ${c.method} ${c.path.split('?')[0]}`, c])).values()];
  check(`${app}: after sign-in no API request was answered 4xx/5xx (or failed)`, bad.length === 0,
    uniq.slice(0, 6).map((c) => `${c.status} ${c.method} ${c.path.split('?')[0]} ${c.code ?? ''} "${c.message ?? ''}" (legacy path: ${c.legacyStatus ?? '-'})${c.failure ? ' ' + c.failure : ''}`).join(' | '));
  check(`${app}: no /api/v1 answer differs from the legacy path's (the move changed no response)`, regress.length === 0, regress.slice(0, 6).map((c) => `${c.status} v1 vs ${c.legacyStatus ?? '?'} legacy ${c.method} ${c.path.split('?')[0]}`).join(' | '));
}

// ── cleanup ────────────────────────────────────────────────────────────────────────────────────────────────────────
const cleanup = async () => {
  try { await browser?.close(); } catch { /* */ }
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  for (const s of Object.values(servers)) s.close();
  await sleep(1200);
  for (const u of users) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'user_branch_access', 'user_roles', 'user_permissions']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[MGR_EMAIL, OWN_EMAIL, SA_EMAIL]]).catch(() => undefined);
  const b = await removeProofBranchTx(client, TA, BA).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [users]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from users where id = any($1::uuid[])) + (select count(*)::int from branches where id = $2) + (select count(*)::int from sessions where user_id = any($1::uuid[])) as n`, [users, BA]))[0].n;
  check('cleanup: the proof branch, the three users and their sessions are gone', b.removed && left === 0, `branch ${b.removed} [${(b.kept ?? []).join(', ')}] left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); console.log(results.join('\n')); process.exit(1); }, 12 * 60_000);

// ── the proof ──────────────────────────────────────────────────────────────────────────────────────────────────────
try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  for (const [k, s] of Object.entries(servers)) await new Promise((r) => s.listen(PORTS[k], '127.0.0.1', r));
  let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the compiled API booted against PostgreSQL; pos-web, owner-web and admin-web are served same-origin', up, apiErr.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  browser = await chromium.launch({ args: ['--no-sandbox'], ...(CHROMIUM ? { executablePath: CHROMIUM } : {}) });

  // ── 1. POS: a manager — Dashboard, Queue, Customers ────────────────────────────────────────────────────────────────
  const pos = await newPage('pos');
  await pos.goto(ORIGIN.pos + '/', { waitUntil: 'load' });
  await pos.locator('#aps-store').fill(SALON);
  await pos.locator('#aps-identifier').fill(MGR_EMAIL);
  await pos.locator('#aps-password').fill(PW);
  await pos.getByRole('button', { name: /^Sign In$/i }).click();
  const pick = pos.getByRole('button', { name: new RegExp('^' + BRANCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  if (await visible(pick, 6000)) await pick.first().click();
  await pos.waitForFunction(() => !document.querySelector('#aps-password'), null, { timeout: 20000 });
  await settle(pos); pos.__phase = 'signed-in';
  const posScreens = [];
  for (const [path, name] of [['/dashboard', 'Dashboard'], ['/queue', 'Queue'], ['/customers', 'Customers']]) {
    await pos.goto(ORIGIN.pos + path, { waitUntil: 'load' }); await settle(pos); await shot(pos, `pos-${name.toLowerCase()}`);
    posScreens.push(`${name} ${!(await pos.locator('#aps-password').count()) ? 'open' : 'LOGIN'}`);
  }
  check('POS: the manager signs in and opens Dashboard, Queue and Customers', posScreens.every((s) => s.endsWith('open')), posScreens.join(', '));
  await replayLegacy('pos', pos); judge('pos');

  // ── 2. Owner app: an owner — Live, Approvals, Reports ──────────────────────────────────────────────────────────────
  const own = await newPage('owner');
  await own.goto(ORIGIN.owner + '/', { waitUntil: 'load' });
  await own.getByLabel('Email or Mobile Number').fill(OWN_EMAIL);
  await own.getByLabel('Password', { exact: true }).fill(PW);
  await own.getByRole('button', { name: /Sign In/ }).click();
  const ownerIn = await visible(own.getByRole('navigation', { name: 'Primary' }), 20000);
  await settle(own); own.__phase = 'signed-in';
  const ownScreens = [];
  for (const tab of ['Live', 'Approvals', 'Reports']) {
    const b = own.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: tab, exact: true });
    if (await visible(b, 5000)) { await b.click(); await settle(own); await shot(own, `owner-${tab.toLowerCase()}`); ownScreens.push(`${tab} ${(await b.getAttribute('aria-current')) === 'page' ? 'open' : 'not-current'}`); }
    else ownScreens.push(`${tab} missing`);
  }
  check('Owner app: the owner signs in and opens Live, Approvals and Reports', ownerIn && ownScreens.every((s) => s.endsWith('open')), `${ownerIn ? 'signed in' : 'NOT signed in'}; ${ownScreens.join(', ')}`);
  await replayLegacy('owner', own); judge('owner');

  // ── 3. Super Admin: Dashboard, Tenants, Alerts ─────────────────────────────────────────────────────────────────────
  const sa = await newPage('admin');
  await sa.goto(ORIGIN.admin + '/', { waitUntil: 'load' });
  await sa.getByLabel('Email or Username').fill(SA_EMAIL);
  await sa.getByLabel('Password', { exact: true }).fill(PW);
  await sa.getByRole('button', { name: /^Sign In/ }).click();
  // a Super Admin is MFA-required at login; a not-yet-enrolled account proceeds with any well-formed code (bootstrap path)
  if (await visible(sa.getByLabel('6-digit verification code'), 8000)) {
    await sa.getByLabel('6-digit verification code').fill('123456');
    await sa.getByRole('button', { name: /^Verify$/ }).click();
  }
  await sa.waitForFunction(() => !document.querySelector('input[aria-label="Password"]') && !document.querySelector('input[autocomplete="one-time-code"]'), null, { timeout: 20000 });
  await settle(sa); sa.__phase = 'signed-in';
  const saScreens = [];
  for (const [path, name] of [['/dashboard', 'Dashboard'], ['/tenants', 'Tenants'], ['/alerts', 'Alerts']]) {
    await sa.goto(ORIGIN.admin + path, { waitUntil: 'load' }); await settle(sa); await shot(sa, `admin-${name.toLowerCase()}`);
    saScreens.push(`${name} ${!(await sa.locator('input[aria-label="Password"]').count()) ? 'open' : 'LOGIN'}`);
  }
  check('admin-web: the Super Admin signs in (password + MFA step) and opens Dashboard, Tenants and Alerts', saScreens.every((s) => s.endsWith('open')), saScreens.join(', '));
  await replayLegacy('admin', sa); judge('admin');

  // ── 4. the legacy spelling still works, says so, and is counted ────────────────────────────────────────────────────
  const metric = async () => { const t = await (await fetch(API + '/metrics')).text(); const m = /aipowersalon_api_legacy_path_requests_total\{prefix="auth"\} (\d+)/.exec(t); return m ? Number(m[1]) : 0; };
  const before = await metric();
  const legacy = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: MGR_EMAIL, password: PW }) });
  const cookie = (legacy.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('a legacy-path request (an app already installed) still works and carries Deprecation + Sunset + Link to its /api/v1 successor',
    legacy.status === 200 && legacy.headers.get('deprecation') === 'true' && !!legacy.headers.get('sunset') && /<\/api\/v1\/auth\/login>; rel="successor-version"/.test(legacy.headers.get('link') ?? ''),
    `${legacy.status} Deprecation=${legacy.headers.get('deprecation')} Sunset=${legacy.headers.get('sunset')} Link=${legacy.headers.get('link')}`);
  const v1 = await fetch(API + '/api/v1/auth/me', { headers: { cookie } });
  check('the same session on /api/v1 answers with no deprecation headers', v1.status === 200 && !v1.headers.get('deprecation') && !v1.headers.get('sunset'), `${v1.status} Deprecation=${v1.headers.get('deprecation')}`);
  const after = await metric();
  check('the legacy hit is counted (aipowersalon_api_legacy_path_requests_total{prefix="auth"} on /metrics)', after >= before + 1, `${before} → ${after}`);
  const refresh = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('/auth/refresh (the cookie-scoped path that stays put) is not marked deprecated', !refresh.headers.get('deprecation'), `${refresh.status} Deprecation=${refresh.headers.get('deprecation')}`);
  check('no uncaught page errors in the three apps', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  writeFileSync(join(OUT, 'network-log.json'), JSON.stringify(calls, null, 1));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed · network log + screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
}
