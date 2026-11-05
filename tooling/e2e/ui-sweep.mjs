#!/usr/bin/env node
// ui-sweep.mjs — Wave 4 (Oct 13 2026): every screen of the salon-facing frontends in a REAL Chromium against the REAL API
// (apps/api/dist) and PostgreSQL. Per app it opens every route (or, for the state-navigated mobile apps, crawls every
// screen reachable from the nav), clicks every safe control on it, and records:
//   console errors, uncaught exceptions, failed requests, API responses >= 400 (and 5xx separately), blank screens,
//   "undefined" / "NaN" / "[object Object]" / "Something went wrong" text, horizontal overflow at the target viewport,
//   dead controls (a click that changes nothing: no DOM mutation, no request, no navigation), and slow screens.
// Screenshots per screen go to SHOTS. The summary JSON goes to OUT.
//
// Usage (apps/api built; each app built with `vite build`, or SERVE=src for the static ones):
//   DATABASE_URL=postgres://postgres@localhost:5432/<scratch> node tooling/e2e/ui-sweep.mjs pos-web owner-web …
// env: API_PORT (3191) WEB_PORT (3291) SHOTS OUT CHROMIUM_PATH ONLY=<substr,…> NO_CLICKS=1 SALON_CODE ROLE=<role key>
// The database must hold the seeded pilot salon (seed.ts + seed-demo.ts + seed-local-accounts.ts); the sweep adds the
// device rows it needs (a paired customer display, a Go Check-In kiosk, a manager login) and removes them at the end.
// Never point it at production.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const require = createRequire(ROOT + 'apps/api/package.json');
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { chromium } = createRequire(ROOT + 'package.json')('playwright');

const DB = process.env.DATABASE_URL; if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error('refusing a non-local database'); process.exit(2); }
const API_PORT = Number(process.env.API_PORT || 3191), WEB_PORT = Number(process.env.WEB_PORT || 3291);
const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'ui-sweep-')); mkdirSync(SHOTS, { recursive: true });
const OUT = process.env.OUT || join(SHOTS, 'ui-sweep-result.json');
const SALON = process.env.SALON_CODE || 'PILOT01';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const NO_CLICKS = process.env.NO_CLICKS === '1';
const SETTLE = Number(process.env.SETTLE_MS || 1800);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APPS = process.argv.slice(2).length ? process.argv.slice(2) : ['pos-web', 'owner-web', 'tech-web', 'customer-web', 'manager-pay-web', 'customer-display', 'go-check-in-kiosk', 'booking-public'];

// a click on any of these could sign the user out, destroy data or move money for real — the sweep leaves them alone
// (money moves are driven on purpose by the pilot / money-chain proofs on the fake processor)
const DANGER = /log ?out|sign ?out|delete|remove|archive|revoke|suspend|deactivat|disable|void|refund|charge|pay now|^pay\b|collect|complete (checkout|sale|payment)|process payment|take payment|tap to pay|send|submit|approve|reject|deny|lock|unpair|reset|clear all|cancel (appointment|booking|ticket)|no.?show|close (drawer|day|period)|end (shift|day)|clock (in|out)|finali[sz]e|export|download|print|import|upload|purchase|buy|subscribe|upgrade|checkout|mark (paid|done)|service done|start service|call next|assign|transfer|merge|block|ban|confirm|save|publish|activate|enable|pair|forget|switch (salon|branch)|i'?m here|check.?in\b|maintenance|restart|reboot|identify|break|time off/i;

const REPETITIVE = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|^\d{1,2}$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d/i;

