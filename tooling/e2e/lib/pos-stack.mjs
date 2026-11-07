// pos-stack.mjs — boot the REAL POS stack for a browser check: the built API (apps/api/dist) on a local PostgreSQL, a
// static server for the built POS (apps/pos-web/dist) that proxies API calls, Chromium with the POS fonts served
// offline, and an owner session for a seeded salon. Shared by pos-vi-one-screen.mjs (CLI) and pos-module-inventory.mjs
// so the two cannot drift. Local databases only.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @returns {{ WEB: string, API: string, ctx: import('playwright').BrowserContext, browser: import('playwright').Browser,
 *   setLanguage: (lang: string) => Promise<void>, tenantId: string, branchId: string, pool: any, stop: () => Promise<void>,
 *   apiLog: () => string }}
 */
export async function startPosStack({ db = process.env.DATABASE_URL, apiPort = Number(process.env.API_PORT || 3194), webPort = Number(process.env.WEB_PORT || 3294),
  salon = process.env.SALON_CODE || 'PILOT01', fonts = null, routeFonts = null, viewport = { width: 1920, height: 1080 } } = {}) {
  const apiReq = createRequire(ROOT + 'apps/api/package.json');
  const { chromium } = createRequire(ROOT + 'package.json')('playwright');
  if (!db) throw new Error('DATABASE_URL is required');
  if (!/localhost|127\.0\.0\.1/.test(db)) throw new Error('refusing a non-local database');
  const API = `http://127.0.0.1:${apiPort}`, WEB = `http://127.0.0.1:${webPort}`;
  const DIST = join(ROOT, 'apps/pos-web/dist');
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build the POS first: (cd apps/pos-web && npx vite build)');
  const pg = apiReq('pg');
  const pool = new pg.Pool({ connectionString: db, max: 2 });
  const T = (await pool.query(`select id from tenants where tenant_code = $1`, [salon])).rows[0]?.id;
  if (!T) { await pool.end(); throw new Error(`salon ${salon} not found — seed it first (apps/api/scripts/seed.ts)`); }
  const B = (await pool.query(`select id from branches where tenant_id = $1 and deleted_at is null order by created_at limit 1`, [T])).rows[0].id;
  const env = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(apiPort), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
    DATABASE_URL: db, PRIVATE_FILES_ROOT: mkdtempSync(join(tmpdir(), 'pos-stack-priv-')), MEDIA_ROOT: mkdtempSync(join(tmpdir(), 'pos-stack-media-')),
    AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', EVENT_PUBLISHER_ENABLED: 'on' };
  for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'PROCESS_ROLE']) delete env[k];
  let apiLog = '';
  const apiProc = spawn('node', ['dist/main.js'], { cwd: ROOT + 'apps/api', env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProc.stdout.on('data', (c) => { apiLog += c; }); apiProc.stderr.on('data', (c) => { apiLog += c; });
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const web = createServer((req, res) => {
    const u = new URL(req.url, WEB);
    const file = normalize(join(DIST, decodeURIComponent(u.pathname)));
    const isFile = u.pathname !== '/' && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (isFile || wantsHtml) { const f = isFile ? file : join(DIST, 'index.html'); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f)); return; }
    const up = httpRequest({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* the page went away */ } });
    req.pipe(up);
  });
  await new Promise((r) => web.listen(webPort, '127.0.0.1', r));
  let browser = null;
  const stop = async () => { await browser?.close().catch(() => undefined); apiProc.kill('SIGTERM'); web.close(); await pool.end().catch(() => undefined); };
  try {
    let up = false; for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(API + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(500); }
    if (!up) throw new Error('API did not boot: ' + apiLog.split('\n').slice(-8).join(' | '));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    if (fonts && routeFonts) await routeFonts(ctx, fonts);
    const login = await ctx.request.post(WEB + '/auth/login', { data: { portal: 'tenant', salonCode: salon, identifier: process.env.OWNER_EMAIL || 'owner@pilotsalon.com', password: process.env.OWNER_PASSWORD || 'ChangeMe!Owner1' } });
    const lj = await login.json().catch(() => ({}));
    if (lj?.outcome === 'BRANCH_SELECTION_REQUIRED') await ctx.request.post(WEB + '/auth/select-branch', { data: { branchId: B } });
    if (!login.ok()) throw new Error(`owner login ${login.status()}`);
    const setLanguage = async (lang) => { const r = await ctx.request.put(WEB + '/pos/me/language', { data: { language: lang } }); if (!r.ok()) throw new Error(`PUT /pos/me/language ${r.status()}`); };
    return { WEB, API, ctx, browser, setLanguage, tenantId: T, branchId: B, pool, stop, apiLog: () => apiLog };
  } catch (e) { await stop(); throw e; }
}
