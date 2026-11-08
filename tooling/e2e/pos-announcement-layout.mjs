#!/usr/bin/env node
// pos-announcement-layout.mjs — Super Admin POS Top-Bar Announcement mandate (Oct 22 2026) §140–§164 in a REAL browser:
// the BUILT POS (apps/pos-web/dist) against the REAL API (apps/api/dist) and PostgreSQL. Notices are written through the
// real PlatformNoticeService with the real OutboxWriter, so what reaches the page travels the production path:
// service → outbox → publisher → realtime projection → SSE → useRealtime → snapshot refetch. The page is NEVER reloaded
// between steps (§26: "no refresh").
//
// Proves, without reload: empty slot when there is nothing; a short message appears; an edit to ~220 characters shows two
// lines; ~500 characters clamps with More, and the panel holds the full text; another salon's notice never shows; a
// pause removes it. Then at 1920×1080, 1600×900, 1366×768 and 1280×800 (§104–§110): no horizontal page scroll, Search
// still usable, the clock / bell / profile visible and not overlapped by the announcement, at most two text lines.
// Screenshots go to $SHOTS. Test notices are archived at the end (history is never deleted).
//
//   DATABASE_URL=postgres://postgres@localhost:5432/<scratch with PILOT01> node tooling/e2e/pos-announcement-layout.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const apiReq = createRequire(ROOT + 'apps/api/package.json');
const pg = apiReq('pg');
const { Kysely, PostgresDialect } = apiReq('kysely');
const { OutboxWriter } = apiReq('@aipowersalon/events');
const { PlatformNoticeService } = apiReq('@aipowersalon/communications');
const { chromium } = createRequire(ROOT + 'package.json')('playwright');

const DB = process.env.DATABASE_URL; if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error('refusing a non-local database'); process.exit(2); }
const API_PORT = Number(process.env.API_PORT || 3193), WEB_PORT = Number(process.env.WEB_PORT || 3293);
const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
const DIST = join(ROOT, 'apps/pos-web/dist');
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'pos-announcement-')); mkdirSync(SHOTS, { recursive: true });
const SALON = process.env.SALON_CODE || 'PILOT01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(DIST, 'index.html'))) { console.error('build the POS first: (cd apps/pos-web && npx vite build)'); process.exit(2); }

const pool = new pg.Pool({ connectionString: DB, max: 4 });
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
const q = async (s, p = []) => (await pool.query(s, p)).rows;
const salon = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found — seed it first`); process.exit(2); }
const T = salon.id;
const B = (await q(`select id from branches where tenant_id = $1 and deleted_at is null order by created_at limit 1`, [T]))[0].id;
// another salon for the isolation check (a scratch one when the database holds only the pilot)
let OTHER = (await q(`select id from tenants where id <> $1 and status = 'active' order by created_at limit 1`, [T]))[0]?.id;
let scratchTenant = null;
if (!OTHER) {
  OTHER = randomUUID(); scratchTenant = OTHER;
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'PA Other Salon','PA Other Salon',$2,$3,'active')`, [OTHER, 'pa-other-' + OTHER.slice(0, 6), 'PAO' + OTHER.slice(0, 4).toUpperCase()]);
}

const svc = new PlatformNoticeService(db, { outbox: new OutboxWriter(), audit: null });
const ADMIN = { userId: 'e2e00000-0000-4000-8000-0000000000aa', role: 'SUPER_ADMIN', permissions: ['super_admin.communications.view', 'super_admin.communications.manage'] };
const made = [];
// englishOnly: the layout proof is about the English bar; a critical notice needs a reviewed Vietnamese version or English only (WP-F §57)
const create = async (body) => { const n = await svc.create(ADMIN, { type: 'update', priority: 'normal', dismissible: true, requiresAcknowledgement: false, englishOnly: true, ...body }); made.push(n.id); return n; };
const publish = async (n) => svc.publish(ADMIN, n.id, { expectedVersion: n.version, confirm: true });
// anything left live from an earlier run would change what the bar shows
await q(`update platform_notices set lifecycle_status = 'archived', archived_at = now(), version = version + 1 where lifecycle_status in ('published','paused') and message like '[pa-e2e]%'`);

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const env = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
  PRIVATE_FILES_ROOT: mkdtempSync(join(tmpdir(), 'pa-priv-')), MEDIA_ROOT: mkdtempSync(join(tmpdir(), 'pa-media-')), AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' };