// ── the per-app plan ───────────────────────────────────────────────────────────────────────────────────────────────────
const routesFrom = (file, re) => [...readFileSync(ROOT + file, 'utf8').matchAll(re)].map((m) => m[1]);
const APP = {
  'pos-web': { dir: 'apps/pos-web/dist', viewport: { width: 1920, height: 1080 }, mode: 'routes',
    routes: () => [...new Set([...routesFrom('apps/pos-web/src/App.tsx', /<Route path="([^"*]+)"/g).map((p) => '/' + p.replace(/^\//, '')),
      ...routesFrom('apps/pos-web/src/shell/tenant-nav.tsx', /route: '([^']+)'/g)])].filter((p) => p !== '/' && !p.startsWith('/oauth')),
    logins: ['owner', 'frontdesk'] },
  'customer-web': { dir: 'apps/customer-web/dist', viewport: { width: 430, height: 932 }, mode: 'routes',
    routes: () => routesFrom('apps/customer-web/src/App.tsx', /<Route path="([^"*]+)"/g).filter((p) => !/^\/(login|register|signup|forgot|reset)/.test(p)), logins: ['customer'] },
  'owner-web': { dir: 'apps/owner-web/dist', viewport: { width: 430, height: 932 }, mode: 'crawl', logins: ['owner'] },
  'tech-web': { dir: 'apps/tech-web/dist', viewport: { width: 430, height: 932 }, mode: 'crawl', logins: ['tech'] },
  'manager-pay-web': { dir: 'apps/manager-pay-web/dist', viewport: { width: 430, height: 932 }, mode: 'crawl', logins: ['manager'] },
  'customer-display': { dir: 'apps/customer-display/dist', viewport: { width: 1920, height: 1080 }, mode: 'crawl', logins: ['display'], allow: /check.?in/i },
  'go-check-in-kiosk': { dir: 'apps/go-check-in-kiosk/dist', index: 'index.html', viewport: { width: 1080, height: 1920 }, mode: 'crawl', logins: ['kiosk'], allow: /check.?in/i },
  'booking-public': { dir: 'apps/booking-public', index: 'index.html', viewport: { width: 430, height: 932 }, mode: 'crawl', logins: ['guest'] },
};

// ── database: the salon, its rows for path params, and the sweep's own device/login rows ──────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const salon = (await q(`select t.id, t.tenant_code from tenants t where t.tenant_code = $1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found — seed it first`); process.exit(2); }
const T = salon.id;
const B = (await q(`select id from branches where tenant_id = $1 and deleted_at is null order by created_at limit 1`, [T]))[0].id;
const one = async (s, p = [T]) => (await q(s, p))[0] ?? {};
const PARAM = {
  technicianId: (await one(`select id from technicians where tenant_id = $1 order by created_at limit 1`)).id,
  appointmentId: (await one(`select id from pos_tech_appointments where tenant_id = $1 order by created_at limit 1`)).id,
  ticketId: (await one(`select id from tickets where tenant_id = $1 order by created_at limit 1`)).id,
  salonId: T,
  customerId: (await one(`select id from customers where tenant_id = $1 and user_id is not null limit 1`)).id,
  slug: (await one(`select public_slug as s from technicians where tenant_id = $1 and public_slug is not null limit 1`).catch(() => ({}))).s,
};
PARAM.id = PARAM.appointmentId;
// per app: the Customer App's salon is the BRANCH (the public salon id) and its social ids are the customer's user id
const PARAM_APP = {
  'customer-web': { salonId: B, customerId: (await one(`select user_id as u from customers where tenant_id = $1 and user_id is not null limit 1`)).u,
    appointmentId: (await one(`select a.id from pos_tech_appointments a join customers c on c.id = a.customer_id where a.tenant_id = $1 and c.user_id is not null limit 1`)).id },
};
// routes whose :id is not an appointment: the row they need, or the route is skipped
const ID_FOR = [
  [/^\/deals\//, `select id from deals where tenant_id = $1 limit 1`], [/^\/follow-ups\//, `select id from customer_follow_ups where tenant_id = $1 limit 1`],
  [/^\/community\//, `select id from community_posts where tenant_id = $1 limit 1`], [/voice-transcription\/transcripts\//, `select id from ai_voice_transcripts where tenant_id = $1 limit 1`],
];
const idFor = async (route) => { for (const [re, sqlText] of ID_FOR) if (re.test(route)) return (await one(sqlText).catch(() => ({}))).id ?? null; return PARAM.id; };

const PW = 'UiSweep!' + randomUUID().slice(0, 8);
const created = { users: [], displays: [], kiosks: [] };
const LOGIN = {
  owner: { portal: 'tenant', salonCode: SALON, identifier: process.env.OWNER_EMAIL || 'owner@pilotsalon.com', password: process.env.OWNER_PASSWORD || 'ChangeMe!Owner1' },
  frontdesk: { portal: 'tenant', salonCode: SALON, identifier: 'frontdesk@pilotsalon.com', password: 'FrontDesk123!' },
  tech: { portal: 'tenant', salonCode: SALON, identifier: 'tech@pilotsalon.com', password: 'Tech123!' },
  customer: { portal: 'customer', identifier: 'customer@pilotsalon.com', password: 'Customer123!' },
};
const ownerPortal = { ...LOGIN.owner, portal: 'owner', salonCode: undefined };
// a manager login for the manager payment app (the seeds have none)
{
  const id = randomUUID(), email = `ui-sweep-manager-${id.slice(0, 6)}@pilotsalon.test`;
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled) values ($1,$2,$3,'Mona','Manager','Mona Manager',$4,$5,'active','MANAGER',false)`, [id, T, B, email, await hashPassword(PW)]);
  created.users.push(id);
  LOGIN.manager = { portal: 'tenant', salonCode: SALON, identifier: email, password: PW };
}
// a paired customer display and a Go Check-In kiosk in the branch
const DISPLAY_TOKEN = randomBytes(32).toString('base64url');
{
  const id = randomUUID();
  await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values ($1,$2,$3,'UI Sweep Display','web_display','paired',$4)`, [id, T, B, createHash('sha256').update(DISPLAY_TOKEN).digest('hex')]);
  created.displays.push(id);
}
const KIOSK_SLUG = 'ui-sweep-' + randomUUID().slice(0, 8);
{
  const id = randomUUID();
  await q(`insert into go_checkin_devices (id, tenant_id, branch_id, device_name, checkin_slug, status) values ($1,$2,$3,'UI Sweep Kiosk',$4,'active')`, [id, T, B, KIOSK_SLUG]);
  created.kiosks.push(id);
}

// Go Check-In on for the salon (kiosk + the display's check-in), restored at the end
const checkinBefore = (await q(`select * from tenant_checkin_settings where tenant_id = $1`, [T]))[0] ?? null;
await q(`insert into tenant_checkin_settings (tenant_id, enabled) values ($1, true) on conflict (tenant_id) do update set enabled = true`, [T]);

// ── servers: the API, and one static+proxy origin per app (same-origin, as production serves it) ─────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
  AI_BOOKING_LINK_SECRET: 'ui-sweep-booking-link-secret-0123456789',   // booking-public: a signed link for the sweep's salon
  PRIVATE_FILES_ROOT: mkdtempSync(join(tmpdir(), 'uisw-priv-')), MEDIA_ROOT: mkdtempSync(join(tmpdir(), 'uisw-media-')), AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' };
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'PROCESS_ROLE']) delete env[k];
let apiLog = '';
const apiProc = process.env.API_URL ? null : spawn('node', ['dist/main.js'], { cwd: ROOT + 'apps/api', env, stdio: ['ignore', 'pipe', 'pipe'] });
apiProc?.stdout.on('data', (c) => { apiLog += c; }); apiProc?.stderr.on('data', (c) => { apiLog += c; });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.mp4': 'video/mp4' };
let current = null;   // { dir, index }
const web = createServer((req, res) => {
  const u = new URL(req.url, WEB);
  const file = normalize(join(ROOT, current.dir, decodeURIComponent(u.pathname)));
  const isFile = u.pathname !== '/' && file.startsWith(join(ROOT, current.dir)) && existsSync(file) && statSync(file).isFile();
  const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (isFile || (wantsHtml && !u.pathname.startsWith('/api/'))) {
    const f = isFile ? file : join(ROOT, current.dir, current.index || 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(f)); return;
  }
  const up = httpRequest({ host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* */ } });
  req.pipe(up);
});
web.on('upgrade', (req, sock, head) => { const s = netConnect(API_PORT, '127.0.0.1', () => { s.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'); s.write(head); s.pipe(sock); sock.pipe(s); }); s.on('error', () => sock.destroy()); });
await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r));

const cleanup = async () => {
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  web.close();
  if (checkinBefore) await q(`update tenant_checkin_settings set enabled = $2 where tenant_id = $1`, [T, checkinBefore.enabled]).catch(() => undefined);
  else await q(`delete from tenant_checkin_settings where tenant_id = $1`, [T]).catch(() => undefined);
  await q(`delete from customer_display_devices where id = any($1::uuid[])`, [created.displays]).catch(() => undefined);
  await q(`delete from go_checkin_devices where id = any($1::uuid[])`, [created.kiosks]).catch(() => undefined);
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices', 'authorization_denials']) await q(`delete from ${t} where user_id = any($1::uuid[])`, [created.users]).catch(() => undefined);
  await q(`delete from users where id = any($1::uuid[])`, [created.users]).catch(() => undefined);
  await client.end();
};

// ── checks on a screen ─────────────────────────────────────────────────────────────────────────────────────────────────
const BAD_TEXT = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /something went wrong/i, /\bnull\b(?! ?(island|safe))/, /Invalid Date/, /\$-?NaN|\$undefined/, /failed to (load|fetch)/i, /cannot read propert/i];
const screenFlags = async (page, viewport) => page.evaluate(({ bad, vw }) => {
  const text = document.body?.innerText ?? '';
  const flags = [];
  for (const src of bad) { const m = text.match(new RegExp(src.s, src.f)); if (m) { const i = text.indexOf(m[0]); flags.push(`text "${m[0]}" in “${text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ')}”`); } }
  if (text.trim().length < 15) flags.push('blank screen');
  const sw = document.scrollingElement?.scrollWidth ?? 0;
  if (sw > vw + 2) flags.push(`horizontal overflow ${sw}px > ${vw}px`);
  return flags;
}, { bad: BAD_TEXT.map((r) => ({ s: r.source, f: r.flags })), vw: viewport.width });

// the clickable controls on the screen, as stable descriptors (re-located by text + ordinal each time)
const controls = async (page) => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0; };
  const els = [...document.querySelectorAll('button, [role="tab"], [role="button"], a[href], [onclick], summary, [role="menuitem"], [role="switch"]')].filter((el) => vis(el) && !el.closest('[aria-hidden="true"]'));
  const seen = new Map();
  return els.map((el) => {
    const aria = el.getAttribute('aria-label');
    // the first line of the text: hasText matches textContent, which joins a row's title and subtitle with no space
    const label = (aria || (el.innerText || '').split('\n').map((x) => x.trim()).find(Boolean) || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const key = el.tagName + '|' + label; const n = seen.get(key) ?? 0; seen.set(key, n + 1);
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    const external = !!href && /^(https?:|mailto:|tel:)/.test(href) && !href.startsWith(location.origin);
    return { tag: el.tagName, label, aria: !!aria, n, disabled, href, external, inNav: !!el.closest('nav, aside, [role="navigation"], [role="tablist"]') };
  });
});
const SEL = 'button, [role="tab"], [role="button"], [onclick], summary, [role="menuitem"], [role="switch"]';
const locate = (page, c) => c.aria ? page.locator(`${c.tag.toLowerCase() === 'a' ? 'a[href]' : SEL}`).and(page.locator(`[aria-label="${c.label.replace(/"/g, '\\"')}"]`)).nth(c.n)
  : page.locator(c.tag.toLowerCase() === 'a' ? 'a[href]' : SEL).filter({ hasText: c.label || undefined }).nth(c.n);

