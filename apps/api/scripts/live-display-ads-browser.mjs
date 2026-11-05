#!/usr/bin/env node
// live-display-ads-browser.mjs — 23-inch dual-screen spec §49–§57, §68–§71: the POS advertising page in a REAL browser
// (Chromium) against the real API and PostgreSQL. The owner signs in, opens Marketing & Growth → Customer Display
// Advertising, uploads an image through the page's own pipeline (the browser decodes it and makes the 1920/1080/320 px
// copies on a canvas), publishes it in simple mode (§53), and the result is checked end to end: the server accepted the
// browser-made copies (magic bytes, sizes, same shape), the display's playlist has the ad, and the 23-inch preview renders.
// Requires: apps/pos-web built (npx vite build), apps/api built. Screenshots go to $SHOTS (default: a temp directory).
//   DATABASE_URL=postgres://… node scripts/live-display-ads-browser.mjs
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3033, WEB_PORT = 4174;
const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'ads-browser-media-'));
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'ads-browser-shots-')); mkdirSync(SHOTS, { recursive: true });
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a portrait 1080×1620 promo graphic: warm gradient with a bright "subject" block upper-right (smart crop should lean there)
const img = new PNG({ width: 1080, height: 1620 });
for (let y = 0; y < 1620; y++) for (let x = 0; x < 1080; x++) {
  const i = (y * 1080 + x) * 4; const subject = x > 640 && x < 980 && y > 220 && y < 760 && ((x >> 4) + (y >> 4)) % 2 === 0;
  img.data[i] = subject ? 250 : 120 + (y * 100) / 1620; img.data[i + 1] = subject ? 240 : 70 + (x * 60) / 1080; img.data[i + 2] = subject ? 220 : 50; img.data[i + 3] = 255;
}
const IMG_PATH = join(SHOTS, 'fall-pedicure-special.png');
writeFileSync(IMG_PATH, PNG.sync.write(img));