for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'PROCESS_ROLE', 'METRICS_TOKEN']) delete env[k];   // /metrics open in development (§116 check)
env.EVENT_PUBLISHER_ENABLED = 'on';   // development defaults it OFF; the proof needs the real outbox → SSE path
let apiLog = '';
const apiProc = spawn('node', ['dist/main.js'], { cwd: ROOT + 'apps/api', env, stdio: ['ignore', 'pipe', 'pipe'] });
apiProc.stdout.on('data', (c) => { apiLog += c; }); apiProc.stderr.on('data', (c) => { apiLog += c; });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const web = createServer((req, res) => {
  const u = new URL(req.url, WEB);
  const file = normalize(join(DIST, decodeURIComponent(u.pathname)));
  const isFile = u.pathname !== '/' && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
  const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (isFile || wantsHtml) {
    const f = isFile ? file : join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f)); return;
  }
  const up = httpRequest({ host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* */ } });
  req.pipe(up);
});
await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r));

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
let browser;
const cleanup = async () => {
  for (const id of made) {
    const r = (await q(`select version, lifecycle_status from platform_notices where id = $1`, [id]))[0];
    if (r && r.lifecycle_status !== 'archived') await svc.archive(ADMIN, id, { expectedVersion: Number(r.version) }).catch(() => undefined);
  }
  if (scratchTenant) await q(`delete from tenants where id = $1`, [scratchTenant]).catch(() => undefined);
  await browser?.close().catch(() => undefined);
  apiProc.kill('SIGTERM'); web.close(); await db.destroy().catch(() => undefined);
};

/** What the bar and its neighbours look like right now. */
const measure = (page) => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }; };
  const header = document.querySelector('header');
  const bar = document.querySelector('[data-testid="platform-announcement"]');
  const text = document.querySelector('[data-testid="platform-announcement-text"]');
  const lh = text ? parseFloat(getComputedStyle(text).lineHeight) || 18 : 0;
  const search = header?.querySelector('.search') ?? null;
  const ctl = [...(header?.querySelectorAll('.topclock, .ic-btn') ?? [])].map(box).filter((b) => b?.visible);
  const prof = header ? [...header.children].at(-1) : null;
  return { vw: innerWidth, sw: document.scrollingElement.scrollWidth, header: box(header), bar: box(bar), text: box(text), lines: text ? Math.round(text.getBoundingClientRect().height / lh) : 0,
    clamped: text ? text.scrollHeight > text.clientHeight + 2 : false, search: box(search), controls: ctl, profile: box(prof),
    more: [...document.querySelectorAll('[data-testid="platform-announcement"] .pa-btn')].map((b) => b.textContent.trim()) };
});
const overlaps = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
const waitFor = async (page, fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }); return true; } catch { return false; } };
// read what is on screen NOW (a locator's innerText would wait for the element to appear)
const textOf = (page) => page.evaluate(() => document.querySelector('[data-testid="platform-announcement-text"]')?.textContent ?? '');

