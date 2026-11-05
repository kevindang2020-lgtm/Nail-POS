// browser-e2e.mjs — full authenticated click-through against the REAL app in a REAL browser.
//
// What it does: boots the actual backend (migrations + seed of the PALACE demo tenant + dist/main.js), serves a built
// frontend SPA on the SAME ORIGIN as the API (so the httpOnly session cookie flows), then drives Chromium through the
// real login form into the authenticated app and asserts that authenticated API calls return 200 with real data.
//
// DATABASE: provide your own Postgres for the full run —
//     DATABASE_URL=postgres://user:pass@localhost:5432/aps_e2e node scripts/browser-e2e.mjs
//   With a real Postgres the dashboard's concurrent data calls work normally and the click-through fully passes.
//   If DATABASE_URL is NOT set, the script spins up an in-process PGlite-over-the-wire DB for convenience. That proves
//   login + authenticated-shell render, but PGlite desyncs under the SPA's *concurrent* queries, so this script
//   serializes API requests at the proxy in that mode (slower; a real Postgres needs no serialization).
//
// FRONTEND: APP=pos-web (default) selects which built SPA is served. The serving/proxy/assertions are app-general, but
//   the login form-fill below targets the tenant-staff form (Salon code / Email or phone / Password / "Sign in") used by
//   pos-web. To click through owner-web/tech-web/customer-web/admin-web, adapt the form selectors for that app's login.
//   Build the target app first (cd apps/<APP> && npm run build).
// CREDS: owner@palace.test / Owner!2345 (salon code PALACE) — created by scripts/seed.ts.
//
// Prereqs: `npm run build` in apps/api AND in apps/<APP>; Playwright Chromium available. From apps/api:
//     APP=pos-web DATABASE_URL=postgres://... node scripts/browser-e2e.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const APP_NAME = process.env.APP || 'pos-web';
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const API = join(SCRIPTS, '..');
const DIST = join(API, `../${APP_NAME}/dist`);
const APP_PORT = Number(process.env.E2E_APP_PORT) || 3019;
const PROXY_PORT = Number(process.env.E2E_PROXY_PORT) || 4219;
const PG_PORT = Number(process.env.E2E_PG_PORT) || 5459;

// --- DB: real Postgres if DATABASE_URL is given, else in-process PGlite-over-the-wire ---
const usingPglite = !process.env.DATABASE_URL;
let pgserver = null, db = null;
const DB_URL = process.env.DATABASE_URL || `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`;
if (usingPglite) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  pgserver = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1', maxConnections: 20 });
  await pgserver.start();
  console.log(`▸ in-process PGlite DB on :${PG_PORT} (set DATABASE_URL to use a real Postgres for the full data-render)`);
}