// ── per-app session setup ──────────────────────────────────────────────────────────────────────────────────────────────
async function signIn(ctx, page, app, who) {
  if (who === 'display') {
    await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => localStorage.setItem('aps.customerDisplay.deviceToken', t), DISPLAY_TOKEN);
    return { ok: true, start: '/' };
  }
  if (who === 'kiosk') return { ok: true, start: `/go-check-in/${KIOSK_SLUG}` };
  if (who === 'guest') {
    const { signBookingContext } = require(ROOT + 'apps/api/dist/ai-booking/ai-booking-signed-context.js');
    const t = signBookingContext({ tenantId: T, branchId: B, source: 'ONLINE_BOOKING' }, { secret: env.AI_BOOKING_LINK_SECRET, ttlSeconds: 3600 });
    return { ok: true, start: `/?t=${encodeURIComponent(t)}&s=${T}` };
  }
  const body = app === 'owner-web' ? ownerPortal : LOGIN[who];
  const r = await ctx.request.post(WEB + '/auth/login', { data: body });
  const j = await r.json().catch(() => ({}));
  if (j?.outcome === 'BRANCH_SELECTION_REQUIRED') { await ctx.request.post(WEB + '/auth/select-branch', { data: { branchId: B } }); }
  return { ok: r.ok(), status: r.status(), outcome: j?.outcome, start: '/' };
}