const TIMER = setTimeout(async () => { console.error('timed out'); console.log(results.join('\n')); await cleanup(); process.exit(1); }, 9 * 60_000);
try {
  let up = false; for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(API + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(500); }
  if (!up) throw new Error('API did not boot: ' + apiLog.split('\n').slice(-8).join(' | '));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message)));
  const login = await ctx.request.post(WEB + '/auth/login', { data: { portal: 'tenant', salonCode: SALON, identifier: process.env.OWNER_EMAIL || 'owner@pilotsalon.com', password: process.env.OWNER_PASSWORD || 'ChangeMe!Owner1' } });
  const lj = await login.json().catch(() => ({}));
  if (lj?.outcome === 'BRANCH_SELECTION_REQUIRED') await ctx.request.post(WEB + '/auth/select-branch', { data: { branchId: B } });
  check('owner signs in to the POS', login.ok(), `status ${login.status()} ${lj?.outcome ?? ''}`);
  let snapshots = 0; page.on('response', (r) => { if (r.url().includes('/pos/platform-announcements/active')) snapshots++; });
  await page.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('header').first().waitFor({ timeout: 20000 });
  await waitFor(page, () => !!document.querySelector('[data-testid="platform-announcement-slot"]'));
  await sleep(1500);
  const navs = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });

  // §140 none → nothing renders, the header is as before
  let m = await measure(page);
  check('§114 no message: the slot is empty (no bar, no gap content)', !m.bar, JSON.stringify(m.bar));
  check('startup snapshot was requested', snapshots >= 1, `${snapshots} request(s)`);
  await page.screenshot({ path: join(SHOTS, '00-empty-1920.png') });

  // a short message arrives in realtime
  const SHORT = '[pa-e2e] Scheduled update tonight 11 PM – 11:15 PM.';
  let n = await create({ audience: 'selected_tenants', tenantIds: [T], message: SHORT });
  const before = snapshots;
  n = await publish(n);
  const appeared = await waitFor(page, (s) => document.querySelector('[data-testid="platform-announcement-text"]')?.textContent?.includes(s), SHORT, 20000);
  check('§26 a published message appears without a refresh', appeared, `snapshot refetches ${snapshots - before}`);
  m = await measure(page);
  check('§30 a short message takes one line', m.lines === 1, `lines ${m.lines}`);
  await page.screenshot({ path: join(SHOTS, '01-short-1920.png') });

  // an edit to ~220 characters → two lines
  const MID = '[pa-e2e] Card terminal maintenance: between 3:00 PM and 3:20 PM today card payments may take a few seconds longer to approve. No action is needed.';
  n = await svc.update(ADMIN, n.id, { expectedVersion: n.version, message: MID });
  const edited = await waitFor(page, (s) => document.querySelector('[data-testid="platform-announcement-text"]')?.textContent?.includes(s.slice(0, 60)), MID, 20000);
  await sleep(400); m = await measure(page);
  check('§63 an edit of a live message reaches the POS without a refresh', edited);
  check('§31 a ~150-character message wraps to two lines at 1920 (no clamp)', m.lines === 2 && !m.clamped, `lines ${m.lines} clamped ${m.clamped} chars ${MID.length}`);
  await page.screenshot({ path: join(SHOTS, '02-two-lines-1920.png') });

  // ~500 characters → clamp + More, panel has the full text
  const LONG = '[pa-e2e] Important platform update for every salon. ' + 'Tonight between 11:00 PM and 11:30 PM Eastern we are upgrading the payment and booking systems. Check-in, the queue and appointments keep working; card payments may pause for up to two minutes during the switch. Please finish any open checkouts before 11:00 PM, keep the POS signed in, and if a card payment does not approve, wait one minute and try again. Reports for today will be complete by midnight. '.repeat(1).trim();
  n = await svc.update(ADMIN, n.id, { expectedVersion: n.version, message: LONG });
  await waitFor(page, (s) => document.querySelector('[data-testid="platform-announcement-text"]')?.textContent?.includes(s), 'Important platform update', 20000);
  await sleep(500); m = await measure(page);
  check('§32 a ~500-character message is clamped to two lines', m.lines <= 2 && m.clamped, `lines ${m.lines} clamped ${m.clamped} chars ${LONG.length}`);
  check('§33 the clamped message offers More', m.more.some((t) => /more/i.test(t)), JSON.stringify(m.more));
  await page.locator('[data-testid="platform-announcement"] .pa-btn').filter({ hasText: /more/i }).first().click();
  const panel = page.locator('[data-testid="platform-announcement-panel"]');
  const full = await panel.innerText().catch(() => '');
  check('§34 More opens the full message', full.replace(/\s+/g, ' ').includes(LONG.replace(/\s+/g, ' ').slice(-80)));
  await page.screenshot({ path: join(SHOTS, '03-long-more-open-1920.png') });
  // Oct 27 — §106 the panel is a modal dialog with a focus trap; Escape returns focus to More
  const dlg = await page.evaluate(() => { const p = document.querySelector('[data-testid="platform-announcement-panel"]'); return { modal: p?.getAttribute('aria-modal'), role: p?.getAttribute('role'), focusInside: !!p && p.contains(document.activeElement) }; });
  check('§106 More opens role="dialog" aria-modal="true" with focus moved inside', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.focusInside, JSON.stringify(dlg));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
  check('§106 Tab / Shift+Tab never leave the open panel (focus trap)', await page.evaluate(() => !!document.querySelector('[data-testid="platform-announcement-panel"]')?.contains(document.activeElement)));
  await page.keyboard.press('Escape');
  check('§37 Escape closes the panel', await waitFor(page, () => !document.querySelector('[data-testid="platform-announcement-panel"]'), null, 3000));
  check('§106 …and focus returns to More', await waitFor(page, () => /more/i.test(document.activeElement?.textContent ?? '') && !!document.activeElement?.closest('[data-testid="platform-announcement"]'), null, 3000));
  // §106 contrast measured on the rendered bar (computed colours), and §34 the icon is the library's, not a hand-drawn path
  const tone = await page.evaluate(() => {
    const rgb = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const v = rgb(c).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bar = document.querySelector('[data-testid="platform-announcement"]'); const cs = getComputedStyle(bar);
    const icon = bar.querySelector('svg[data-icon]');
    return { text: ratio(cs.color, cs.backgroundColor), icon: icon ? ratio(getComputedStyle(icon).color || icon.getAttribute('color'), cs.backgroundColor) : 0, lib: !!icon };
  });
  check('§106 the bar\'s text is ≥ 4.5:1 and its type icon ≥ 4.5:1 on the tone background (computed)', tone.text >= 4.5 && tone.icon >= 4.5, `text ${tone.text.toFixed(2)} icon ${tone.icon.toFixed(2)}`);
  check('§34 the type icon is the POS icon library\'s (react-icons), not a hand-drawn SVG', tone.lib);

  // another salon's notice never reaches this POS
  const SECRET = '[pa-e2e] Other salon only — must never show here.';
  let o = await create({ audience: 'selected_tenants', tenantIds: [OTHER], message: SECRET, priority: 'critical', dismissible: false });
  o = await publish(o);
  await sleep(5000);
  const html = await page.content();
  check('§164 another salon\'s critical notice is not shown (tenant isolation)', !html.includes('Other salon only'));

  // §104–§110 responsive, with the long message live
  for (const [w, h] of [[1920, 1080], [1920, 1032], [1920, 952], [1920, 945], [1600, 900], [1366, 768], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(700);
    m = await measure(page);
    const tag = `${w}×${h}`;
    check(`${tag} no horizontal page scroll`, m.sw <= m.vw + 1, `${m.sw} > ${m.vw}`);
    check(`${tag} Search stays usable (box ≥180 px incl. its button, §111)`, (m.search?.w ?? 0) >= 180, `search ${Math.round(m.search?.w ?? 0)}px`);
    check(`${tag} the announcement sits between Search and the clock`, !!m.bar && m.search && m.bar.x >= m.search.r - 1 && m.controls.length > 0 && m.bar.r <= Math.min(...m.controls.map((c) => c.x)) + 1,
      `bar ${Math.round(m.bar?.x)}–${Math.round(m.bar?.r)} search ends ${Math.round(m.search?.r)} controls start ${Math.round(Math.min(...m.controls.map((c) => c.x)))}`);
    check(`${tag} clock, bell and profile visible, not overlapped`, m.controls.length >= 2 && m.profile?.visible && !m.controls.some((c) => overlaps(c, m.bar)) && !overlaps(m.profile, m.bar), `${m.controls.length} controls`);
    const minText = w <= 1280 ? 150 : 200;   // the smaller desktop reads two lines / clamp + More (reference layout)
    check(`${tag} the message itself keeps readable room (≥${minText} px of text)`, (m.text?.w ?? 0) >= minText, `text ${Math.round(m.text?.w ?? 0)}px`);
    check(`${tag} at most two lines of text inside the header`, m.lines <= 2 && m.bar.b <= m.header.b + 1, `lines ${m.lines}`);
    await page.screenshot({ path: join(SHOTS, `04-long-${w}x${h}.png`) });
    if (process.env.DEBUG_LAYOUT) console.log(tag, JSON.stringify(await page.evaluate(() => [...document.querySelector('header').children].map((c) => [c.className.slice(0, 40), Math.round(c.getBoundingClientRect().width)]))));
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // pause removes it, live
  const cur = (await q(`select version from platform_notices where id = $1`, [n.id]))[0];
  await svc.pause(ADMIN, n.id, { expectedVersion: Number(cur.version) });
  const gone = await waitFor(page, () => !document.querySelector('[data-testid="platform-announcement"]'), null, 20000);
  check('§18 pause removes the message from the POS without a refresh', gone);
  await page.screenshot({ path: join(SHOTS, '05-paused-1920.png') });
  const shown = (txt, ms = 20000) => waitFor(page, (t) => !!document.querySelector('[data-testid="platform-announcement-text"]')?.textContent?.includes(t), txt, ms);
  const hidden = (txt, ms = 20000) => waitFor(page, (t) => !document.querySelector('[data-testid="platform-announcement-text"]')?.textContent?.includes(t), txt, ms);
  const version = async (id) => Number((await q(`select version from platform_notices where id = $1`, [id]))[0].version);

  // §151 resume redisplays it
  await svc.resume(ADMIN, n.id, { expectedVersion: await version(n.id) });
  check('§151 resume shows it again without a refresh', await shown('Important platform update'));
  await svc.archive(ADMIN, n.id, { expectedVersion: await version(n.id) });
  check('§20 archive removes it without a refresh', await hidden('Important platform update'));

  // §149 a scheduled message does not appear early, then appears at its start time (the POS timer on nextChangeAt)
  const SCHED = '[pa-e2e] Scheduled notice — appears at its start time.';
  let sc = await create({ audience: 'selected_tenants', tenantIds: [T], message: SCHED });
  const startAt = new Date(Date.now() + 20_000).toISOString();
  sc = await svc.publish(ADMIN, sc.id, { expectedVersion: sc.version, publishNow: false, startsAt: startAt, confirm: true });
  await sleep(3000);
  const early = await textOf(page);
  check('§149 a scheduled message is not shown before its start', Date.now() < Date.parse(startAt) && !early.includes('Scheduled notice'), `${Date.now() - Date.parse(startAt)} ms vs start; bar: ${early.slice(0, 80)}`);
  check('§149 …and appears at its start time without a refresh', await shown('Scheduled notice', 45000));

  // §148 expiry: a message ending in ~12 s disappears on its own
  const EXP = '[pa-e2e] Short-lived notice — ends by itself.';
  let ex = await create({ audience: 'selected_tenants', tenantIds: [T], message: EXP, priority: 'high', endsAt: new Date(Date.now() + 12_000).toISOString() });
  ex = await publish(ex);
  check('§148 an expiring message is shown while live (high sorts first)', await shown('Short-lived notice'));
  check('§148 …and disappears when its end passes, without a refresh', await hidden('Short-lived notice', 30000));

  // §152 dismissal: the dismiss control hides it for this employee, and it stays hidden on the next snapshot
  await page.locator('[data-testid="platform-announcement"] .pa-x').click();
  check('§152 dismiss hides a dismissible message', await hidden('Scheduled notice', 8000));

  // §153 / §154 a non-dismissible message with "I understand": no ✕; acknowledging records it and keeps it visible
  const ACK = '[pa-e2e] Please read: new card rules from Monday.';
  let ak = await create({ audience: 'all_tenants', message: ACK, type: 'warning', dismissible: false, requiresAcknowledgement: true });
  ak = await publish(ak);
  await shown('new card rules');
  check('§153 a non-dismissible message has no dismiss control', (await page.locator('[data-testid="platform-announcement"] .pa-x').count()) === 0);
  await page.locator('[data-testid="platform-announcement"] .pa-btn.pa-strong').click();
  const ackRows = await waitFor(page, () => !document.querySelector('[data-testid="platform-announcement"] .pa-btn.pa-strong'), null, 8000);
  const rec = await q(`select tenant_id, user_id, content_version, created_at from platform_notice_receipts where notice_id = $1 and kind = 'acknowledged'`, [ak.id]);
  check('§154 "I understand" is recorded per tenant / user / content version', ackRows && rec.length === 1 && rec[0].tenant_id === T && !!rec[0].user_id && Number(rec[0].content_version) === 1, JSON.stringify(rec.map((r) => ({ t: r.tenant_id === T, u: !!r.user_id, v: r.content_version }))));

  // §158 published while the POS is offline → shown after it reconnects (snapshot on reconnect / safety sync)
  await svc.archive(ADMIN, ak.id, { expectedVersion: await version(ak.id) });
  await hidden('new card rules');
  await ctx.setOffline(true); await sleep(1500);
  const OFF = '[pa-e2e] Published while this POS was offline.';
  let off = await create({ audience: 'selected_tenants', tenantIds: [T], message: OFF });
  off = await publish(off);
  await sleep(3000);
  await ctx.setOffline(false);
  check('§158 a message published during a disconnect appears after reconnect', await shown('while this POS was offline', 75000));
  check('the page was never reloaded', navs.length === 0, navs.join(', '));

  // §159 a reload shows it again from the authoritative snapshot
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('§159 after a POS reload the active message is back from the snapshot', await shown('while this POS was offline'));

  // §160 the announcement API failing never breaks the POS
  await page.route(/\/pos\/platform-announcements\//, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL"}' }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('header').first().waitFor({ timeout: 20000 }); await sleep(2500);
  m = await measure(page);
  const body = await page.locator('main, .main').first().innerText().catch(() => '');
  check('§160 with the announcement API failing, the POS header and screen still work (slot empty, no error shown)', !m.bar && m.controls.length >= 2 && body.length > 50 && !/something went wrong/i.test(body));
  await page.unroute(/\/pos\/platform-announcements\//);
  await page.screenshot({ path: join(SHOTS, '06-api-failing-1920.png') });
  // §116 the failure was COUNTED on the server's metrics (the POS posts it to /client-telemetry/events), not only console-logged
  let failCount = 0;
  for (let i = 0; i < 20 && failCount < 1; i++) {
    const metrics = await (await fetch(API + '/metrics')).text().catch(() => '');
    const line = metrics.split('\n').find((l) => l.startsWith('aipowersalon_client_events_total{') && l.includes('app="pos"') && l.includes('event="platform_announcement_snapshot_failed"'));
    failCount = line ? Number(line.trim().split(/\s+/).pop()) : 0;
    if (failCount < 1) await sleep(500);
  }
  check('§116 the failed snapshot is counted: aipowersalon_client_events_total{app="pos",event="platform_announcement_snapshot_failed"} ≥ 1', failCount >= 1, `count ${failCount}`);
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  // §164 no leakage into the API's logs: no announcement text (ours or another salon's) appears in anything the API printed
  await sleep(500);
  const leaked = [SHORT, MID, LONG, SECRET, SCHED, EXP, ACK, OFF].filter((t) => apiLog.includes(t.slice(0, 40)) || apiLog.includes(t.replace('[pa-e2e] ', '').slice(0, 30)));
  check('§164 the API log never contains an announcement\'s text (incl. the other salon\'s critical notice)', leaked.length === 0 && apiLog.length > 0, leaked.length ? `leaked: ${leaked.map((t) => t.slice(9, 40)).join(' | ')}` : `${apiLog.length} log bytes scanned`);
} catch (e) {
  check('harness ran to the end', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  clearTimeout(TIMER);
  await cleanup();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