const base = { ...process.env, DATABASE_URL: DB_URL, REPO_DRIVER: 'postgres' };
const CREDS = { SEED_TENANT_CODE: 'PALACE', SEED_OWNER_EMAIL: 'owner@palace.test', SEED_OWNER_PASSWORD: 'Owner!2345', SEED_TENANT_NAME: 'Palace Nails' };
const sh = (cmd, args, extra = {}) => new Promise((res) => { const p = spawn(cmd, args, { cwd: API, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('exit', (code) => res({ code, o })); });

let app = null, proxy = null, browser = null, code = 1, proxyErr = '';
const teardown = async () => { try { await browser?.close(); } catch {} try { proxy?.close(); } catch {} try { app?.kill('SIGKILL'); } catch {} try { await pgserver?.stop(); } catch {} try { await db?.close(); } catch {} };

try {
  let r = await sh('node', ['scripts/migrate.mjs']); if (r.code) throw new Error('migrate failed\n' + r.o.slice(-900));
  console.log('▸ migrate ok');
  r = await sh('npx', ['tsx', 'scripts/seed.ts'], CREDS); if (r.code) throw new Error('seed failed\n' + r.o.slice(-900));
  console.log('▸ seed ok (PALACE + owner@palace.test)');

  app = spawn('node', ['dist/main.js'], { cwd: API, env: { ...base, PG_POOL_MAX: usingPglite ? '1' : '10', PORT: String(APP_PORT), AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'e2e-secret', PAYMENTS_ALLOW_ENV_FALLBACK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; app.stdout.on('data', (d) => (log += d)); app.stderr.on('data', (d) => (log += d));
  const ready = await (async () => { for (let i = 0; i < 80; i++) { try { const x = await fetch(`http://127.0.0.1:${APP_PORT}/`); if (x.status) return true; } catch {} await new Promise((s) => setTimeout(s, 500)); } return false; })();
  if (!ready) throw new Error('API did not start\n' + log.slice(-5000));
  console.log(`▸ API listening on :${APP_PORT}`);

  // same-origin server: forward API paths to the backend (de-Secure cookies for http), serve the SPA otherwise.
  const API_PREFIX = ['/auth', '/pos', '/tech', '/owner', '/super-admin', '/customer', '/public', '/device', '/health'];
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  let apiChain = Promise.resolve();
  const forward = (req, res, body) => new Promise((settle) => {
    const headers = { ...req.headers, host: `127.0.0.1:${APP_PORT}` };
    delete headers.connection; delete headers['keep-alive']; delete headers['proxy-connection']; delete headers['content-length'];
    if (body && body.length) headers['content-length'] = String(body.length);
    const pr = http.request({ hostname: '127.0.0.1', port: APP_PORT, path: req.url, method: req.method, headers, agent: false }, (br) => {
      const sc = br.headers['set-cookie'];
      if (sc) br.headers['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/ig, '').replace(/;\s*Partitioned/ig, '').replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*SameSite=None/ig, '; SameSite=Lax'));
      try { res.writeHead(br.statusCode || 502, br.headers); } catch {}
      br.pipe(res); br.on('end', settle); br.on('close', settle); br.on('error', settle);
    });
    pr.on('error', (err) => { if (!proxyErr) proxyErr = String((err && err.message) || err); try { res.writeHead(502); res.end('proxy error'); } catch {} settle(); });
    if (body && body.length) pr.end(body); else pr.end();
  });
  proxy = http.createServer((req, res) => {
    const u = req.url || '/';
    if (u.startsWith('/realtime')) { try { res.writeHead(204); res.end(); } catch {} return; } // SSE: not proxied
    if (API_PREFIX.some((p) => u === p || u.startsWith(p + '/') || u.startsWith(p + '?'))) {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => { const body = Buffer.concat(chunks);
        if (usingPglite) apiChain = apiChain.then(() => forward(req, res, body)).catch(() => {}); // serialize for PGlite
        else forward(req, res, body); // real Postgres: concurrent is fine
      });
      req.on('error', () => { try { res.writeHead(400); res.end(); } catch {} });
      return;
    }
    let fp = join(DIST, u.split('?')[0]);
    if (!existsSync(fp) || !statSync(fp).isFile()) fp = join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': mime[extname(fp)] || 'application/octet-stream' });
    createReadStream(fp).pipe(res);
  });
  await new Promise((s) => proxy.listen(PROXY_PORT, s));
  console.log(`▸ same-origin proxy on :${PROXY_PORT} (serving ${APP_NAME}/dist + API)\n`);

  // HOLD MODE (viewport audits etc.): boot everything, announce readiness, and stay up until SIGTERM — the caller
  // drives its own browser against the proxy. Skips the built-in click-through entirely.
  if (process.env.E2E_HOLD === '1') {
    console.log(`E2E_READY :${PROXY_PORT}`);
    if (process.env.E2E_LOG_FILE) {
      const { appendFileSync } = await import('node:fs');
      app.stdout.on('data', (d) => { try { appendFileSync(process.env.E2E_LOG_FILE, d); } catch {} });
      app.stderr.on('data', (d) => { try { appendFileSync(process.env.E2E_LOG_FILE, d); } catch {} });
    }
    process.on('SIGTERM', async () => { await teardown(); process.exit(0); });
    process.on('SIGINT', async () => { await teardown(); process.exit(0); });
    await new Promise(() => {});
  }


  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  const pageErrors = [], apiResp = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('response', (rsp) => { try { const p = new URL(rsp.url()).pathname; if (API_PREFIX.some((x) => p.startsWith(x))) apiResp.push(`${rsp.request().method()} ${p} -> ${rsp.status()}`); } catch {} });
  const BASEURL = `http://127.0.0.1:${PROXY_PORT}`;

  await page.goto(BASEURL + '/', { waitUntil: 'load', timeout: 20000 });
  await page.locator('#aps-store').fill('PALACE');
  await page.locator('#aps-identifier').fill('owner@palace.test');
  await page.locator('#aps-password').fill('Owner!2345');
  const loginResp = page.waitForResponse((rr) => rr.url().includes('/auth/login'), { timeout: 20000 });
  await page.getByRole('button', { name: 'Sign in' }).click();
  const lr = await loginResp;
  console.log(`  · POST /auth/login -> ${lr.status()}`);
  await page.waitForTimeout(1200);
  try { const bb = page.locator('button.ghost'); if (await bb.count() > 0 && /branch|select/i.test(await page.locator('body').innerText())) { await bb.first().click(); await page.waitForTimeout(1000); } } catch {}
  await page.waitForFunction(() => !document.querySelector('input[placeholder="Enter store code"]'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const onLogin = /Salon code/.test(await page.content());
  const shellText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 120);
  const protectedGet = apiResp.filter((s) => /^GET \//.test(s) && / -> 200$/.test(s) && /\/(pos|owner|tech|customer)\//.test(s));

  console.log(`\n  authenticated shell rendered: ${!onLogin ? 'YES' : 'no'}  «${shellText}»`);
  console.log(`  authenticated GETs returning 200: ${protectedGet.length}`);
  for (const s of apiResp.filter((s) => /\/(pos|owner|tech|customer)\//.test(s)).slice(0, 6)) console.log(`     ${s}`);
  console.log(`  uncaught JS errors: ${pageErrors.length}${pageErrors.length ? ' :: ' + pageErrors.slice(0, 2).join(' | ') : ''}`);
  if (proxyErr) console.log(`  (proxy transport note: ${proxyErr})`);

  const pass = lr.status() === 200 && !onLogin && protectedGet.length > 0 && pageErrors.length === 0;
  console.log(`\n${pass ? '✅ AUTHENTICATED CLICK-THROUGH PASSED' : '❌ click-through incomplete'} — real login → real session cookie → authenticated data, in a real browser`);
  if (!pass) console.log('\n— backend log tail —\n' + log.slice(-1500));
  code = pass ? 0 : 1;
} catch (e) {
  console.log('❌ ERROR: ' + (e?.message || e));
} finally {
  await teardown();
  process.exit(code);
}
