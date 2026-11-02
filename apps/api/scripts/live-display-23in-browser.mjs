#!/usr/bin/env node
// live-display-23in-browser.mjs — 23-inch dual-screen spec, Unit 4 (§2–§7, §13, §26–§28, §43–§46, §72, §79–§80, §108,
// §121): Kevin's layout in a REAL browser (Chromium at 1920×1080) against the real API, PostgreSQL and object storage.
//   1. idle: check-in on the left/centre, the salon's ad on the right — a picture the display cached on the device — no
//      page scroll, the salon's name on top, "Powered by AI PowerSalon" only as a footer line
//   2. branding from the POS: the owner sets the tagline and the branch name (Settings → Customer Display) and uploads a
//      logo through the page's own canvas pipeline (Settings → Receipts & Branding); the display shows them
//   3. a real walk-in check-in on the display (phone, name, service → the branch queue); the result in the footer, then
//      every trace of the guest gone from the page
//   4. §7 full-screen idle ads after 30 s untouched; the touch that ends them presses nothing underneath
//   5. checkout: POS "Send to Display" → the ad is GONE and the customer's ticket takes the right panel (check-in stays
//      usable); a tip tapped on the display lands on the POS ticket; POS cash payment → the completed summary → 3 s →
//      the customer destroyed (nothing in the page or the device's storage) → the ads again
//   6. §108 the display reported what it showed (display_ad_display_stats)
//   7. §72 the API goes down: the ad keeps playing; the display restarts with the API still down → the salon and its saved
//      ad from the device cache, no customer data on the device; the API comes back → the display reconnects
// Requires: apps/api built (npm run build), apps/customer-display and apps/pos-web built (npx vite build).
//   DATABASE_URL=postgres://… CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/live-display-23in-browser.mjs
// Restores the salon settings rows it touched and retires its devices; leaves the proof ticket and the walk-in it
// created (named "Liam", a 555 number). Never point it at production.
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3034, DISPLAY_PORT = 4175, POS_PORT = 4176;
const API = `http://127.0.0.1:${API_PORT}`, DISPLAY = `http://127.0.0.1:${DISPLAY_PORT}`, POS = `http://127.0.0.1:${POS_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'd23-proof-media-'));
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'd23-proof-shots-')); mkdirSync(SHOTS, { recursive: true });
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const info = (s) => results.push(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ── pictures ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function adPng(w, h, seed) {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const block = x > w * 0.55 && x < w * 0.9 && y > h * 0.12 && y < h * 0.45 && ((x >> 4) + (y >> 4)) % 2 === 0;
    p.data[i] = block ? 250 : (120 + (y * 100) / h + seed) & 255; p.data[i + 1] = block ? 236 : (60 + (x * 70) / w) & 255; p.data[i + 2] = block ? 214 : 70; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}
const adFiles = () => ({ original: adPng(1080, 1620, 3), large: adPng(1080, 1620, 4), medium: adPng(720, 1080, 5), thumb: adPng(213, 320, 6) });
function adForm(f) {
  const fd = new FormData();
  for (const k of ['original', 'large', 'medium', 'thumb']) fd.append(k, new Blob([f[k]], { type: 'image/png' }), `${k}.png`);
  fd.append('focalX', '0.6'); fd.append('focalY', '0.3');
  return fd;
}
// a wide logo on a TRANSPARENT background, bigger than 800 px: the POS must shrink it and keep the transparency
const logo = new PNG({ width: 1200, height: 480 });
for (let y = 0; y < 480; y++) for (let x = 0; x < 1200; x++) {
  const i = (y * 1200 + x) * 4; const ring = Math.hypot(x - 240, y - 240) < 200 && Math.hypot(x - 240, y - 240) > 150; const bar = x > 480 && x < 1140 && y > 190 && y < 290;
  const on = ring || bar; logo.data[i] = 176; logo.data[i + 1] = 132; logo.data[i + 2] = 58; logo.data[i + 3] = on ? 255 : 0;
}
const LOGO_PATH = join(SHOTS, 'salon-logo-upload.png');
writeFileSync(LOGO_PATH, PNG.sync.write(logo));

// ── seed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const salon = (await client.query(`select t.id as tenant_id, t.display_name, b.id as branch_id, b.name as branch_name from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON])).rows[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, B = salon.branch_id;
const CATS = ['customer-display-devices', 'receipts-branding', 'salon-logo', 'customer-display-ads'];
const settingsBefore = (await client.query(`select * from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS])).rows;
const checkinBefore = (await client.query(`select * from tenant_checkin_settings where tenant_id = $1`, [T])).rows[0] ?? null;
await client.query(`update customer_display_devices set revoked_at = now() where tenant_id = $1 and device_name = 'Live 23in Proof' and revoked_at is null`, [T]);
await client.query(`update go_checkin_devices set status = 'disabled', disabled_at = now() where tenant_id = $1 and device_name = 'Live 23in Proof Check-In' and status = 'active'`, [T]);
// the display — dated oldest so the POS "Send to Display" picks it
const DEV = randomUUID(), TOKEN = randomBytes(24).toString('base64url');
await client.query(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash, created_at) values ($1,$2,$3,'Live 23in Proof','android','paired',$4, now() - interval '20 years')`, [DEV, T, B, sha(TOKEN)]);
// the branch's check-in: one Go Check-In device the same screen shows between checkouts, check-in switched on
const GCI = randomUUID(), SLUG = 'live-23in-' + randomBytes(5).toString('hex');
await client.query(`insert into go_checkin_devices (id, tenant_id, branch_id, device_name, device_type, checkin_slug, status, token_expires_at) values ($1,$2,$3,'Live 23in Proof Check-In','l_shape_display',$4,'active', now() + interval '1 day')`, [GCI, T, B, SLUG]);
await client.query(`insert into tenant_checkin_settings (tenant_id, enabled) values ($1, true) on conflict (tenant_id) do update set enabled = true`, [T]);
// the customer at checkout: Sophia, two of the salon's real services with Olivia
const CUST = randomUUID(), TK = randomUUID(), OLIVIA = randomUUID();
await client.query(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Proof','Sophia Proof')`, [CUST, T, B]);
await client.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, B, CUST]);
await client.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Olivia','Proof','Olivia Proof')`, [OLIVIA, T, B]);
const svcs = (await client.query(`select id, name, price_cents, duration_minutes from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 2`, [T])).rows;
if (svcs.length < 2) { console.error('the salon needs two active services'); process.exit(2); }
for (const v of svcs) {
  await client.query(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$7,'percent',55)`,
    [T, B, TK, v.id, OLIVIA, v.name, Number(v.price_cents), Number(v.duration_minutes || 30)]);
}

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
let apiProc = null; let apiErr = '';
const startApi = () => {
  apiProc = spawn('node', ['dist/main.js'], { env: { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), MEDIA_ROOT, AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
};
// SIGTERM lets the API tell its realtime clients to reconnect; it gets 8 s, then it is killed
const stopApi = () => new Promise((res) => {
  if (!apiProc || apiProc.exitCode !== null || apiProc.signalCode) return res();
  const p = apiProc; const hard = setTimeout(() => p.kill('SIGKILL'), 8000);
  p.once('exit', () => { clearTimeout(hard); res(); }); p.kill('SIGTERM');
});
const T_START = Date.now();
const phase = (name) => process.stderr.write(`[${((Date.now() - T_START) / 1000).toFixed(1)}s] ${name}\n`);
// a watchdog: a stuck step must not hang the proof — report what ran, then stop everything
const watchdog = setTimeout(async () => {
  check('the proof finished within 8 minutes', false, 'watchdog fired');
  await Promise.race([restore(), sleep(20000)]).catch(() => undefined);
  console.log(results.join('\n'));
  try { apiProc?.kill('SIGKILL'); displayProc.kill('SIGKILL'); posProc.kill('SIGKILL'); } catch { /* */ }
  process.exit(1);
}, 8 * 60_000);
const up = async (url, tries = 120) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const vite = (app, port) => spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: new URL(`../../${app}/`, import.meta.url).pathname, env: { ...process.env, VITE_API_BASE: API }, stdio: ['ignore', 'ignore', 'pipe'] });
startApi();
const displayProc = vite('customer-display', DISPLAY_PORT);
const posProc = vite('pos-web', POS_PORT);

let restored = false;
const restore = async () => {
  if (restored) return; restored = true;
  // put the salon back as it was
  await client.query(`delete from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]).catch(() => undefined);
  for (const r of settingsBefore) {
    await client.query(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json, updated_by_user_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.tenant_id, r.branch_id, r.category, JSON.stringify(r.settings_json), r.updated_by_user_id, r.created_at, r.updated_at]).catch(() => undefined);
  }
  await client.query(`delete from tenant_checkin_settings where tenant_id = $1`, [T]).catch(() => undefined);
  if (checkinBefore) {
    const cols = Object.keys(checkinBefore);
    await client.query(`insert into tenant_checkin_settings (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => checkinBefore[c])).catch(() => undefined);
  }
  await client.query(`update go_checkin_devices set status = 'disabled', disabled_at = now() where id = $1`, [GCI]).catch(() => undefined);
  await client.query(`update customer_display_devices set revoked_at = now() where id = $1`, [DEV]).catch(() => undefined);
  if (adId) await client.query(`delete from display_ads where tenant_id = $1 and id = $2`, [T, adId]).catch(() => undefined);
  if (mediaId) await client.query(`delete from display_ad_media where tenant_id = $1 and id = $2`, [T, mediaId]).catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await stopApi(); displayProc.kill('SIGTERM'); posProc.kill('SIGTERM');
};
let browser; let adId = null; let mediaId = null; let walkInId = null; let dp = null; let pp = null;
const shot = async (page, name) => { try { await page.screenshot({ path: join(SHOTS, name) }); } catch { /* best effort */ } };
try {
  check('API booted (health/ready)', await up(API + '/health/ready'));
  check('display and POS served (vite preview, same-origin proxy to the API)', (await up(DISPLAY + '/')) && (await up(POS + '/')));
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('owner signed in (API)', login.ok && !!cookie, String(login.status));
  const pos = (method, path, body, extra = {}) => fetch(API + path, { method, headers: { cookie, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...extra }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });

  // the salon's advertising: one published ad, full-screen idle ads on after 30 s
  const A = '/pos/marketing/display-ads';
  const m = await (await pos('POST', A + '/media', adForm(adFiles()))).json(); mediaId = m.id;
  const ad = await (await pos('POST', A, { name: 'Live 23in Proof — Fall pedicure', mediaId: m.id, headline: 'Deluxe spa pedicure', subheadline: 'Relax • Refresh • Renew', ctaText: 'Ask your technician today' })).json(); adId = ad.id;
  const pub = await (await pos('POST', `${A}/${ad.id}/publish`, { expectedVersion: 1 })).json();
  const fsSet = await pos('PATCH', `${A}/settings`, { fullScreenIdleAdsEnabled: true, fullScreenIdleAfterSeconds: 30 });
  const plist = await (await fetch(API + '/customer-display/device/ads', { headers: { 'x-device-token': TOKEN } })).json();
  check('the salon has a live ad, and full-screen idle ads after 30 s', pub.status === 'ACTIVE' && fsSet.ok && plist.ads?.some((x) => x.id === ad.id) && plist.fullScreenIdle?.enabled === true && plist.fullScreenIdle?.afterSeconds === 30,
    `${pub.status} · playlist ${plist.ads?.length} ad(s) · full-screen ${plist.fullScreenIdle?.enabled} after ${plist.fullScreenIdle?.afterSeconds}s`);

  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── 1. idle at 1920×1080 ───────────────────────────────────────────────────────────────────────────────────────────
  phase('1 idle');
  const dctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  dp = await dctx.newPage();
  const dErrors = []; dp.on('pageerror', (e) => dErrors.push(String(e)));
  const stateLog = [];   // every state the display fetched: when, and what branding it carried (diagnostics)
  dp.on('response', async (r) => {
    if (!r.url().includes('/customer-display/device/current')) return;
    const at = Date.now(); let b = null; try { b = (await Promise.race([r.json(), sleep(2000).then(() => null)]))?.branding ?? null; } catch { /* not JSON */ }
    stateLog.push({ at, status: r.status(), logo: !!b?.logoUrl, tagline: b?.tagline ?? null });
  });
  const logoNet = [];   // the logo picture's own requests (diagnostics)
  dp.on('response', (r) => { if (r.url().includes('salon-logos')) logoNet.push(`${r.status()} ${r.headers()['content-type']} ${JSON.stringify(Object.fromEntries(Object.entries(r.headers()).filter(([k]) => /cross-origin|content-security|x-content|cache/.test(k))))}`); });
  dp.on('requestfailed', (r) => { if (r.url().includes('salon-logos')) logoNet.push(`FAILED ${r.failure()?.errorText}`); });
  await dp.goto(`${DISPLAY}/#device=${TOKEN}`);
  await dp.locator('[data-testid="display-23"]').waitFor({ timeout: 20000 });
  const right = dp.locator('[data-testid="right-panel"]');
  const panelImg = right.locator('img').first();
  await panelImg.waitFor({ timeout: 20000 });
  await dp.waitForFunction(() => { const i = document.querySelector('[data-testid="right-panel"] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 });
  const pi = await panelImg.evaluate((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight, fit: getComputedStyle(i).objectFit }));
  check('idle: the salon\'s ad plays in the right panel — a picture kept on the device (blob from the device cache)', (await right.getAttribute('data-mode')) === 'ads' && pi.src.startsWith('blob:') && pi.w === 720 && pi.h === 1080, `${pi.src.slice(0, 12)}… ${pi.w}×${pi.h} ${pi.fit}`);
  check('…with the salon\'s words over it', (await right.getByText('Deluxe spa pedicure').count()) === 1);
  const five = dp.getByRole('button', { name: '5', exact: true });
  await dp.waitForFunction(() => { const b = [...document.querySelectorAll('.d23-key')].find((x) => x.textContent === '5'); return !!b && !b.disabled; }, null, { timeout: 20000 });
  check('check-in is live on the left (the branch\'s Go Check-In, same screen)', await five.isEnabled() && (await dp.getByRole('button', { name: 'Find My Appointment' }).count()) === 1);
  const scroll = await dp.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
  check('one screen: no page scroll at 1920×1080', scroll.h <= scroll.ih && scroll.w <= scroll.iw, `${scroll.w}×${scroll.h} in ${scroll.iw}×${scroll.ih}`);
  const head = await dp.locator('.d23-head').innerText();
  check('the header is the salon\'s; AI PowerSalon only as "Powered by" in the footer', head.includes(salon.display_name) && !/PowerSalon/i.test(head) && (await dp.locator('.d23-foot').innerText()).includes('Powered by'), head.replace(/\s+/g, ' ').slice(0, 80));
  await shot(dp, '01-idle-checkin-and-ad-1920x1080.png');

  // ── 2. branding from the POS ───────────────────────────────────────────────────────────────────────────────────────
  phase('2 branding');
  const pctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  pp = await pctx.newPage();
  const pErrors = []; pp.on('pageerror', (e) => pErrors.push(String(e)));
  await pp.goto(POS + '/');
  await pp.fill('#aps-identifier', EMAIL); await pp.fill('#aps-password', PASSWORD); await pp.fill('#aps-store', SALON);
  await pp.click('button[type="submit"]');
  await pp.waitForTimeout(1500);
  const pick = pp.getByRole('button', { name: /^Main/ });
  if (await pick.count()) await pick.first().click();
  await pp.waitForTimeout(800);
  await pp.goto(POS + '/settings');
  const section = (title) => pp.locator('section.panel', { has: pp.getByRole('heading', { name: title, exact: true }) });
  const disp = section('Customer Display');
  await disp.waitFor({ timeout: 20000 });
  await disp.getByRole('button', { name: 'Edit' }).click();
  const tagline = disp.getByPlaceholder('Nails · Spa · Lashes');
  await tagline.waitFor({ timeout: 10000 });
  await tagline.fill('Relax • Refresh • Renew');
  for (const label of ['show branch name', 'show salon logo & tagline']) { const c = disp.getByLabel(label); if (!(await c.isChecked())) await c.check(); }
  await disp.getByPlaceholder('Welcome! Please check in.').fill('Welcome! Check in on the left.');
  await disp.screenshot({ path: join(SHOTS, '02a-pos-customer-display-branding.png') }).catch(() => undefined);
  await disp.getByRole('button', { name: 'Save Customer Display' }).click();
  await pp.getByText('Saved.', { exact: true }).waitFor({ timeout: 10000 });
  const dispRows = (await client.query(`select branch_id, settings_json from tenant_settings where tenant_id = $1 and category = 'customer-display-devices'`, [T])).rows;
  const dj = dispRows.map((r) => r.settings_json).find((j) => j?.tagline === 'Relax • Refresh • Renew');
  check('POS Settings → Customer Display saved the tagline and "show branch name"', !!dj && dj.showBranchName === true && dj.displayBranding === true, dj ? `${dispRows.length} row(s)` : JSON.stringify(dispRows.map((r) => r.settings_json)).slice(0, 160));

  const rc = section('Receipts & Branding');
  await rc.getByRole('button', { name: 'Edit' }).click();
  const box = rc.getByTestId('salon-logo-setting');
  await box.getByText('No logo yet').or(box.getByAltText('Salon logo')).first().waitFor({ timeout: 10000 });
  const tUp = Date.now();
  await box.locator('input[type="file"]').setInputFiles(LOGO_PATH);
  await box.getByRole('status').filter({ hasText: 'Logo saved' }).waitFor({ timeout: 20000 });
  const prepMs = Date.now() - tUp;
  await box.getByAltText('Salon logo').waitFor();
  await pp.waitForFunction(() => { const i = document.querySelector('[data-testid="salon-logo-setting"] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await rc.screenshot({ path: join(SHOTS, '02b-pos-receipts-branding-logo.png') });
  const lrow = (await client.query(`select branch_id, settings_json from tenant_settings where tenant_id = $1 and category = 'salon-logo'`, [T])).rows;
  const lj = lrow[0]?.settings_json ?? {};
  check('the browser shrank the 1200×480 logo to 800×320 and the server stored it salon-wide', lrow.length === 1 && lrow[0].branch_id === null && lj.width === 800 && lj.height === 320 && new RegExp(`^salon-logos/${T}/logo-[0-9a-f]{24}\\.(png|webp)$`).test(lj.key),
    `${lj.width}×${lj.height} ${lj.mime} ${lj.bytes} bytes · ${prepMs} ms decode + resize + upload`);
  const onDisk = join(MEDIA_ROOT, lj.key || 'missing');
  const served = await fetch(API + lj.url);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check('…as a file in object storage, served back byte-identical', existsSync(onDisk) && served.ok && servedBytes.equals(readFileSync(onDisk)) && /^image\/(png|webp)$/.test(served.headers.get('content-type') || ''), `${served.status} ${served.headers.get('content-type')}`);
  const px = (() => { if (lj.mime !== 'image/png') return null; const p = PNG.sync.read(servedBytes); return { corner: p.data[3], ring: p.data[(160 * p.width + 160 - 60) * 4 + 3] }; })();
  check('…keeping the transparent background (PNG alpha)', !px || (px.corner === 0), px ? `corner alpha ${px.corner}` : `stored as ${lj.mime}`);
  // the display is the only page on its screen; in this one browser the POS window took the front, so the display page
  // was a background page (its safety sync slows to 60 s while hidden) — bring it back to the front, as it really is
  const visBefore = await dp.evaluate(() => document.visibilityState);
  await dp.bringToFront();
  info(`display page visibility while the POS window was in front: ${visBefore}; brought to the front again`);
  const tSaved = Date.now();
  await dp.waitForFunction((tag) => {
    const i = document.querySelector('.d23-head img.salon-logo');
    return !!i && i.complete && i.naturalWidth > 0 && (document.querySelector('.d23-head')?.textContent || '').includes(tag);
  }, 'Relax • Refresh • Renew', { timeout: 25000 }).catch(() => undefined);
  const brandMs = Date.now() - tSaved;
  const headNow = (await dp.locator('.d23-head').innerText()).replace(/\s+/g, ' ');
  const logoSrc = await dp.locator('.d23-head img').first().getAttribute('src').catch(() => null);
  if (!logoSrc?.includes(lj.key)) info('logo requests from the display: ' + (logoNet.join(' | ') || 'none'));
  if (!logoSrc?.includes(lj.key)) info('display state fetches (ms from the logo upload): ' + stateLog.map((x) => `${x.at - tSaved}:${x.status}${x.logo ? '+logo' : ''}${x.tagline ? '+tag' : ''}`).join(' ') + ' · head ' + (await dp.locator('.d23-head').innerHTML()).slice(0, 200));
  check('the display shows the salon\'s logo, tagline and branch name (on its next sync — no restart)', !!logoSrc?.includes(lj.key) && headNow.includes(`Relax • Refresh • Renew · ${salon.branch_name}`), `${brandMs} ms after the upload · ${headNow.slice(0, 90)}`);
  await shot(dp, '03-display-salon-branding.png');

  // ── 3. a real walk-in check-in ─────────────────────────────────────────────────────────────────────────────────────
  phase('3 check-in');
  // (more than 30 s passed untouched while the owner worked in the POS: the full-screen ad may be up — a touch ends it)
  if (await dp.locator('[data-testid="fullscreen-ads"]').count()) {
    info('the full-screen idle ad was up after the POS steps (30 s untouched) — a touch returns to check-in');
    await dp.mouse.click(960, 540);
    await dp.locator('[data-testid="fullscreen-ads"]').waitFor({ state: 'detached', timeout: 3000 });
  }
  const last4 = String(1000 + Math.floor(Math.random() * 8999));
  const phone = '215555' + last4;
  for (const d of phone) await dp.getByRole('button', { name: d, exact: true }).click();
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('No appointment found').waitFor({ timeout: 15000 });
  await dp.getByPlaceholder('First name').fill('Liam');
  await dp.locator('.d23-svc').first().click();
  const svcName = (await dp.locator('.d23-svc .n').first().innerText()).trim();
  await dp.getByRole('button', { name: 'Check In', exact: true }).click();
  const result = dp.locator('.d23-result');
  await result.waitFor({ timeout: 15000 });
  const resText = (await result.innerText()).replace(/\s+/g, ' ');
  await sleep(600);
  await shot(dp, '04-checked-in-footer.png');
  const q = (await client.query(`select id, customer_name, source, status, branch_id from pos_queue_items where tenant_id = $1 and customer_name ilike 'Liam%' and created_at > now() - interval '3 minutes' order by created_at desc limit 1`, [T])).rows[0];
  walkInId = q?.id ?? null;
  check('walk-in checked in on the display → the branch queue (real API)', /You’re checked in!/.test(resText) && /Thanks, Liam/.test(resText) && !!q && q.branch_id === B, `${resText.slice(0, 90)} · queue ${q?.status ?? 'missing'} (${svcName})`);
  const typed = await dp.locator('.d23-phone .val').innerText();
  check('§26: what the guest typed is already gone while the result shows', typed === '(555) 123-4567', typed);
  await result.waitFor({ state: 'detached', timeout: 14000 }).catch(() => undefined);
  const after = await dp.evaluate(() => document.body.innerText);
  check('§28: after the hold, nothing of the guest is left on the screen', !(await result.count()) && !after.includes('Liam') && !after.includes(last4), (await result.count()) ? 'result still shown' : 'clean');

  // ── 4. §7 full-screen idle ads ─────────────────────────────────────────────────────────────────────────────────────
  phase('4 full-screen');
  const key5 = await five.boundingBox();
  const tIdle = Date.now();
  const overlay = dp.locator('[data-testid="fullscreen-ads"]');
  await overlay.waitFor({ timeout: 45000 }).catch(() => undefined);
  const fsShown = await overlay.count() === 1;
  if (fsShown) await dp.waitForFunction(() => { const i = document.querySelector('[data-testid="fullscreen-ads"] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => undefined);
  const fsImg = fsShown ? await overlay.locator('img').first().evaluate((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, fit: getComputedStyle(i).objectFit })).catch(() => null) : null;
  check('§7 after 30 s untouched, the ad takes the whole screen (the panel stops playing underneath)', fsShown && !!fsImg && fsImg.w > 0 && (await right.locator('img').count()) === 0, fsShown ? `${Math.round((Date.now() - tIdle) / 1000)} s after the check-in cleared · ${fsImg?.w}px ${fsImg?.fit}` : 'never appeared');
  await shot(dp, '05-fullscreen-idle-ad.png');
  if (fsShown && key5) {
    await dp.mouse.click(key5.x + key5.width / 2, key5.y + key5.height / 2);   // a real touch, right where the "5" key is
    await overlay.waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined);
    await sleep(300);
    const val = await dp.locator('.d23-phone .val').innerText();
    check('…a touch ends it, and that touch presses nothing underneath', (await overlay.count()) === 0 && val === '(555) 123-4567', `phone field: ${val}`);
  }

  // ── 5. checkout takes the right panel ──────────────────────────────────────────────────────────────────────────────
  phase('5 checkout');
  const t0 = Date.now();
  const sent = await pos('POST', `/pos/checkout/tickets/${TK}/send-to-customer-display`);
  const sentBody = await sent.json().catch(() => ({}));
  check('POS "Send to Display" picked this display', sent.ok && sentBody.deviceId === DEV, `${sent.status}`);
  await dp.locator('[data-testid="right-panel"][data-mode="checkout"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const ckMs = Date.now() - t0;
  const panelText = (await right.innerText()).replace(/\s+/g, ' ');
  check('checkout begins → the customer\'s ticket takes the right panel', (await right.getAttribute('data-mode')) === 'checkout' && svcs.every((v) => panelText.includes(v.name)) && panelText.includes('Olivia'), `${ckMs} ms after the POS call`);
  check('…and the ad is GONE (not covered): no ad picture or slide in the page', (await dp.locator('.aps-adslide').count()) === 0 && (await right.locator('img').count()) === 0);
  check('…while check-in stays usable on the left', await five.isEnabled() && (await dp.getByRole('button', { name: 'Find My Appointment' }).isEnabled()));
  await shot(dp, '06-checkout-on-the-right.png');
  const tipBtn = right.locator('.kiosk-tip-opt').filter({ hasText: '20%' }).first();
  if (await tipBtn.count()) {
    await tipBtn.click();
    let tipRow = null;
    for (let i = 0; i < 40 && !(Number(tipRow?.tip_cents) > 0); i++) { await sleep(150); tipRow = (await client.query(`select tip_cents from tickets where id = $1`, [TK])).rows[0]; }
    await dp.waitForFunction(() => !!document.querySelector('[data-testid="right-panel"] .kiosk-tip-opt.on'), null, { timeout: 10000 }).catch(() => undefined);
    const shownTotal = await right.innerText();
    const tkTotal = await (await pos('GET', `/pos/checkout/tickets/${TK}`)).json();
    const due = tkTotal.totals?.totalDueCents;
    check('a tip tapped on the display lands on the POS ticket (the server computes it) and the display shows the new total', Number(tipRow?.tip_cents) > 0 && typeof due === 'number' && shownTotal.includes(`$${(due / 100).toFixed(2)}`), `tip ${tipRow?.tip_cents}¢ · total due $${(due / 100).toFixed(2)}`);
  } else info('this salon\'s display mode shows no tip buttons — tip step skipped');
  const t2 = Date.now();
  const paid = await pos('POST', `/pos/checkout/tickets/${TK}/pay/cash`, { amountReceivedCents: 50000 }, { 'idempotency-key': 'live-23in-' + randomUUID() });
  check('POS took the cash payment', paid.ok, String(paid.status));
  await dp.locator('[data-testid="right-panel"][data-mode="completed"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const tDone = Date.now();
  const doneText = (await right.innerText()).replace(/\s+/g, ' ');
  const paidRow = (await client.query(`select coalesce(sum(amount_cents),0)::int as paid from payments where ticket_id = $1 and status = 'approved'`, [TK])).rows[0];
  const paidStr = `$${(paidRow.paid / 100).toFixed(2)}`;
  check('§44 the completed summary: payment complete, thank you Sophia, the total the POS recorded', (await right.getAttribute('data-mode')) === 'completed' && /payment complete/i.test(doneText) && doneText.includes('Thank you, Sophia') && doneText.includes(paidStr), `${tDone - t2} ms after the POS payment · ${paidStr}`);
  await shot(dp, '07-completed-summary.png');
  await dp.locator('[data-testid="right-panel"][data-mode="ads"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  const holdMs = Date.now() - tDone;
  check('§43 held ~3 s, then the right panel is advertising again', (await right.getAttribute('data-mode')) === 'ads' && holdMs >= 2500 && holdMs <= 4500, `${holdMs} ms`);
  await dp.waitForFunction(() => { const i = document.querySelector('[data-testid="right-panel"] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => undefined);
  const pageAfter = await dp.evaluate(() => document.documentElement.outerHTML);
  const stored = await dp.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  // the check-in side legitimately lists the salon's services and team; the CUSTOMER's checkout must be gone everywhere
  const leaks = ['Sophia', paidStr, 'Total paid', 'Payment complete'].filter((w) => pageAfter.includes(w));
  const panelAfter = await right.evaluate((el) => el.outerHTML);
  const panelLeaks = ['Olivia', ...svcs.map((v) => v.name)].filter((w) => panelAfter.includes(w));
  check('§45–§46: nothing of Sophia\'s checkout is left in the page (name, total paid) or in the right panel (her services, her technician)', leaks.length === 0 && panelLeaks.length === 0, leaks.length + panelLeaks.length ? `still there: ${[...leaks, ...panelLeaks].join(', ')}` : 'clean');
  check('§72: the device stores salon and ad data only — no customer', !/Sophia|Liam|Olivia|215555/.test(stored), `${Object.keys(JSON.parse(stored)).join(', ')}`);
  const sess = (await client.query(`select state, closed_at from customer_display_sessions where id = $1`, [sentBody.sessionId])).rows[0];
  check('the display released the session on the server (completed, closed)', sess?.state === 'completed' && !!sess?.closed_at, sess?.state);
  await shot(dp, '08-back-to-advertising.png');

  // ── 6. §108 display reports ────────────────────────────────────────────────────────────────────────────────────────
  phase('6 reports');
  await dp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  let stat = null;
  for (let i = 0; i < 40 && !stat; i++) { await sleep(150); stat = (await client.query(`select sum(display_count)::int as n, sum(display_ms)::bigint as ms from display_ad_display_stats where tenant_id = $1 and ad_id = $2 and device_id = $3`, [T, ad.id, DEV])).rows[0]; if (!stat?.n) stat = null; }
  await dp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('§108 the display reported the slots its ad was on screen (counted as displays)', !!stat && stat.n >= 2 && Number(stat.ms) >= 2000, stat ? `${stat.n} displays, ${Math.round(Number(stat.ms) / 1000)} s on screen` : 'no rows');

  // ── 7. §72 the API goes away ───────────────────────────────────────────────────────────────────────────────────────
  phase('7 offline');
  await stopApi();
  info('API stopped (the display\'s server is unreachable from here on)');
  await sleep(17000);   // past the 15-second safety sync and two fallback polls
  const stillImg = await right.locator('img').first().evaluate((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })).catch(() => null);
  check('§72 network down: the ad keeps playing, no error over the screen', (await right.getAttribute('data-mode')) === 'ads' && !!stillImg && stillImg.w > 0 && (await dp.getByText('Connecting…').count()) === 0, stillImg ? `${stillImg.src.slice(0, 12)}…` : 'no picture');
  await dp.reload();
  await dp.locator('[data-testid="display-23"][data-offline="true"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  await dp.waitForFunction(() => { const i = document.querySelector('[data-testid="right-panel"] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 }).catch(() => undefined);
  const offImg = await right.locator('img').first().evaluate((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })).catch(() => null);
  const offHead = (await dp.locator('.d23-head').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('§72 restarted with the API still down: the salon (remembered) and its saved ad (from the device cache)', (await dp.locator('[data-testid="display-23"][data-offline="true"]').count()) === 1 && !!offImg && offImg.src.startsWith('blob:') && offImg.w > 0 && offHead.includes(salon.display_name),
    `${offImg?.src.slice(0, 12) ?? 'no picture'} · header "${offHead.slice(0, 60)}"`);
  check('…and says so honestly: no check-in until the server answers', (await dp.getByText('We’re temporarily offline. Please see the receptionist.').count()) === 1 && (await dp.locator('.d23-key').count()) === 0);
  await shot(dp, '09-restart-while-offline.png');
  startApi();
  check('API restarted', await up(API + '/health/ready'));
  const tBack = Date.now();
  await dp.locator('[data-testid="display-23"]:not([data-offline])').waitFor({ timeout: 30000 }).catch(() => undefined);
  await dp.waitForFunction(() => { const b = [...document.querySelectorAll('.d23-key')].find((x) => x.textContent === '5'); return !!b && !b.disabled; }, null, { timeout: 20000 }).catch(() => undefined);
  check('the API is back → the display reconnects by itself: check-in returns, the ad keeps playing', (await dp.locator('[data-testid="display-23"]:not([data-offline])').count()) === 1 && (await dp.locator('.d23-key').count()) === 12 && (await right.locator('img').count()) >= 1, `${Date.now() - tBack} ms after the API answered`);
  await shot(dp, '10-reconnected.png');
  check('no uncaught errors in the display or the POS page', dErrors.length === 0 && pErrors.length === 0, [...dErrors, ...pErrors].slice(0, 2).join(' | '));
} catch (e) {
  if (dp) await shot(dp, 'FAIL-display.png');
  if (pp) await shot(pp, 'FAIL-pos.png');
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400));
} finally {
  phase('cleanup');
  await restore();
  await client.end();
}
if (walkInId) info(`the walk-in stays in the branch queue (id ${walkInId})`);
if (failed && apiErr.trim()) info('API stderr (tail): ' + apiErr.trim().split('\n').slice(-4).join(' | ').slice(0, 400));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => !r.startsWith('INFO')).length - failed}/${results.filter((r) => !r.startsWith('INFO')).length} checks passed · screenshots: ${SHOTS}`);
clearTimeout(watchdog);
process.exit(failed ? 1 : 0);
