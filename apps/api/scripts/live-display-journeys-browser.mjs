#!/usr/bin/env node
// live-display-journeys-browser.mjs — 23-inch dual-screen spec, Unit 8: the two journeys of §117–§118 end to end, the
// isolation tests of §119–§120, and reconnect / restart / cleanup (§100–§104, §107), in REAL browsers (Chromium) against
// the real API and PostgreSQL. Nothing is stubbed: the guest uses the display, the front desk uses the POS screens and the
// POS's own API (the calls its Queue / Serving / Service Done screens make).
//
//   §117 APPOINTMENT: phone → appointment found (two services, Olivia) → I'm Here → THIS branch's queue, linked to the
//        appointment → the POS Queue screen shows the guest without a reload → service → service done → checkout →
//        Send to Display: the ad is gone, her ticket takes the right panel → a POS discount updates the display → she
//        taps a tip on the display (it lands on the POS ticket) → payment → the receipt question → payment complete →
//        3 s → advertising, with nothing of her left (checked on EVERY recorded frame, §107)
//   §118 WALK-IN: phone → no appointment → first name, two services and an add-on, Lisa preferred → check in → the queue
//        (branch prices, the add-on attached, Lisa) → service → checkout on the display → the display RESTARTS mid-checkout
//        and comes back to her checkout, never an ad (§103) → the API goes down and comes back: the display keeps the
//        checkout and hears the next POS change (§102) → payment → advertising (§104: a restart now is check-in + ads)
//   §100 a second display in the branch (dedicated to another register) never shows either customer
//   §119 another salon's display never plays this salon's ads (and ours never plays theirs) — in the browser
//   §120 an ad for Main only: Main's display plays it, the proof branch's display never does
//   §130 "no full-screen refresh / shading": the 23-inch screen is never torn down between check-in, checkout and ads
// Requires: apps/api built; apps/customer-display and apps/pos-web built.
//   DATABASE_URL=postgres://… CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/live-display-journeys-browser.mjs
// The API runs with a DUMMY Twilio account so the receipt question is asked; the guest answers "No receipt", so nothing
// is sent. Creates a proof branch (removed at the end with everything in it), proof ads (deleted), proof displays
// (deleted); a second salon "Live Journey Proof Other Salon" is kept for the next run, its ad and display removed.
// Restores the settings rows it touched. Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3038, DISPLAY_PORT = 4181, POS_PORT = 4182;
const API = `http://127.0.0.1:${API_PORT}`, DISPLAY = `http://127.0.0.1:${DISPLAY_PORT}`, POS = `http://127.0.0.1:${POS_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'd23-journeys-shots-')); mkdirSync(SHOTS, { recursive: true });
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'd23-journeys-media-'));
// the proof branch's zone: New York unless PROOF_TZ names another (to run outside New York's working hours — the proof
// needs a working day ahead at the branch, and every count it makes uses the branch's own zone)
const TZ_NAME = process.env.PROOF_TZ || 'America/New_York';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const info = (s) => results.push(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T_START = Date.now();
const phase = (name) => process.stderr.write(`[${((Date.now() - T_START) / 1000).toFixed(1)}s] ${name}\n`);
const money = (c) => '$' + (c / 100).toFixed(2);
const local = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
};
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const clock = (m) => { const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const NOW = local();
if (NOW.minutes > 21 * 60 || NOW.minutes < 6 * 60) { console.error(`it is ${clock(NOW.minutes)} at the branch — run the proof between 6 am and 9 pm ${TZ_NAME} (an appointment and a working shift are needed)`); process.exit(2); }
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
function png(w, h, seed) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; p.data[i] = (x * 5 + seed * 40) & 255; p.data[i + 1] = (y * 2 + seed * 70) & 255; p.data[i + 2] = ((x ^ y) + seed * 90) & 255; p.data[i + 3] = 255; }
  return PNG.sync.write(p);
}

// ── seed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const salon = (await q(`select t.id as tenant_id, b.id as branch_id, b.name as branch_name from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, MAIN = salon.branch_id;
// earlier runs: their proof branches, displays and ads removed
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Journey Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
await q(`delete from customer_display_devices where device_name like 'Live Journey Proof%'`);
await q(`delete from display_ads where name like 'Live Journey Proof%'`);
const CATS = ['customer-display-devices', 'receipts-branding', 'customer-display-ads'];
const settingsBefore = await q(`select * from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]);
await q(`delete from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]);   // the salon's defaults
const checkinBefore = (await q(`select * from tenant_checkin_settings where tenant_id = $1`, [T]))[0] ?? null;
await q(`insert into tenant_checkin_settings (tenant_id, enabled, confirmation_timeout_seconds) values ($1, true, 5)
  on conflict (tenant_id) do update set enabled = true, confirmation_timeout_seconds = 5, appointment_checkin_enabled = true, walkin_checkin_enabled = true, service_selection_enabled = true,
  technician_preference_enabled = true, tenant_phone_lookup_enabled = true, show_wait_estimate = true, auto_send_to_queue = true, require_front_desk_approval = false`, [T]);