process.on('SIGTERM', async () => { result.fatal = 'SIGTERM'; try { writeFileSync(OUT, JSON.stringify(result, null, 1)); await browser?.close(); await cleanup(); } finally { process.exit(1); } });

// ── the sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const result = { startedAt: new Date().toISOString(), apps: {} };
let browser;
const timer = setTimeout(async () => { console.error('ui-sweep: timed out'); result.fatal = 'timeout'; writeFileSync(OUT, JSON.stringify(result, null, 1)); await cleanup().catch(() => undefined); process.exit(1); }, Number(process.env.TIMEOUT_MIN || 120) * 60_000);
try {
  if (apiProc) { let up = false; for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(API + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(500); }
    if (!up) throw new Error('API did not boot: ' + apiLog.split('\n').slice(-8).join(' | ')); }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const app of APPS) {
    const cfg = APP[app]; if (!cfg) { console.error('unknown app ' + app); continue; }
    current = { dir: cfg.dir, index: cfg.index };
    if (!existsSync(join(ROOT, cfg.dir, cfg.index || 'index.html'))) { result.apps[app] = { fatal: `not built: ${cfg.dir}` }; continue; }
    for (const who of (process.env.ROLE ? [process.env.ROLE] : cfg.logins)) {
      const key = `${app}:${who}`; const out = { screens: [], skipped: [] }; result.apps[key] = out;
      const ctx = await browser.newContext({ viewport: cfg.viewport, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      const ev = []; let where = '';
      let reqCount = 0;
      page.on('console', (m) => { if (m.type() === 'error') ev.push({ where, k: 'console.error', t: m.text().slice(0, 300) }); });
      page.on('pageerror', (e) => ev.push({ where, k: 'pageerror', t: String(e.message).slice(0, 300) }));
      page.on('request', () => { reqCount++; });
      page.on('requestfailed', (rq) => { const f = rq.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(f)) ev.push({ where, k: 'requestfailed', t: `${rq.method()} ${rq.url().replace(WEB, '')} ${f}` }); });
      page.on('response', (rs) => { const u = rs.url(); if (rs.status() >= 400 && u.startsWith(WEB) && !/\.(js|css|png|svg|ico|woff2?)$/.test(u)) ev.push({ where, k: 'http' + rs.status(), t: `${rs.request().method()} ${u.replace(WEB, '')}` }); });
      const s = await signIn(ctx, page, app, who);
      out.signIn = s;
      if (!s.ok) { out.fatal = `sign-in failed ${JSON.stringify(s)}`; await ctx.close(); continue; }
      const visit = async (label, go) => {
        where = label; const before = ev.length; const t0 = Date.now();
        try { await go(); } catch (e) { ev.push({ where, k: 'goto', t: String(e.message).slice(0, 160) }); }
        await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);   // live screens hold an SSE stream open
        await sleep(SETTLE);
        const ms = Date.now() - t0;
        const flags = await screenFlags(page, cfg.viewport).catch((e) => [`flags failed ${e.message}`]);
        const shot = `${app}-${who}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`;
        await page.screenshot({ path: join(SHOTS, shot) }).catch(() => undefined);
        const heading = await page.locator('h1, h2').first().innerText({ timeout: 500 }).catch(() => '');
        const rec = { screen: label, url: page.url().replace(WEB, ''), heading: heading.slice(0, 80), ms, flags, events: ev.slice(before), clicks: [], shot };
        out.screens.push(rec);
        process.stdout.write(`${key} ${label} ev=${rec.events.length} flags=${flags.length} ${ms}ms\n`);
        return rec;
      };
      // clicks on the current screen: each safe control once; a click that changes nothing is a dead control
      const sigOf = () => page.evaluate(() => (document.querySelector('h1, h2')?.textContent ?? '') + '|' + (document.body?.innerText ?? '').replace(/[\d$.,:%]+/g, '#').slice(0, 400)).catch(() => '');
      const clickAll = async (rec, restore, { skipNav = false, restoreOnChange = false } = {}) => {
        if (NO_CLICKS) return [];
        let sig0 = restoreOnChange ? await sigOf() : '';
        // routes mode: the nav and in-app links are visited as routes of their own — click the screen's own controls
        const list = (await controls(page)).filter((c) => !c.disabled && !c.external && !(c.label && DANGER.test(c.label) && !(cfg.allow && cfg.allow.test(c.label))) && !(skipNav && (c.inNav || (c.tag === 'A' && c.href?.startsWith('/'))))
          && !REPETITIVE.test(c.label || ''));   // a day / number picker: one of them is enough
        const firstOfPicker = (await controls(page)).find((c) => !c.disabled && REPETITIVE.test(c.label || ''));
        if (firstOfPicker) list.push(firstOfPicker);
        const opened = [];
        for (const c of list.slice(0, Number(process.env.MAX_CLICKS || 40))) {
          if (!c.label && c.tag !== 'A') continue;
          where = `${rec.screen} › ${c.label || c.href}`;
          const before = ev.length; const url0 = page.url(); const req0 = reqCount;
          await page.evaluate(() => { window.__muts = 0; window.__mo?.disconnect(); window.__mo = new MutationObserver((m) => { window.__muts += m.length; }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
          let clicked = true;
          try { await locate(page, c).click({ timeout: 2500 }); } catch { clicked = false; }
          if (!clicked) continue;
          await sleep(700);
          const muts = await page.evaluate(() => window.__muts ?? 0).catch(() => -1);
          const moved = page.url() !== url0;
          const dialog = await page.locator('[role="dialog"], [aria-modal="true"], .modal, dialog[open]').count().catch(() => 0);
          const flags = await screenFlags(page, cfg.viewport).catch(() => []);
          const r = { control: c.label || c.href, tag: c.tag, muts, requests: reqCount - req0, moved, dialog: dialog > 0, flags: flags.filter((f) => !rec.flags.includes(f)), events: ev.slice(before) };
          if (muts === 0 && reqCount === req0 && !moved) r.dead = true;
          if (moved) opened.push(page.url().replace(WEB, ''));
          rec.clicks.push(r);
          if (r.flags.length || dialog > 0) await page.screenshot({ path: join(SHOTS, rec.shot.replace(/\.png$/, `__${(c.label || 'link').replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}.png`)) }).catch(() => undefined);
          // put the screen back (a state-navigated app changes screens without changing the URL: compare the text)
          await page.keyboard.press('Escape').catch(() => undefined);
          const sig1 = restoreOnChange ? await sigOf() : sig0;
          if (sig1 !== sig0) r.changedScreen = true;
          if (moved || sig1 !== sig0 || (await page.locator('[role="dialog"], [aria-modal="true"], dialog[open]').count().catch(() => 0)) > 0) { await restore(); sig0 = restoreOnChange ? await sigOf() : ''; }
        }
        return opened;
      };

      if (cfg.mode === 'routes') {
        let routes = cfg.routes();
        if (ONLY) routes = routes.filter((r) => ONLY.some((o) => r.includes(o)));
        for (const r0 of routes) {
          const P = { ...PARAM, ...(PARAM_APP[app] ?? {}), id: await idFor(r0) };
          const missing = (r0.match(/:([A-Za-z]+)/g) || []).map((m) => m.slice(1)).filter((p) => !P[p]);
          if (missing.length) { out.skipped.push(`${r0} (no row for ${missing.join(', ')})`); continue; }
          const r = r0.replace(/:([A-Za-z]+)/g, (_, p) => P[p]);
          const go = () => page.goto(WEB + r, { waitUntil: 'load', timeout: 20000 });
          const rec = await visit(r0, go);
          await clickAll(rec, async () => { await go().catch(() => undefined); await sleep(SETTLE); }, { skipNav: true });
        }
      } else {
        // crawl: from the start screen, every nav control opens a screen; each new screen (by heading + url) is visited
        // and its controls clicked; screens are reached again by replaying the path from a fresh load
        const seen = new Set(); const queued = new Set(); const queue = [[]];
        // (no networkidle wait here: a live screen holds its SSE stream open, so it would always run to the timeout)
        const replay = async (path) => { await page.goto(WEB + s.start, { waitUntil: 'load', timeout: 20000 }); await sleep(SETTLE);
          for (const c of path) { await locate(page, c).click({ timeout: 3000 }); await sleep(900); } };
        const MAX_SCREENS = Number(process.env.MAX_SCREENS || 70), DEPTH = Number(process.env.DEPTH || 3);
        while (queue.length && out.screens.length < MAX_SCREENS) {
          const path = queue.shift();
          const label = path.length ? path.map((c) => c.label || c.href).join(' › ') : 'start';
          const rec = await visit(label, () => replay(path));
          const sig = `${rec.url}|${rec.heading}|${(await page.locator('body').innerText().catch(() => '')).slice(0, 120)}`;
          if (seen.has(sig) && path.length) { out.screens.pop(); continue; }
          seen.add(sig);
          if (path.length >= DEPTH) { await clickAll(rec, () => replay(path).catch(() => undefined), { restoreOnChange: true, skipNav: true }); continue; }
          const list = (await controls(page)).filter((c) => !c.disabled && !c.external && c.label && !(DANGER.test(c.label) && !(cfg.allow && cfg.allow.test(c.label))));
          await clickAll(rec, () => replay(path).catch(() => undefined), { restoreOnChange: true, skipNav: path.length > 0 });   // the nav is crawled from the start screen
          // a control that changed the screen (navigation, a new heading) becomes a screen of its own
          for (const cl of rec.clicks) {
            if (cl.dead || !(cl.changedScreen || cl.moved)) continue;
            const c = list.find((x) => (x.label || x.href) === cl.control); if (!c) continue;
            if (path.some((p) => p.label === c.label) || queued.has(c.label)) continue;   // the same nav control from another screen
            queued.add(c.label); queue.push([...path, c]);
          }
        }
      }
      await ctx.close();
    }
  }
} catch (e) { result.fatal = String(e.stack || e); }
finally {
  clearTimeout(timer);
  result.apiErrors = apiLog.split('\n').filter((l) => !/ LOG /.test(l) && /\bERROR\b|Unhandled|TypeError|ReferenceError|does not exist|violates/i.test(l)).slice(0, 300);
  writeFileSync(OUT, JSON.stringify(result, null, 1));
  await browser?.close().catch(() => undefined);
  await cleanup().catch(() => undefined);
  // the headline: per app, screens, events, flags, dead controls
  for (const [k, v] of Object.entries(result.apps)) {
    if (v.fatal) { console.log(`${k}: FATAL ${v.fatal}`); continue; }
    const evs = v.screens.flatMap((s) => [...s.events, ...s.clicks.flatMap((c) => c.events)]);
    const flags = v.screens.flatMap((s) => [...s.flags, ...s.clicks.flatMap((c) => c.flags)]);
    const dead = v.screens.flatMap((s) => s.clicks.filter((c) => c.dead));
    console.log(`${k}: ${v.screens.length} screens, ${v.screens.reduce((n, s) => n + s.clicks.length, 0)} clicks, ${evs.length} events (${evs.filter((e) => /^http5/.test(e.k)).length} 5xx, ${evs.filter((e) => /^http4/.test(e.k)).length} 4xx, ${evs.filter((e) => e.k === 'pageerror').length} exceptions), ${flags.length} flags, ${dead.length} dead controls, ${v.skipped.length} skipped`);
  }
  console.log(`api log errors: ${result.apiErrors.length}; result: ${OUT}; shots: ${SHOTS}`);
  process.exit(result.fatal ? 1 : 0);
}