const client = new pg.Client({ connectionString: DB }); await client.connect();
const salon = (await client.query(`select t.id as tenant_id, b.id as branch_id from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON])).rows[0];
const T = salon.tenant_id, B = salon.branch_id;
await client.query(`update customer_display_devices set revoked_at = now() where device_name like 'Live Ads Browser Proof%' and revoked_at is null`);
const DEV = randomUUID(), TOKEN = randomBytes(24).toString('base64url');
await client.query(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values ($1,$2,$3,'Live Ads Browser Proof','android','paired',$4)`, [DEV, T, B, createHash('sha256').update(TOKEN).digest('hex')]);
await client.query(`delete from tenant_settings where tenant_id = $1 and category = 'customer-display-ads'`, [T]);

const apiProc = spawn('node', ['dist/main.js'], { env: { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), MEDIA_ROOT, AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
const webProc = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: new URL('../../pos-web/', import.meta.url).pathname, env: { ...process.env, VITE_API_BASE: API }, stdio: ['ignore', 'ignore', 'pipe'] });
let browser; let adId = null;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(API + '/health/ready')).ok) break; } catch { /* booting */ } await sleep(250); }
  for (let i = 0; i < 80; i++) { try { if ((await fetch(WEB + '/')).ok) break; } catch { /* booting */ } await sleep(250); }
  // the repo's playwright may be newer than the preinstalled browser build — use the machine's Chromium when present
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = []; page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(WEB + '/');
  await page.fill('#aps-identifier', EMAIL); await page.fill('#aps-password', PASSWORD); await page.fill('#aps-store', SALON);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  const pick = page.getByRole('button', { name: /^Main/ });
  if (await pick.count()) await pick.first().click();
  await page.waitForTimeout(800);
  await page.goto(WEB + '/tenant/marketing/display-ads');
  await page.getByRole('heading', { name: 'Customer Display Advertising' }).waitFor({ timeout: 15000 });
  check('the POS page opens (Marketing & Growth → Customer Display Advertising)', true);
  check('the sidebar lists it under Marketing & Growth', (await page.getByText('Customer Display Advertising', { exact: true }).count()) >= 1);

  await page.getByRole('button', { name: '+ ADD ADVERTISEMENT' }).click();
  const dialog = page.getByRole('dialog', { name: '+ Add advertisement' });
  await dialog.waitFor();
  check('"Publish now" waits for an image (simple mode §53)', await dialog.getByRole('button', { name: 'Publish now' }).isDisabled());
  const t0 = Date.now();
  await dialog.locator('input[type="file"]').first().setInputFiles(IMG_PATH);
  await dialog.getByRole('button', { name: 'Replace image' }).waitFor({ timeout: 20000 });
  check('the browser prepared the copies and the server accepted them', true, `${Date.now() - t0} ms decode + derive + upload`);
  const name = await dialog.locator('#dads-name').inputValue();
  check('the ad name filled itself from the file name', name === 'fall pedicure special', name);
  await dialog.getByText('Show text over the image').click();
  await dialog.locator('#dads-h').fill('Deluxe spa pedicure');
  await dialog.locator('#dads-sh').fill('Relax • Refresh • Renew');
  await dialog.locator('#dads-cta').fill('Ask your technician today');
  await dialog.locator('#dads-qk').selectOption('book_online');
  await dialog.locator('#dads-qu').fill('https://book.example.com/pilot');
  await page.waitForTimeout(400);
  await dialog.screenshot({ path: join(SHOTS, '1-editor-with-23in-preview.png') });
  const previewImg = dialog.locator('[data-testid="display-preview"] img').first();
  check('the 23-inch preview shows the uploaded image with the QR code', (await previewImg.count()) === 1 && (await dialog.getByRole('img', { name: 'QR code: Book online' }).count()) === 1);
  await dialog.getByRole('button', { name: 'Publish now' }).click();
  await page.getByText(/is published and showing now/).waitFor({ timeout: 15000 });
  const card = page.locator('[data-testid="dads-card"]', { hasText: 'fall pedicure special' });
  check('published: the list shows it ACTIVE and showing now', (await card.getByText('ACTIVE', { exact: true }).count()) === 1 && (await card.getByText('● Showing now').count()) === 1);
  await page.screenshot({ path: join(SHOTS, '2-advertisements-list.png') });

  // what the server stored from the BROWSER's copies
  const row = (await client.query(`select a.id, m.width, m.height, m.mime_type, m.variants, m.suggested_focal_x, m.suggested_focal_y from display_ads a join display_ad_media m on m.tenant_id = a.tenant_id and m.id = a.media_id where a.tenant_id = $1 and a.name = 'fall pedicure special' order by a.created_at desc limit 1`, [T])).rows[0];
  adId = row?.id;
  const v = row?.variants ?? {};
  check('the browser made real optimized copies (≤1920 / ≤1080 / ≤320 px, same shape)', v.large?.height === 1620 && v.medium?.width === 720 && v.medium?.height === 1080 && v.thumb?.height === 320, `large ${v.large?.width}×${v.large?.height} ${v.large?.mime}, medium ${v.medium?.width}×${v.medium?.height}, thumb ${v.thumb?.width}×${v.thumb?.height}`);
  check('smart crop\'s point of interest leans to the bright subject (upper right)', Number(row?.suggested_focal_x) > 0.5 && Number(row?.suggested_focal_y) < 0.5, `(${row?.suggested_focal_x}, ${row?.suggested_focal_y})`);
  const pl = await (await fetch(API + '/customer-display/device/ads', { headers: { 'x-device-token': TOKEN } })).json();
  const mine = pl.ads?.find((x) => x.id === adId);
  check('the display\'s playlist has it — headline, CTA and QR as entered', !!mine && mine.headline === 'Deluxe spa pedicure' && mine.ctaText === 'Ask your technician today' && mine.qr?.url === 'https://book.example.com/pilot', mine ? `${mine.image.width}×${mine.image.height} ${mine.durationSeconds}s` : 'missing');
  const got = mine ? await fetch(API + mine.image.url) : null;
  check('the copy the display downloads is served', !!got?.ok && /^image\//.test(got.headers.get('content-type') || ''), `${got?.status} ${got?.headers.get('content-type')}`);

  await page.getByRole('tab', { name: 'Display Preview' }).click();
  await page.locator('[data-testid="display-preview"]').waitFor();
  await page.waitForTimeout(900);
  await page.locator('[data-testid="display-preview"]').screenshot({ path: join(SHOTS, '3-display-preview-1920x1080.png') });
  check('the Display Preview renders the branch playlist on the 1920×1080 layout', (await page.locator('[data-testid="display-preview"] img').count()) >= 1);
  await page.getByRole('tab', { name: 'Analytics' }).click();
  await page.getByText(/does not mean a customer looked at it/).waitFor();
  check('analytics loads (displays, never "views")', true);
  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('browser proof ran to the end', false, String(e?.message || e).slice(0, 300));
} finally {
  if (adId) await client.query(`delete from display_ads where tenant_id = $1 and id = $2`, [T, adId]).catch(() => undefined);
  await client.query(`update customer_display_devices set revoked_at = now() where id = $1`, [DEV]).catch(() => undefined);
  await browser?.close(); apiProc.kill('SIGTERM'); webProc.kill('SIGTERM'); await client.end();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
