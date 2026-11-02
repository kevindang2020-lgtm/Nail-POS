/* e2e-admin-browser.mjs — REAL browser E2E for the Super Admin app: PGlite-backed COMPILED API (dist/main.js, same
 * machinery as verify-live-socket) + the built admin-web bundle behind a tiny static+proxy server + headless Chromium.
 * Proves what no other tier can: a real login (scrypt verify + session cookie) and every sidebar route RENDERING in a
 * real browser with zero page errors and zero console errors (favicon noise allowlisted).
 * PG_POOL_MAX=1 serializes the app's pg pool over the SINGLE-connection PGlite socket (a browser fires concurrent
 * requests; with the default pool of 10 the extra connections die and surface as 500s — an environment constraint,
 * not an app defect; production Postgres pools normally).
 * Prereqs: `npm run build` (api dist) and `npx vite build` in apps/admin-web; playwright + chromium installed. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules

const DB_PORT = 5592, API_PORT = 3298, WEB_PORT = 3299;
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const EMAIL = 'kevin@aipowersalon.test', PASSWORD = 'Root-Pass-E2E-9';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1) scrypt hash in the app's exact self-describing format (packages/auth/src/password.ts: N=16384,r=8,p=1,keylen=64,salt=16B)
  const salt = randomBytes(16);
  const dk = scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const hash = ['scrypt', 16384, 8, 1, salt.toString('base64'), dk.toString('base64')].join('$');
  ok('seed: scrypt hash in the exact stored format', hash.split('$').length === 6 && hash.startsWith('scrypt$16384$8$1$'));

  // 2) PGlite + migrations + super admin seed
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  await db.exec(`INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES (gen_random_uuid(), NULL, 'Kevin Root', '${EMAIL}', '${hash}', 'active', 'SUPER_ADMIN')`);
  const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' }); await server.start();

  // 3) compiled API
  const api = spawn('node', ['dist/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, REPO_DRIVER: 'postgres', DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`, PORT: String(API_PORT), AUTH_SESSION_SECRET: 'test-secret', NODE_ENV: 'test', PG_POOL_MAX: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let apiErr = ''; api.stderr?.on('data', (d) => (apiErr += d.toString()));

  // 4) static + proxy for the built admin bundle (same-origin API like production)
  const DIST = join(process.cwd(), '..', 'admin-web', 'dist');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json' };
  const web = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path.startsWith('/auth') || path.startsWith('/super-admin')) {
      const p = http.request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } }, (r2) => { res.writeHead(r2.statusCode || 502, r2.headers); r2.pipe(res); });
      p.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
    }
    let file = join(DIST, path === '/' ? 'index.html' : path.slice(1));
    if (!existsSync(file) || !extname(file)) file = join(DIST, 'index.html'); // SPA fallback
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r));

  let browser = null;
  try {
    // API readiness
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = await new Promise((r) => { const q = http.get({ host: '127.0.0.1', port: API_PORT, path: '/health' }, (res2) => { res2.resume(); r(true); }); q.on('error', () => r(false)); });
      if (!up) await sleep(500);
    }
    ok('compiled API booted (PGlite-backed)', up, up ? '' : apiErr.slice(-300));
    if (!up) throw new Error('api down');

    // 5) Chromium
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    const benign = (t) => /favicon|ERR_BLOCKED_BY_CLIENT|Download the React DevTools/i.test(t);
    page.on('pageerror', (e) => { if (!benign(String(e))) errors.push(`pageerror: ${e}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !benign(m.text())) errors.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/super-admin')) errors.push(`${r.status()} ${r.url().replace(/^.*?:\d+/, '')}`); });

    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Email"]', { timeout: 15000 });
    ok('login screen renders in a real browser', true);
    await page.fill('input[placeholder="Email"]', EMAIL);
    await page.fill('input[placeholder="Password"]', PASSWORD);
    await page.click('button:has-text("Sign in")');
    // SUPER_ADMIN is MFA-required at login; a not-yet-enrolled bootstrap account proceeds with any well-formed code
    await page.waitForSelector('input[placeholder="6-digit code"]', { timeout: 15000 });
    ok('login step 1: scrypt verify ok -> MFA_REQUIRED prompt (spec §22 bootstrap path)', true);
    await page.fill('input[placeholder="6-digit code"]', '123456');
    const loginResp = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 15000 });
    await page.click('button:has-text("Verify & sign in")');
    const lr = await loginResp; const lrBody = await lr.text().catch(() => '');
    errors.length = 0; // the pre-login /auth/me probe 401s by design (session check on app boot) — not a defect
    console.log(`   · /auth/login -> ${lr.status()} ${lrBody.slice(0, 180)}`);
    await page.waitForSelector('text=Audit Logs', { timeout: 20000 }); // sidebar = shell mounted
    await sleep(800);
    const afterLogin = await page.evaluate(() => !document.querySelector('input[placeholder="Email"]'));
    ok('login step 2: session established, app shell rendered', afterLogin, errors.slice(0, 2).join(' | '));

    const routes = ['/', '/dashboard', '/tenants', '/tenant-applications', '/website-leads', '/hardware-packages', '/payment-gateways', '/subscriptions', '/ai-packages', '/usage-limits', '/users-roles', '/support-access', '/platform-reports', '/system-health', '/audit-logs', '/settings', '/project-status'];
    for (const r of routes) {
      errors.length = 0;
      await page.goto(BASE + r, { waitUntil: 'load', timeout: 30000 });
      await sleep(1100); // let data effects settle (SSE badges keep the network busy; networkidle would never fire)
      const h1 = (await page.locator('h1, h2').first().textContent().catch(() => '')) || '';
      const loggedIn = await page.evaluate(() => !document.querySelector('input[placeholder="Email"]'));
      ok(`route ${r} renders ("${h1.trim()}"), no page/console errors`, loggedIn && h1.trim().length > 0 && errors.length === 0, errors.slice(0, 2).join(' | '));
    }
  } catch (e) {
    ok('e2e flow', false, String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    api.kill('SIGKILL'); web.close(); await server.stop().catch(() => {}); await db.close().catch(() => {});
  }
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} e2e-admin-browser: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