const B = randomUUID(), stamp = String(Date.now()).slice(-5);
const BRANCH_NAME = `Live Journey Proof ${stamp}`;
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active',$4)`, [B, T, BRANCH_NAME, TZ_NAME]);
// BUILD_PLAN Phase 9 (explicit branch grants CONFINE): grant the seeded owner the proof branch as a manager would (removed
// with the branch by the proof cleanup) — without it select-branch answers 404 (Oct 22 2026, tooling/ci/live-proofs.sh).
{ const oid = (await q(`select id from users where tenant_id = $1 and lower(email) = lower($2) limit 1`, [T, EMAIL]))[0]?.id;
  if (!oid) { console.error(`owner ${EMAIL} not found in salon ${SALON}`); process.exit(2); }
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'owner') on conflict do nothing`, [T, B, oid]); }
const CAT = { mani: randomUUID(), pedi: randomUUID(), add: randomUUID() };
await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values ($1,$4,$5,'Manicure',1), ($2,$4,$5,'Pedicure',2), ($3,$4,$5,'Add-ons',3)`, [CAT.mani, CAT.pedi, CAT.add, T, B]);
const S = { gel: randomUUID(), spa: randomUUID(), art: randomUUID() };
const PRICE = { gel: 5000, spa: 6000, art: 1000 };
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, sort_order, status) values
  ($1,$4,$5,$6,'Gel Manicure',45,$9,1,'active'), ($2,$4,$5,$7,'Spa Pedicure',50,$10,1,'active'), ($3,$4,$5,$8,'Nail Art',15,$11,1,'active')`,
  [S.gel, S.spa, S.art, T, B, CAT.mani, CAT.pedi, CAT.add, PRICE.gel, PRICE.spa, PRICE.art]);
const TECH = { olivia: randomUUID(), lisa: randomUUID() };
for (const [k, first] of [['olivia', 'Olivia'], ['lisa', 'Lisa']]) {
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'Journeyproof',$4 || ' Journeyproof','active')`, [TECH[k], T, B, first]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,$5,$6,true)`, [T, B, TECH[k], NOW.weekday, hhmm(Math.max(0, NOW.minutes - 120)), hhmm(Math.min(23 * 60 + 59, NOW.minutes + 300))]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4, now() - interval '1 hour', null, 'active')`, [T, B, TECH[k], NOW.date]);
}
for (const [k, svc] of [['olivia', S.gel], ['olivia', S.art], ['lisa', S.gel], ['lisa', S.spa], ['lisa', S.art]]) {
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, TECH[k], svc]);
}
// Sophia's appointment today: a Gel Manicure and Nail Art with Olivia
const SOPHIA = randomUUID(), SOPHIA_PHONE = '55506' + rnd(5);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Sophia','Journeyproof','Sophia Journeyproof',$4,$5)`,
  [SOPHIA, T, B, '+1' + SOPHIA_PHONE, `(${SOPHIA_PHONE.slice(0, 3)}) ${SOPHIA_PHONE.slice(3, 6)}-${SOPHIA_PHONE.slice(6)}`]);
const APPT_AT = Math.ceil((NOW.minutes + 15) / 15) * 15, APPT = randomUUID();
await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
  values ($1,$2,$3,$4,$5,'Sophia Journeyproof',$6,'phone',$7,$8,$9,$10,60,'confirmed','not_required')`,
  [APPT, T, B, TECH.olivia, SOPHIA, '+1' + SOPHIA_PHONE, JSON.stringify([
    { serviceId: S.gel, serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: PRICE.gel },
    { serviceId: S.art, serviceName: 'Nail Art', durationMinutes: 15, priceCents: PRICE.art, isAddon: true, parentServiceId: S.gel },
  ]), NOW.date, hhmm(APPT_AT), hhmm(APPT_AT + 60)]);
// registers and displays: the shared display (where Send to Display goes), a second display dedicated to another
// register (§100: it must never show these customers), one in Main (§120), one in the other salon (§119)
const REG2 = randomUUID();
await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$2,$3,'Live Journey Register 2')`, [REG2, T, B]);
const DEV = { shared: randomUUID(), reg2: randomUUID(), main: randomUUID(), other: randomUUID() };
const TOK = { shared: randomBytes(32).toString('base64url'), reg2: randomBytes(32).toString('base64url'), main: randomBytes(32).toString('base64url'), other: randomBytes(32).toString('base64url') };
await q(`insert into customer_display_devices (id, tenant_id, branch_id, pos_station_id, device_name, device_type, pairing_status, device_token_hash) values
  ($1,$3,$4,null,'Live Journey Proof','web_display','paired',$6), ($2,$3,$4,$5,'Live Journey Proof (Register 2)','web_display','paired',$7)`, [DEV.shared, DEV.reg2, T, B, REG2, sha(TOK.shared), sha(TOK.reg2)]);
await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values ($1,$2,$3,'Live Journey Proof (Main)','web_display','paired',$4)`, [DEV.main, T, MAIN, sha(TOK.main)]);
// the other salon: kept between runs; its own published ad, its images in object storage
let T2 = (await q(`select id from tenants where tenant_code = 'LJPX'`))[0]?.id;
if (!T2) { T2 = randomUUID(); await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Live Journey Proof Other Salon','Live Journey Proof Other Salon','live-journey-proof-other','LJPX','active')`, [T2]); }
let B2 = (await q(`select id from branches where tenant_id = $1 and deleted_at is null`, [T2]))[0]?.id;
if (!B2) { B2 = randomUUID(); await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Other Main','active',$3)`, [B2, T2, TZ_NAME]); }
await q(`delete from display_ads where tenant_id = $1`, [T2]);
await q(`delete from display_ad_media where tenant_id = $1`, [T2]);
await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values ($1,$2,$3,'Live Journey Proof (Other Salon)','web_display','paired',$4)`, [DEV.other, T2, B2, sha(TOK.other)]);
const M_OTHER = randomUUID(), AD_OTHER = randomUUID(), otherKey = (v) => `display-ads/${T2}/${M_OTHER}-${v}.png`;
const variants = {};
for (const [v, w, h] of [['large', 1080, 1620], ['medium', 720, 1080], ['thumb', 213, 320]]) {
  const bytes = png(w, h, 9); const file = join(MEDIA_ROOT, otherKey(v)); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
  variants[v] = { key: otherKey(v), url: `/media/${otherKey(v)}`, width: w, height: h, bytes: bytes.length, mime: 'image/png' };
}
await q(`insert into display_ad_media (id, tenant_id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants) values ($1,$2,'image/png',1080,1620,$3,$4,$5,$6,$7)`,
  [M_OTHER, T2, variants.large.bytes, Object.values(variants).reduce((a, v) => a + v.bytes, 0), sha(M_OTHER), variants.large.key, JSON.stringify(variants)]);
await q(`insert into display_ads (id, tenant_id, name, media_id, status, published_at, headline) values ($1,$2,'Live Journey Proof — other salon',$3,'published',now(),'Other Salon Special')`, [AD_OTHER, T2, M_OTHER]);

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), MEDIA_ROOT, AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
  TWILIO_ACCOUNT_SID: 'ACliveproof0000000000000000000000', TWILIO_AUTH_TOKEN: 'not-a-real-token', TWILIO_FROM: '+15550000000' };
let apiErr = ''; let apiProc = null;
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const startApi = async () => { apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] }); apiProc.stderr.on('data', (c) => { apiErr += c; }); return up(API + '/health/ready'); };
const stopApi = async () => { const p = apiProc; if (!p) return; await new Promise((r) => { p.once('exit', r); p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } r(); }, 8000); }); apiProc = null; };
const preview = (app, port) => spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: new URL(`../../${app}/`, import.meta.url).pathname, env: { ...process.env, VITE_API_BASE: API }, stdio: ['ignore', 'ignore', 'pipe'] });
const displayProc = preview('customer-display', DISPLAY_PORT);
const posProc = preview('pos-web', POS_PORT);
const j = async (r) => { const t = await r.text(); try { return { status: r.status, ok: r.ok, body: JSON.parse(t) }; } catch { return { status: r.status, ok: r.ok, body: t }; } };

let browser; const adsCreated = []; const mediaCreated = [];
let restored = false;
const restore = async () => {
  if (restored) return; restored = true;
  for (const id of adsCreated) await q(`delete from display_ads where tenant_id = $1 and id = $2`, [T, id]).catch(() => undefined);
  await q(`delete from display_ad_media where tenant_id = $1 and id = any($2)`, [T, mediaCreated]).catch(() => undefined);
  await q(`delete from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]).catch(() => undefined);
  for (const r of settingsBefore) await q(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json, updated_by_user_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.id, r.tenant_id, r.branch_id, r.category, JSON.stringify(r.settings_json), r.updated_by_user_id, r.created_at, r.updated_at]).catch(() => undefined);
  await q(`delete from tenant_checkin_settings where tenant_id = $1`, [T]).catch(() => undefined);
  if (checkinBefore) { const cols = Object.keys(checkinBefore); await q(`insert into tenant_checkin_settings (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => checkinBefore[c])).catch(() => undefined); }
  await q(`delete from customer_display_devices where id = any($1)`, [[DEV.main, DEV.other]]).catch(() => undefined);
  await q(`delete from display_ads where tenant_id = $1`, [T2]).catch(() => undefined);
  await q(`delete from display_ad_media where tenant_id = $1`, [T2]).catch(() => undefined);
  const gone = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  info(`proof branch removed: ${gone.removed}${gone.kept.length ? ` (rows kept by design or constraint: ${gone.kept.join(', ')})` : ''}`);
  await browser?.close().catch(() => undefined);
  await stopApi(); displayProc.kill('SIGTERM'); posProc.kill('SIGTERM');
};
const watchdog = setTimeout(async () => {
  check('the proof finished within 12 minutes', false, 'watchdog fired');
  await Promise.race([restore(), sleep(20000)]).catch(() => undefined);
  console.log(results.join('\n'));
  try { apiProc?.kill('SIGKILL'); displayProc.kill('SIGKILL'); posProc.kill('SIGKILL'); } catch { /* */ }
  process.exit(1);
}, 12 * 60_000);
const shot = async (page, name) => { try { await page.screenshot({ path: join(SHOTS, name) }); } catch { /* best effort */ } };

// every display page records each frame it renders (on any DOM change): the time, the right panel's mode, the right
// panel's text and the whole page's text — §107 is then checked on EVERY frame, not on a screenshot
const RECORDER = () => {
  try { if (!sessionStorage.getItem('proof.seeded')) { localStorage.setItem('aps.customerDisplay.deviceToken', window.__proofToken); sessionStorage.setItem('proof.seeded', '1'); } } catch { /* */ }
  window.__frames = []; window.__rootSeq = 0;
  const snap = () => {
    const p = document.querySelector('[data-testid="right-panel"]');
    const r = document.querySelector('[data-testid="display-23"]');
    if (r && !r.__proofId) r.__proofId = ++window.__rootSeq;
    window.__frames.push({ t: Date.now(), mode: p?.getAttribute('data-mode') ?? null, right: p ? p.innerText : '', page: document.body ? document.body.innerText : '', root: r ? r.__proofId : 0 });
  };
  const start = () => { snap(); new MutationObserver(snap).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-mode'] }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
};
async function displayPage(token, label) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(`window.__proofToken = ${JSON.stringify(token)};`);
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  let navigations = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  const stateFetches = []; page.on('request', (r) => { if (r.url().includes('/customer-display/device/current')) stateFetches.push(Date.now()); });
  const mediaUrls = []; page.on('response', (r) => { if (r.url().includes('/media/')) mediaUrls.push(`${r.status()} ${r.url()}`); });
  await page.goto(DISPLAY + '/');
  await page.getByTestId('display-23').waitFor({ timeout: 30000 });
  return { ctx, page, errors, navigations: () => navigations, mediaUrls, stateFetches };
}
const frames = (page) => page.evaluate(() => window.__frames);
const ready = (page) => page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '5'); return !!b && !b.disabled; }, null, { timeout: 30000 });
const wake = async (page) => { if (await page.locator('[data-testid="fullscreen-ads"]').count()) { await page.mouse.click(960, 540); await page.locator('[data-testid="fullscreen-ads"]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined); } };
const type = async (page, digits) => { for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click(); };

try {
  check('API booted (health/ready)', await startApi());
  check('display and POS served (vite preview, same-origin proxy to the API)', (await up(DISPLAY + '/')) && (await up(POS + '/')));
  info(`proof branch "${BRANCH_NAME}" (${TZ_NAME}, now ${clock(NOW.minutes)}); Sophia's appointment ${clock(APPT_AT)}`);
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── the owner's session in the proof branch, for the POS API and the ads ─────────────────────────────────────────────
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  let cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c])); for (const c of (sel.headers.getSetCookie?.() ?? []).map((x) => x.split(';')[0])) jar.set(c.split('=')[0], c); cookie = [...jar.values()].join('; ');
  const pos = async (method, path, body, extra = {}) => j(await fetch(API + path, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...extra }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }));
  check('the owner signs in and works in the proof branch', login.ok && sel.ok, `login ${login.status}, select-branch ${sel.status}`);

  // ── §119–§120: the salon's ads, made in the POS — one for every branch, one for Main only ─────────────────────────────
  phase('ads');
  const A = '/pos/marketing/display-ads';
  const fd = new FormData();
  for (const [k, w, h] of [['original', 1080, 1620], ['large', 1080, 1620], ['medium', 720, 1080], ['thumb', 213, 320]]) fd.append(k, new Blob([png(w, h, k.length)], { type: 'image/png' }), `${k}.png`);
  fd.append('focalX', '0.5'); fd.append('focalY', '0.4');
  const media = await pos('POST', A + '/media', fd);
  if (media.body?.id) mediaCreated.push(media.body.id);
  const adAll = await pos('POST', A, { name: 'Live Journey Proof — every branch', mediaId: media.body.id, headline: 'Journey Proof Pedicure Week' });
  const adMain = await pos('POST', A, { name: 'Live Journey Proof — Main only', mediaId: media.body.id, headline: 'Journey Proof Main Only', allBranches: false, branchIds: [MAIN] });
  for (const ad of [adAll, adMain]) if (ad.body?.id) adsCreated.push(ad.body.id);
  const pubAll = await pos('POST', `${A}/${adAll.body.id}/publish`, { expectedVersion: adAll.body.version ?? 1 });
  const pubMain = await pos('POST', `${A}/${adMain.body.id}/publish`, { expectedVersion: adMain.body.version ?? 1 });
  check('the owner uploads a picture and publishes two ads in the POS: every branch, and Main only', media.ok && adAll.ok && adMain.ok && pubAll.ok && pubMain.ok, `${media.status} ${adAll.status} ${adMain.status} ${pubAll.status} ${pubMain.status}`);
  const playlist = async (tok) => (await j(await fetch(API + '/customer-display/device/ads', { headers: { 'x-device-token': tok } }))).body;
  const [plB, plM, plO] = [await playlist(TOK.shared), await playlist(TOK.main), await playlist(TOK.other)];
  const ids = (pl) => (pl?.ads ?? []).map((a) => a.id);
  check('§120 the proof branch\'s display: the every-branch ad — never the Main-only one', ids(plB).includes(adAll.body.id) && !ids(plB).includes(adMain.body.id), ids(plB).map((x) => x === adAll.body.id ? 'every-branch' : x === adMain.body.id ? 'MAIN-ONLY' : 'other').join(','));
  check('§120 Main\'s display: both', ids(plM).includes(adAll.body.id) && ids(plM).includes(adMain.body.id));
  check('§119 the other salon\'s display: only ITS ad; ours never — and ours never carries its ad', JSON.stringify(ids(plO)) === JSON.stringify([AD_OTHER]) && !ids(plB).includes(AD_OTHER) && !ids(plM).includes(AD_OTHER));

  // ── the screens: the proof branch's display, the second display, Main's, the other salon's; the front desk's POS ─────
  phase('screens');
  const D = await displayPage(TOK.shared, 'display');
  const D2 = await displayPage(TOK.reg2, 'register-2 display');
  const DM = await displayPage(TOK.main, 'main display');
  const DO = await displayPage(TOK.other, 'other-salon display');
  const dp = D.page;
  const right = dp.locator('[data-testid="right-panel"]');
  await ready(dp);
  const pctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const pp = await pctx.newPage();
  const pErrors = []; pp.on('pageerror', (e) => pErrors.push(String(e)));
  await pp.goto(POS + '/');
  await pp.fill('#aps-identifier', EMAIL); await pp.fill('#aps-password', PASSWORD); await pp.fill('#aps-store', SALON);
  await pp.click('button[type="submit"]');
  await pp.getByRole('button', { name: new RegExp(`^${BRANCH_NAME}`) }).first().click({ timeout: 20000 });
  await pp.waitForTimeout(1200);
  await pp.goto(POS + '/queue');
  await pp.waitForTimeout(1500);
  check('the front desk signs in to the POS and opens the Queue for the proof branch', !(await pp.locator('#aps-password').count()), pp.url());

  // ════ §117 THE APPOINTMENT CUSTOMER ════════════════════════════════════════════════════════════════════════════════
  phase('§117 appointment');
  await wake(dp);
  await type(dp, SOPHIA_PHONE);
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('Appointment Found').waitFor({ timeout: 15000 });
  const card = (await dp.locator('.d23-appt').innerText()).replace(/\s+/g, ' ');
  check(`appointment found: "Sophia", "Today at ${clock(APPT_AT)}", Gel Manicure with Olivia + Nail Art with Olivia — first names only`, card.includes('Sophia') && card.includes(`Today at ${clock(APPT_AT)}`) && card.includes('Gel Manicure with Olivia') && card.includes('Nail Art with Olivia') && !card.includes('Journeyproof'), card.slice(0, 160));
  await shot(dp, '01-appointment-found.png');
  const tHere = Date.now();
  await dp.getByRole('button', { name: "I'm Here" }).click();
  await dp.locator('.d23-result').waitFor({ timeout: 15000 });
  const r0 = (await dp.locator('.d23-result').innerText()).replace(/\s+/g, ' ');
  const qi1 = (await q(`select id, branch_id, appointment_id, customer_id, status, requested_services from pos_queue_items where tenant_id = $1 and appointment_id = $2`, [T, APPT]))[0];
  const appt1 = (await q(`select status from pos_tech_appointments where id = $1`, [APPT]))[0];
  check('I\'m Here → checked in at THIS branch, on THIS visit, in THIS branch\'s queue', appt1?.status === 'checked_in' && qi1?.branch_id === B && qi1?.customer_id === SOPHIA && qi1?.status === 'waiting', `appointment ${appt1?.status}; queue ${qi1 ? `${qi1.status}, branch ${qi1.branch_id === B ? 'proof' : 'OTHER'}` : 'missing'}`);
  check('the footer: "You\'re checked in!", Thanks, Sophia, the queue engine\'s wait band', /You’re checked in!/.test(r0) && r0.includes('Thanks, Sophia') && /\d+–\d+ min/.test(r0), r0.slice(0, 120));
  // the POS Queue screen hears it — no reload
  const onPos = await pp.getByText('Sophia Journeyproof').first().waitFor({ timeout: 20000 }).then(() => Date.now() - tHere, () => -1);
  check('the POS Queue screen shows Sophia without a reload (realtime)', onPos >= 0, onPos >= 0 ? `${onPos} ms after I'm Here` : 'not shown');
  await shot(pp, '02-pos-queue.png');
  // service → service done → checkout: the calls the POS's Queue, Serving and Service Done screens make
  const step = async (label, method, path, body) => { const r = await pos(method, path, body); if (!r.ok) info(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); return r; };
  const toCheckout = async (queueItemId, technicianId) => {
    const a = await step('assign', 'POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId });
    const s = await step('start', 'POST', `/pos/queue/items/${queueItemId}/start-service`);
    const servingId = s.body?.servingTicketId || queueItemId;
    const m = await step('mark done', 'POST', `/pos/serving/tickets/${servingId}/mark-service-done`);
    const sd = await step('to service done', 'POST', `/pos/serving/tickets/${servingId}/send-to-service-done`);
    const sdId = sd.body?.serviceDoneTicketId || servingId;
    const qc = await step('quality', 'POST', `/pos/service-done/tickets/${sdId}/quality-check`, { result: 'approved' });
    const co = await step('to checkout', 'POST', `/pos/service-done/tickets/${sdId}/send-to-checkout`);
    return { ok: [a, s, m, sd, qc, co].every((r) => r.ok), ticketId: co.body?.checkoutTicketId || sdId, statuses: [a, s, m, sd, qc, co].map((r) => r.status).join(' ') };
  };
  const flow1 = await toCheckout(qi1.id, TECH.olivia);
  check('the front desk: assign Olivia → service → service done → quality check → checkout', flow1.ok, flow1.statuses);
  const TK1 = flow1.ticketId;
  // checkout on the POS screen → Send to Display
  await pp.goto(POS + '/checkout');
  const pcard = pp.getByTestId('customer-display-card');
  await pcard.waitFor({ timeout: 20000 });
  await pp.getByText('Sophia Journeyproof').first().click();
  await pp.waitForTimeout(1200);
  const tSend = Date.now();
  await pcard.getByRole('button', { name: 'Send to Display' }).click();
  await dp.locator('[data-testid="right-panel"][data-mode="checkout"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const sendMs = Date.now() - tSend;
  const ck = (await right.innerText()).replace(/\s+/g, ' ');
  check('Send to Display: the ad is GONE and Sophia\'s ticket takes the right panel — both services with Olivia, the branch\'s prices', (await right.getAttribute('data-mode')) === 'checkout' && (await right.locator('.aps-adslide').count()) === 0 && ck.includes('Hi Sophia') && ck.includes('Gel Manicure') && ck.includes('Nail Art') && ck.includes('Olivia') && ck.includes('$50.00') && ck.includes('$10.00'), `${sendMs} ms · ${ck.slice(0, 140)}`);
  check('…and the check-in stays usable on the left (§6)', (await dp.getByText('Check In Here').count()) === 1);
  // §100: while her checkout is on the shared display, the branch's other display and the other salon's display restart —
  // each asks the server for ITS state at that moment (a restart, not an event they might miss): nothing of Sophia
  for (const X of [D2, DO]) { await X.page.evaluate(() => sessionStorage.setItem('proof.seeded', '1')); await X.page.reload(); await X.page.getByTestId('display-23').waitFor({ timeout: 20000 }); }
  await sleep(1500);
  const restartTexts = await Promise.all([D2, DO].map(async (X) => ({ mode: await X.page.locator('[data-testid="right-panel"]').getAttribute('data-mode'), text: await X.page.evaluate(() => document.body.innerText) })));
  check('§100 the branch\'s other display and the other salon\'s display, restarted DURING her checkout: their own screens — nothing of Sophia', restartTexts.every((x) => x.mode === 'ads' && !x.text.includes('Sophia') && !x.text.includes('Journeyproof')), restartTexts.map((x) => x.mode).join(','));
  await shot(dp, '03-checkout-on-the-right.png');
  // the POS changes the ticket → the display follows
  const tk0 = (await pos('GET', `/pos/checkout/tickets/${TK1}`)).body;
  const tDisc = Date.now();
  const disc = await pos('POST', `/pos/checkout/tickets/${TK1}/apply-discount`, { discountCents: 500 });
  const discSeen = await dp.waitForFunction(() => /Discount/.test(document.querySelector('[data-testid="right-panel"]')?.textContent || ''), null, { timeout: 15000 }).then(() => Date.now() - tDisc, () => -1);
  const tk1 = (await pos('GET', `/pos/checkout/tickets/${TK1}`)).body;
  const shown = (await right.innerText()).replace(/\s+/g, ' ');
  check('the POS adds a $5 discount → the customer\'s ticket updates (and its total is the POS\'s)', disc.ok && discSeen >= 0 && shown.includes(money(tk1.totals.totalDueCents)), `${discSeen} ms · POS total ${money(tk1.totals.totalDueCents)} (was ${money(tk0.totals.totalDueCents)})`);
  // the customer tips on the display
  await right.getByRole('button', { name: /20%/ }).first().click();
  let tk2 = null;
  for (let i = 0; i < 40; i++) { tk2 = (await pos('GET', `/pos/checkout/tickets/${TK1}`)).body; if ((tk2.totals?.tipCents ?? 0) > 0) break; await sleep(150); }
  const tipCents = tk2?.totals?.tipCents ?? 0;
  const effective = (tk2?.totals?.subtotalCents ?? 0);
  check('Sophia taps 20% on the display → the tip lands on the POS ticket (20% of the discounted subtotal)', tipCents > 0 && Math.abs(tipCents - Math.round(effective * 0.2)) <= 1, `tip ${money(tipCents)} of ${money(effective)}`);
  await dp.waitForFunction((t) => (document.querySelector('[data-testid="right-panel"]')?.textContent || '').includes(t), money(tk2.totals.totalDueCents), { timeout: 10000 }).catch(() => undefined);
  check('…and the display\'s total due is the POS\'s', (await right.innerText()).includes(money(tk2.totals.totalDueCents)), money(tk2.totals.totalDueCents));
  // payment (cash, at the POS) → the receipt question → No receipt → payment complete → 3 s → advertising
  const paid = await pos('POST', `/pos/checkout/tickets/${TK1}/pay/cash`, { amountReceivedCents: tk2.totals.totalDueCents + 1000 }, { 'idempotency-key': 'journey-' + randomUUID() });
  await dp.locator('[data-testid="right-panel"][data-mode="receipt"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const ask = (await right.innerText()).replace(/\s+/g, ' ');
  const last4 = SOPHIA_PHONE.slice(-4);
  check('payment at the POS → the display asks about the receipt (phone masked)', paid.ok && (await right.getAttribute('data-mode')) === 'receipt' && ask.includes(`•••-${last4}`) && !ask.includes(SOPHIA_PHONE), `pay ${paid.status} · ${ask.slice(0, 100)}`);
  await shot(dp, '04-receipt.png');
  await right.getByRole('button', { name: 'No receipt' }).click();
  await dp.locator('[data-testid="right-panel"][data-mode="completed"]').waitFor({ timeout: 15000 }).catch(() => undefined);
  const done = (await right.innerText()).replace(/\s+/g, ' ');
  const tDone = Date.now();
  const paidCents = Number((await q(`select coalesce(sum(amount_cents), 0)::int as c from payments where tenant_id = $1 and ticket_id = $2 and status in ('approved', 'captured', 'completed', 'succeeded', 'paid')`, [T, TK1]))[0].c);
  check('Payment complete: "Thank you, Sophia" and the total the POS recorded (cash: no card fee)', /Thank you, Sophia/.test(done) && paidCents > 0 && done.includes(money(paidCents)), `${done.slice(0, 80)} · POS payments ${money(paidCents)}`);
  await shot(dp, '05-payment-complete.png');
  await dp.locator('[data-testid="right-panel"][data-mode="ads"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  const holdMs = Date.now() - tDone;
  await sleep(1500);
  const f1 = await frames(dp);
  const firstAds = f1.find((f) => f.t >= tDone && f.mode === 'ads');
  // every frame with the advertising panel from the moment her checkout was sent — and the frame just before the first
  // advertising frame must be the completed summary (no mixed frame in between)
  const after1 = f1.filter((f) => f.t >= tSend && f.mode === 'ads');
  const beforeAds = firstAds ? f1[f1.indexOf(firstAds) - 1] : null;
  const leaks = (f, words) => words.filter((w) => f.page.includes(w));
  const SOPHIA_WORDS = ['Sophia', last4, money(tk2.totals.totalDueCents), money(paidCents), money(tipCents), 'Journeyproof'];
  const leak1 = after1.flatMap((f) => [...leaks(f, SOPHIA_WORDS), ...['Gel Manicure', 'Nail Art', 'Cash', '•••'].filter((w) => f.right.includes(w))]);
  check(`3 s later the right panel is advertising again (${holdMs} ms seen from outside)`, !!firstAds && holdMs >= 2300 && holdMs <= 4800);
  check(`§107 not one advertising frame after her checkout shows her name, phone, services, prices, tip, method or receipt destination — straight from the summary to the ads (${after1.length} frame(s) checked)`, after1.length > 0 && leak1.length === 0 && beforeAds?.mode === 'completed', `${leak1.slice(0, 4).join(', ')} · frame before the ads: ${beforeAds?.mode}`);
  const roots1 = [...new Set(f1.map((f) => f.root).filter(Boolean))];
  const changes = f1.filter((f, i) => i > 0 && f1[i - 1].root && f.root !== f1[i - 1].root).map((f) => `${f.mode}@${f.t - T_START}`);
  check('§130 the 23-inch screen was never torn down — check-in → checkout → receipt → complete → ads on one screen, no reload', roots1.length === 1 && roots1[0] > 0 && D.navigations() === 1, `navigations ${D.navigations()}, screens ${roots1.join(',')} ${changes.slice(0, 4).join(' ')}`);
  await shot(dp, '06-back-to-ads.png');

  // ════ §118 THE WALK-IN ═════════════════════════════════════════════════════════════════════════════════════════════
  phase('§118 walk-in');
  const ETHAN_PHONE = '55507' + rnd(5);
  await wake(dp);
  await type(dp, ETHAN_PHONE);
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('No appointment found').waitFor({ timeout: 15000 });
  await dp.getByPlaceholder('First name').fill('Ethan');
  await dp.getByRole('button', { name: /^Gel Manicure/ }).click();
  await dp.getByRole('button', { name: /^Spa Pedicure/ }).click();
  await dp.getByRole('button', { name: /^Nail Art/ }).click();
  await dp.waitForFunction(() => [...document.querySelectorAll('.d23-walkin select option')].map((o) => o.textContent).join('|') === 'Any available|Lisa', null, { timeout: 15000 }).catch(() => undefined);
  const opts = (await dp.locator('.d23-walkin select option').allInnerTexts()).join(' | ');
  await dp.locator('.d23-walkin select').selectOption(TECH.lisa);
  check('walk-in: two services and an add-on chosen — only Lisa does both, so only Lisa is offered', opts === 'Any available | Lisa', opts);
  await shot(dp, '07-walk-in.png');
  const tWalk = Date.now();
  await dp.getByRole('button', { name: 'Check In', exact: true }).click();
  await dp.locator('.d23-result').waitFor({ timeout: 15000 });
  const qi2 = (await q(`select qi.id, qi.branch_id, qi.assigned_technician_id, qi.requested_services, c.first_name, c.normalized_phone from pos_queue_items qi join customers c on c.id = qi.customer_id where qi.tenant_id = $1 and qi.branch_id = $2 and qi.customer_name = 'Ethan' order by qi.created_at desc limit 1`, [T, B]))[0];
  const rs = qi2 ? (typeof qi2.requested_services === 'string' ? JSON.parse(qi2.requested_services) : qi2.requested_services) : [];
  check('Ethan joins THIS branch\'s queue: a new customer (first name + phone), the branch\'s prices, the add-on attached, Lisa', !!qi2 && String(qi2.normalized_phone).endsWith(ETHAN_PHONE) && rs.find((x) => x.serviceId === S.gel)?.priceCents === PRICE.gel && rs.find((x) => x.serviceId === S.spa)?.priceCents === PRICE.spa && rs.find((x) => x.serviceId === S.art)?.parentServiceId === S.gel && qi2.assigned_technician_id === TECH.lisa,
    rs.map((x) => `${x.serviceName} ${x.priceCents}${x.isAddon ? ' (add-on)' : ''}`).join(', '));
  const onPos2 = await pp.goto(POS + '/queue').then(() => pp.getByText('Ethan').first().waitFor({ timeout: 20000 })).then(() => Date.now() - tWalk, () => -1);
  check('the POS Queue screen shows Ethan', onPos2 >= 0);
  const flow2 = await toCheckout(qi2.id, TECH.lisa);
  check('the front desk: Lisa → service → service done → checkout', flow2.ok, flow2.statuses);
  const TK2 = flow2.ticketId;
  // the display hears nothing of Ethan's checkout until the front desk sends it
  await dp.locator('.d23-result').waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
  await pp.goto(POS + '/checkout');
  await pcard.waitFor({ timeout: 20000 });
  await pp.getByText('Ethan').first().click();
  await pp.waitForTimeout(1200);
  await pcard.getByRole('button', { name: 'Send to Display' }).click();
  await dp.locator('[data-testid="right-panel"][data-mode="checkout"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const ck2 = (await right.innerText()).replace(/\s+/g, ' ');
  check('Ethan\'s ticket on the display: three lines with Lisa', ck2.includes('Hi Ethan') && ck2.includes('Gel Manicure') && ck2.includes('Spa Pedicure') && ck2.includes('Nail Art') && ck2.includes('Lisa'), ck2.slice(0, 140));
  // §103: the display restarts in the middle of the checkout
  await dp.evaluate(() => sessionStorage.setItem('proof.seeded', '1'));
  const tReload = Date.now();
  await dp.reload();
  await dp.locator('[data-testid="right-panel"][data-mode="checkout"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const backMs = Date.now() - tReload;
  const fR = await frames(dp);
  const adBefore = fR.filter((f) => f.mode === 'ads' || f.mode === null && f.root).filter((f) => f.t < (fR.find((x) => x.mode === 'checkout')?.t ?? Infinity));
  check('§103 the display restarts mid-checkout → it comes back to Ethan\'s checkout — never an advertisement in between', (await right.getAttribute('data-mode')) === 'checkout' && (await right.innerText()).includes('Hi Ethan') && adBefore.length === 0, `${backMs} ms · ${fR.length} frames, ${adBefore.length} with an ad before the checkout`);
  // §102: the server goes away and comes back
  await stopApi();
  await sleep(3000);
  const during = (await right.getAttribute('data-mode'));
  const rootBefore = (await frames(dp)).at(-1)?.root;
  check('§102 the API goes down: the display keeps Ethan\'s checkout (no blank, no ad)', during === 'checkout', during);
  const restarted = await startApi();
  const tBack = Date.now();
  const disc2 = await pos('POST', `/pos/checkout/tickets/${TK2}/apply-discount`, { discountCents: 300 });
  const heard = await dp.waitForFunction(() => /Discount/.test(document.querySelector('[data-testid="right-panel"]')?.textContent || ''), null, { timeout: 30000 }).then(() => Date.now() - tBack, () => -1);
  const fApi = (await frames(dp)).filter((f) => f.t >= tBack - 4000);
  check('…it comes back by itself: re-authenticates, refetches the checkout and hears the next POS change — the same screen throughout', restarted && disc2.ok && heard >= 0 && fApi.every((f) => f.root === rootBefore && f.mode === 'checkout'), `${heard} ms after the API was back`);
  await shot(dp, '08-after-reconnect.png');
  const tk3 = (await pos('GET', `/pos/checkout/tickets/${TK2}`)).body;
  const paid2 = await pos('POST', `/pos/checkout/tickets/${TK2}/pay/cash`, { amountReceivedCents: tk3.totals.totalDueCents }, { 'idempotency-key': 'journey-' + randomUUID() });
  await dp.locator('[data-testid="right-panel"][data-mode="receipt"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  if ((await right.getAttribute('data-mode')) === 'receipt') await right.getByRole('button', { name: 'No receipt' }).click();
  await dp.locator('[data-testid="right-panel"][data-mode="completed"]').waitFor({ timeout: 15000 }).catch(() => undefined);
  const tDone2 = Date.now();
  await dp.locator('[data-testid="right-panel"][data-mode="ads"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  await sleep(1200);
  const f2 = await frames(dp);
  const firstAds2 = f2.find((f) => f.t >= tDone2 && f.mode === 'ads');
  const leak2 = firstAds2 ? f2.filter((f) => f.t >= firstAds2.t).flatMap((f) => [...leaks(f, ['Ethan', ETHAN_PHONE.slice(-4), money(tk3.totals.totalDueCents)]), ...['Spa Pedicure', 'Cash'].filter((w) => f.right.includes(w))]) : ['no ads frame'];
  check('payment → complete → 3 s → advertising; no frame after that shows Ethan', paid2.ok && !!firstAds2 && leak2.length === 0, leak2.slice(0, 3).join(', '));
  // §104: a restart with no checkout → check-in and advertising
  await dp.reload();
  await dp.getByTestId('display-23').waitFor({ timeout: 20000 });
  await ready(dp);
  const t104 = await dp.evaluate(() => document.body.innerText);
  check('§104 a restart with no checkout: check-in and the advertising panel — nobody\'s data', (await right.getAttribute('data-mode')) === 'ads' && (await dp.getByText('Check In Here').count()) === 1 && !t104.includes('Ethan') && !t104.includes('Sophia'));

  // ── §100: the second display of the branch never showed either customer ─────────────────────────────────────────────
  phase('isolation');
  const fD2 = await frames(D2.page);
  const seen2 = fD2.flatMap((f) => ['Sophia', 'Ethan', 'Journeyproof'].filter((w) => f.page.includes(w)));
  check('§100 the branch\'s other display (another register) never showed Sophia or Ethan — not one frame', fD2.length > 0 && seen2.length === 0 && fD2.every((f) => f.mode !== 'checkout'), `${fD2.length} frames`);
  // §119–§120 in the browser: what each display actually put on screen
  const heads = async (pg) => (await frames(pg)).map((f) => f.right).join(' ');
  // each display shows a picture once it is in its device cache — give the rotation a moment
  await DO.page.waitForFunction(() => (document.querySelector('[data-testid="right-panel"]')?.textContent || '').includes('Other Salon Special'), null, { timeout: 30000 }).catch(() => undefined);
  await DM.page.waitForFunction(() => /Journey Proof (Main Only|Pedicure Week)/.test(document.querySelector('[data-testid="right-panel"]')?.textContent || ''), null, { timeout: 30000 }).catch(() => undefined);
  const oText = await heads(DO.page), mText = await heads(DM.page), bText = await heads(dp);
  const oMedia = DO.mediaUrls, bMedia = D.mediaUrls;
  check('§119 the other salon\'s display shows ITS ad — never ours: no headline of ours in any frame, no picture of ours ever fetched', oText.includes('Other Salon Special') && !/Journey Proof Pedicure Week|Journey Proof Main Only/.test(oText) && oMedia.some((u) => u.includes(M_OTHER)) && !oMedia.some((u) => u.includes(media.body.id)), `fetched ${oMedia.map((u) => u.includes(M_OTHER) ? 'its own' : u.includes(media.body.id) ? 'OURS' : 'other').join(',')} · ${oText.slice(0, 80)}`);
  await shot(DO.page, '09-other-salon-display.png');
  info(`other salon display: media ${oMedia.join(' ; ').slice(0, 300)} · distinct panel texts ${[...new Set((await frames(DO.page)).map((f) => f.right.replace(/\s+/g, ' ').slice(0, 60)))].join(' | ')}`);
  check('…and ours never fetched the other salon\'s picture', bMedia.some((u) => u.includes(media.body.id)) && !bMedia.some((u) => u.includes(M_OTHER)), bMedia.length + ' fetches');
  check('§120 Main\'s display rotates the Main-only ad; the proof branch\'s display never showed it', /Journey Proof Main Only|Journey Proof Pedicure Week/.test(mText) && !bText.includes('Journey Proof Main Only'), `main frames ${(await frames(DM.page)).length}`);
  // check-in isolation: Main's display cannot see the proof branch's visit; the other salon's display cannot check in here
  const mainSess = await j(await fetch(API + '/customer-display/device/check-in/session', { method: 'POST', headers: { 'x-device-token': TOK.main } }));
  const mainLook = mainSess.ok ? await j(await fetch(`${API}/go-check-in/session/${mainSess.body.sessionId}/lookup-phone`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-checkin-token': mainSess.body.sessionToken }, body: JSON.stringify({ phone: SOPHIA_PHONE }) })) : null;
  const mainSvc = mainSess.ok ? await j(await fetch(`${API}/go-check-in/session/${mainSess.body.sessionId}/services`, { headers: { 'x-checkin-token': mainSess.body.sessionToken } })) : null;
  check('branch isolation of check-in: Main\'s display finds no appointment of the proof branch and lists none of its services', !!mainLook?.ok && !mainLook.body.appointment && !(mainSvc?.body?.services ?? []).some((s) => [S.gel, S.spa, S.art].includes(s.id)), `appointment ${mainLook?.body?.appointment ? 'SHOWN' : 'none'}`);
  const otherSess = await j(await fetch(API + '/customer-display/device/check-in/session', { method: 'POST', headers: { 'x-device-token': TOK.other } }));
  const otherState = (await j(await fetch(API + '/customer-display/device/current', { headers: { 'x-device-token': TOK.other } }))).body;
  check('tenant isolation of check-in: the other salon\'s display has its own (switched-off) check-in — no session, nothing of ours in its state', !otherSess.ok && !otherState.checkIn && !JSON.stringify(otherState).includes('Pilot'), `start ${otherSess.status}`);
  // §37: the 15-second safety sync — an idle display still asks for its state on its own (it does not rely on events alone)
  const gaps = (xs) => xs.slice(1).map((t, i) => t - xs[i]);
  const mainGaps = gaps(DM.stateFetches);
  check('§37 an idle display (Main\'s, untouched all along) still asks the server for its state by itself — about every 15 s', DM.stateFetches.length >= 3 && Math.max(...mainGaps) <= 20000, `${DM.stateFetches.length} fetches, gaps ${mainGaps.map((g) => Math.round(g / 1000)).join(',')} s`);
  check('no page errors on any display or the POS', [...D.errors, ...D2.errors, ...DM.errors, ...DO.errors, ...pErrors].length === 0, [...D.errors, ...D2.errors, ...DM.errors, ...DO.errors, ...pErrors].slice(0, 2).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' '));
  if (apiErr) info('API stderr (tail): ' + apiErr.split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' | ').slice(0, 400));
} finally {
  clearTimeout(watchdog);
  await Promise.race([restore(), sleep(30000)]);
  await client.end().catch(() => undefined);
}
console.log(results.join('\n'));
console.log(`\n${failed ? `FAILED — ${failed} check(s)` : 'PASS — every check'} · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
