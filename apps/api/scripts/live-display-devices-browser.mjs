#!/usr/bin/env node
// live-display-devices-browser.mjs — 23-inch dual-screen spec, Unit 6 (§8–§12, §81–§86, §97–§98, §122–§125): the customer
// display as a DEVICE, in a REAL browser (Chromium, 1920×1080) against the real API and PostgreSQL.
//   1. pairing: a display with no credential shows an 8-digit code (no login, nothing to type); the owner adds a register
//      and pairs the display from POS → Devices → Customer Displays; the display collects its credential (kept in the
//      device's store — never in the address) and becomes the 23-inch screen
//   2. the POS sees it (§86): connected, mode, app version, resolution, profile, register — from the display's own heartbeat
//   3. checkout (§81–§82): the Checkout card says Connected; this POS's register is chosen; Send to Display → the customer's
//      ticket on the display and "Active — Showing Mia's checkout" on the POS; Refresh Display reloads the display
//   4. the receipt step (§97–§98): after payment the display asks how the receipt should go — the 3 seconds wait; the
//      customer taps "Text my receipt"; the outcome is said honestly (no SMS provider here → "couldn't send"); then 3 s,
//      the customer is gone, the ads are back
//   5. maintenance (§85): the owner switches it on → the display shows a maintenance screen; off → back
//   6. offline (§83, §124): the display goes quiet → the POS card says Offline and "continue checkout on the POS", Send is
//      disabled, and "Open on second screen" opens the display in its own window (§125)
//   7. revoke (§85): the owner revokes it → the display forgets its credential and shows a new pairing code
// Requires: apps/api built; apps/customer-display built; apps/pos-web built with VITE_CUSTOMER_DISPLAY_URL=http://127.0.0.1:4177
//   DATABASE_URL=postgres://… CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/live-display-devices-browser.mjs
// The API runs with a DUMMY Twilio account (TWILIO_* below): SMS counts as configured, and every send is refused by Twilio
// (or never leaves this machine) — so the proof shows the failure path honestly; no message can be delivered.
// Restores the settings rows it touched; revokes its displays and retires its register; leaves the proof ticket and
// customer ("Mia Proof", a 555 number). Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3036, DISPLAY_PORT = 4177, POS_PORT = 4178;
const API = `http://127.0.0.1:${API_PORT}`, DISPLAY = `http://127.0.0.1:${DISPLAY_PORT}`, POS = `http://127.0.0.1:${POS_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'd23-devices-shots-')); mkdirSync(SHOTS, { recursive: true });
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const info = (s) => results.push(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T_START = Date.now();
const phase = (name) => process.stderr.write(`[${((Date.now() - T_START) / 1000).toFixed(1)}s] ${name}\n`);

// ── seed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const salon = (await client.query(`select t.id as tenant_id, t.display_name, b.id as branch_id, b.name as branch_name from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON])).rows[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, B = salon.branch_id;
const CATS = ['customer-display-devices', 'receipts-branding'];
const settingsBefore = (await client.query(`select * from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS])).rows;
// earlier runs: their displays revoked, their register retired — this proof starts from a branch with no live proof display
await client.query(`update customer_display_devices set revoked_at = now(), pairing_status = 'unpaired', device_token_hash = null where tenant_id = $1 and device_name like 'Live Pair Proof%' and revoked_at is null`, [T]);
await client.query(`update pos_stations set retired_at = now() where tenant_id = $1 and name like 'Live Register%' and retired_at is null`, [T]);
// other live displays in this branch would compete for "Send to Display" — note them (the proof sends by register)
const others = (await client.query(`select count(*)::int n from customer_display_devices where tenant_id = $1 and branch_id = $2 and revoked_at is null and pairing_status = 'paired'`, [T, B])).rows[0].n;
// the salon asks for receipts on the display (its defaults); Mia has a phone and an address on file
await client.query(`delete from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]);
const CUST = randomUUID(), TK = randomUUID(), TECH = randomUUID();
const PHONE = '(555) 010-' + String(1000 + Math.floor(Math.random() * 8999));
await client.query(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, email) values ($1,$2,$3,'Mia','Proof','Mia Proof',$4,'mia.proof@example.com')`, [CUST, T, B, PHONE]);
await client.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, B, CUST]);
await client.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Nora','Proof','Nora Proof')`, [TECH, T, B]);
const svc = (await client.query(`select id, name, price_cents, duration_minutes from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 1`, [T])).rows[0];
if (!svc) { console.error('the salon needs an active service'); process.exit(2); }
await client.query(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$7,'percent',55)`,
  [T, B, TK, svc.id, TECH, svc.name, Number(svc.price_cents), Number(svc.duration_minutes || 30)]);

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
  TWILIO_ACCOUNT_SID: 'ACliveproof0000000000000000000000', TWILIO_AUTH_TOKEN: 'not-a-real-token', TWILIO_FROM: '+15550000000' };
let apiErr = '';
const apiProc = spawn('node', ['dist/main.js'], { env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
apiProc.stderr.on('data', (c) => { apiErr += c; });
const vite = (app, port) => spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: new URL(`../../${app}/`, import.meta.url).pathname, env: { ...process.env, VITE_API_BASE: API }, stdio: ['ignore', 'ignore', 'pipe'] });
const displayProc = vite('customer-display', DISPLAY_PORT);
const posProc = vite('pos-web', POS_PORT);
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };

let browser; let deviceId = null; let stationId = null;
let restored = false;
const restore = async () => {
  if (restored) return; restored = true;
  await client.query(`delete from tenant_settings where tenant_id = $1 and category = any($2)`, [T, CATS]).catch(() => undefined);
  for (const r of settingsBefore) {
    await client.query(`insert into tenant_settings (id, tenant_id, branch_id, category, settings_json, updated_by_user_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.tenant_id, r.branch_id, r.category, JSON.stringify(r.settings_json), r.updated_by_user_id, r.created_at, r.updated_at]).catch(() => undefined);
  }
  await client.query(`update customer_display_devices set revoked_at = now(), pairing_status = 'unpaired', device_token_hash = null where tenant_id = $1 and device_name like 'Live Pair Proof%' and revoked_at is null`, [T]).catch(() => undefined);
  await client.query(`update pos_stations set retired_at = now() where tenant_id = $1 and name like 'Live Register%' and retired_at is null`, [T]).catch(() => undefined);
  await client.query(`update customer_display_sessions set state = 'disconnected', closed_at = now() where tenant_id = $1 and ticket_id = $2 and closed_at is null`, [T, TK]).catch(() => undefined);
  await browser?.close().catch(() => undefined);
  apiProc.kill('SIGTERM'); displayProc.kill('SIGTERM'); posProc.kill('SIGTERM');
};
const watchdog = setTimeout(async () => {
  check('the proof finished within 8 minutes', false, 'watchdog fired');
  await Promise.race([restore(), sleep(20000)]).catch(() => undefined);
  console.log(results.join('\n'));
  try { apiProc.kill('SIGKILL'); displayProc.kill('SIGKILL'); posProc.kill('SIGKILL'); } catch { /* */ }
  process.exit(1);
}, 8 * 60_000);
const shot = async (page, name) => { try { await page.screenshot({ path: join(SHOTS, name) }); } catch { /* best effort */ } };

try {
  check('API booted (health/ready)', await up(API + '/health/ready'));
  check('display and POS served (vite preview, same-origin proxy to the API)', (await up(DISPLAY + '/')) && (await up(POS + '/')));
  if (others) info(`${others} other paired display(s) in ${salon.branch_name} — the proof sends by register, so they are not used`);
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── 1. the display pairs itself ─────────────────────────────────────────────────────────────────────────────────────
  phase('1 pairing');
  const dctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  let dp = await dctx.newPage();
  const dErrors = []; const onErr = (e) => dErrors.push(String(e));
  dp.on('pageerror', onErr);
  await dp.goto(DISPLAY + '/');
  await dp.getByTestId('pairing-code').waitFor({ timeout: 20000 });
  const code = (await dp.getByTestId('pairing-code').innerText()).replace(/\D/g, '');
  check('a display with no credential shows an 8-digit pairing code — no login, nothing to type', /^\d{8}$/.test(code) && (await dp.locator('input').count()) === 0 && (await dp.getByText(/Devices → Customer Displays/).count()) === 1, `code ${code.slice(0, 4)} ${code.slice(4)}`);
  check('…and a full-screen button for a browser display (§122)', (await dp.getByTestId('fullscreen-button').count()) === 1);
  await shot(dp, '01-pairing-code.png');
  const pRow = (await client.query(`select code_hash, tenant_id from customer_display_pairings where expires_at > now() and claimed_at is null order by created_at desc limit 1`)).rows[0];
  check('the server keeps only the code\'s HASH, bound to no salon yet', !!pRow && pRow.code_hash.length === 64 && !pRow.code_hash.includes(code) && pRow.tenant_id === null);

  const pctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const pp = await pctx.newPage();
  const pErrors = []; pp.on('pageerror', (e) => pErrors.push(String(e)));
  await pp.goto(POS + '/');
  await pp.fill('#aps-identifier', EMAIL); await pp.fill('#aps-password', PASSWORD); await pp.fill('#aps-store', SALON);
  await pp.click('button[type="submit"]');
  await pp.waitForTimeout(1500);
  const pick = pp.getByRole('button', { name: /^Main/ });
  if (await pick.count()) await pick.first().click();
  await pp.waitForTimeout(800);
  await pp.goto(POS + '/tenant/devices/customer-displays');
  await pp.getByTestId('customer-displays-screen').waitFor({ timeout: 20000 });
  const regName = 'Live Register ' + String(Date.now()).slice(-4);
  await pp.getByLabel('New register name').fill(regName);
  await pp.getByRole('button', { name: 'Add register' }).click();
  await pp.getByText('Register added.').waitFor({ timeout: 10000 });
  stationId = (await client.query(`select id from pos_stations where tenant_id = $1 and name = $2 and retired_at is null`, [T, regName])).rows[0]?.id ?? null;
  check('the owner adds a register (Devices → Customer Displays → Registers)', !!stationId, regName);
  await pp.getByRole('button', { name: '+ PAIR A DISPLAY' }).click();
  await pp.getByLabel('Pairing code').fill(code);
  await pp.getByLabel('Display name').fill('Live Pair Proof');
  await pp.getByLabel('Register', { exact: true }).selectOption(stationId);
  await shot(pp, '02-pos-pair-form.png');
  const tPair = Date.now();
  await pp.getByRole('button', { name: 'Pair display' }).click();
  // the note now carries a leading "✓" (POS success notes) — match the message, not the start of the element (M7 regression)
  await pp.getByText(/Paired\./).waitFor({ timeout: 10000 });
  const dev = (await client.query(`select id, tenant_id, branch_id, pos_station_id, device_type, pairing_status from customer_display_devices where tenant_id = $1 and device_name = 'Live Pair Proof' and revoked_at is null`, [T])).rows[0];
  deviceId = dev?.id ?? null;
  check('the code binds a display to THIS salon and branch (the owner\'s session — the display chose nothing), dedicated to the register', !!dev && dev.branch_id === B && dev.pos_station_id === stationId && dev.device_type === 'web_display');
  await dp.getByTestId('display-23').waitFor({ timeout: 20000 });
  const pairedMs = Date.now() - tPair;
  const stored = await dp.evaluate(() => ({ token: localStorage.getItem('aps.customerDisplay.deviceToken'), href: location.href }));
  const tokRow = (await client.query(`select device_token_hash, pairing_status, last_seen_at is not null as seen from customer_display_devices where id = $1`, [deviceId])).rows[0];
  check('the display collected its credential and became the 23-inch screen', !!stored.token && stored.token.length >= 40 && tokRow?.pairing_status === 'paired' && tokRow.device_token_hash?.length === 64, `${pairedMs} ms after the owner pressed Pair`);
  check('the credential is in the device\'s store — never in the address, never stored in plain on the server', !stored.href.includes(stored.token ?? '#') && tokRow?.device_token_hash !== stored.token);
  await shot(dp, '03-paired-23in.png');

  // ── 2. the POS sees it (§86) ─────────────────────────────────────────────────────────────────────────────────────────
  phase('2 device view');
  let row = null;
  for (let i = 0; i < 40; i++) {
    await pp.getByRole('button', { name: 'Refresh', exact: true }).first().click().catch(() => undefined);
    await sleep(500);
    row = await pp.getByTestId('display-row').filter({ hasText: 'Live Pair Proof' }).first().innerText().catch(() => null);
    if (row && /Connected/.test(row) && /1920×1080/.test(row)) break;
  }
  check('POS Devices → Customer Displays: connected, the register, 23" landscape, 1920×1080, its mode and version — from its own heartbeat', !!row && /Connected/.test(row) && row.includes(regName) && row.includes('23" landscape') && row.includes('1920×1080') && /(Advertising|Online|Check-in)/.test(row) && /\d+\.\d+\.\d+/.test(row), (row ?? '').replace(/\s+/g, ' ').slice(0, 160));
  await shot(pp, '04-pos-displays-table.png');

  // ── 3. checkout (§81–§82) ────────────────────────────────────────────────────────────────────────────────────────────
  phase('3 checkout');
  await pp.goto(POS + '/checkout');
  const card = pp.getByTestId('customer-display-card');
  await card.waitFor({ timeout: 20000 });
  await pp.getByLabel("This POS's register").selectOption(stationId);
  await pp.waitForTimeout(400);
  check('Checkout → Customer Display: ● Connected, this POS\'s register chosen, its display named', (await pp.getByTestId('customer-display-status').innerText()).includes('Connected') && (await pp.getByTestId('customer-display-detail').innerText()).includes('Live Pair Proof'));
  // open Mia's ticket in the workspace
  await pp.getByText('Mia Proof').first().click();
  await pp.waitForTimeout(1200);
  const t0 = Date.now();
  await card.getByRole('button', { name: 'Send to Display' }).click();
  const right = dp.locator('[data-testid="right-panel"]');
  await dp.locator('[data-testid="right-panel"][data-mode="checkout"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const ckText = (await right.innerText()).replace(/\s+/g, ' ');
  const sess = (await client.query(`select display_device_id, pos_station_id from customer_display_sessions where tenant_id = $1 and ticket_id = $2 and closed_at is null`, [T, TK])).rows[0];
  check('Send to Display used THIS register\'s display: Mia\'s ticket takes the right panel', (await right.getAttribute('data-mode')) === 'checkout' && ckText.includes(svc.name) && sess?.display_device_id === deviceId && sess?.pos_station_id === stationId, `${Date.now() - t0} ms`);
  await pp.waitForFunction(() => /Active/.test(document.querySelector('[data-testid="customer-display-status"]')?.textContent || ''), null, { timeout: 15000 }).catch(() => undefined);
  check('…and the POS card says ● Active — "Showing Mia’s checkout"', (await pp.getByTestId('customer-display-status').innerText()).includes('Active') && (await pp.getByTestId('customer-display-detail').innerText()).includes('Showing Mia’s checkout'));
  await shot(pp, '05-pos-card-active.png'); await shot(dp, '06-display-checkout.png');
  // Refresh Display: the display asks for its state again
  let refetched = 0; const onResp = (r) => { if (r.url().includes('/customer-display/device/current')) refetched++; };
  dp.on('response', onResp);
  await card.getByRole('button', { name: 'Refresh Display' }).click();
  for (let i = 0; i < 30 && !refetched; i++) await sleep(100);
  dp.off('response', onResp);
  check('Refresh Display (§82): the display reloads its state at once — and keeps the checkout', refetched > 0 && (await right.getAttribute('data-mode')) === 'checkout', `${refetched} state fetch(es)`);

  // ── 4. the receipt step (§97–§98) ──────────────────────────────────────────────────────────────────────────────────
  phase('4 receipt');
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const paid = await fetch(`${API}/pos/checkout/tickets/${TK}/pay/cash`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'idempotency-key': 'live-devices-' + randomUUID() }, body: JSON.stringify({ amountReceivedCents: 50000 }) });
  check('POS took the cash payment', paid.ok, String(paid.status));
  await dp.locator('[data-testid="right-panel"][data-mode="receipt"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const askText = (await right.innerText()).replace(/\s+/g, ' ');
  const last4 = PHONE.slice(-4);
  check('after payment the display asks how the receipt should go — the phone MASKED; email not offered (no email provider is configured here)', (await right.getAttribute('data-mode')) === 'receipt' && askText.includes(`Text my receipt to (•••) •••-${last4}`) && askText.includes('No receipt') && !/Email my receipt/.test(askText) && !askText.includes(PHONE) && !askText.includes('mia.proof'), askText.slice(0, 140));
  await shot(dp, '07-receipt-choice.png');
  await sleep(4500);
  check('§97: the 3 seconds do NOT start while the customer is choosing (still on screen after 4.5 s)', (await right.getAttribute('data-mode')) === 'receipt' && (await right.innerText()).includes('How would you like your receipt?'));
  const tChoose = Date.now();
  await right.getByRole('button', { name: new RegExp(`Text my receipt to \\(•••\\) •••-${last4}`) }).click();
  await dp.locator('[data-testid="right-panel"][data-mode="completed"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const doneText = (await right.innerText()).replace(/\s+/g, ' ');
  const rcpt = (await client.query(`select receipt_choice, receipt_status from customer_display_sessions where tenant_id = $1 and ticket_id = $2 order by created_at desc limit 1`, [T, TK])).rows[0];
  check('the choice is recorded once and sent through the POS\'s receipt delivery; with no real SMS provider the display says so — never "texted"', rcpt?.receipt_choice === 'sms' && rcpt?.receipt_status === 'failed' && /couldn’t send your receipt/.test(doneText) && !/Receipt texted/.test(doneText), `${rcpt?.receipt_choice}/${rcpt?.receipt_status}`);
  await shot(dp, '08-receipt-outcome.png');
  const tDone = Date.now();
  await dp.locator('[data-testid="right-panel"][data-mode="ads"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  const holdMs = Date.now() - tDone;
  const after = await dp.evaluate(() => document.documentElement.outerHTML + JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  check('§98: then the completed screen for ~3 s, the customer destroyed, advertising again', (await right.getAttribute('data-mode')) === 'ads' && holdMs >= 2300 && holdMs <= 4800 && !after.includes('Mia') && !after.includes(last4), `${holdMs} ms after the outcome (${tDone - tChoose} ms to send)`);

  // ── 5. maintenance (§85) ───────────────────────────────────────────────────────────────────────────────────────────
  phase('5 maintenance');
  await pp.goto(POS + '/tenant/devices/customer-displays');
  const proofRow = pp.getByTestId('display-row').filter({ hasText: 'Live Pair Proof' }).first();
  await proofRow.waitFor({ timeout: 15000 });
  await proofRow.getByRole('button', { name: 'Maintenance' }).click();
  await dp.getByTestId('maintenance').waitFor({ timeout: 15000 }).catch(() => undefined);
  check('maintenance on (the owner) → the display shows a maintenance screen at once — no check-in, no ads', (await dp.getByTestId('maintenance').count()) === 1 && (await dp.locator('[data-testid="display-23"]').count()) === 0);
  await shot(dp, '09-maintenance.png');
  await proofRow.getByRole('button', { name: 'End maintenance' }).click();
  await dp.getByTestId('display-23').waitFor({ timeout: 15000 }).catch(() => undefined);
  check('maintenance off → the 23-inch screen is back', (await dp.getByTestId('display-23').count()) === 1);

  // ── 6. offline (§83, §124) and opening the display on the second screen (§125) ─────────────────────────────────────
  phase('6 offline');
  await dp.close();
  await client.query(`update customer_display_devices set last_seen_at = now() - interval '2 minutes' where id = $1`, [deviceId]);   // fast-forward past the 75 s window
  await pp.goto(POS + '/checkout');
  await pp.getByTestId('customer-display-card').waitFor({ timeout: 20000 });
  await pp.waitForFunction(() => /Offline/.test(document.querySelector('[data-testid="customer-display-status"]')?.textContent || ''), null, { timeout: 15000 }).catch(() => undefined);
  const offDetail = await pp.getByTestId('customer-display-detail').innerText();
  check('the display went quiet → the POS card says ● Offline — "continue checkout on the POS" (§83, §124)', (await pp.getByTestId('customer-display-status').innerText()).includes('Offline') && /continue checkout on the POS/.test(offDetail), offDetail);
  const toDisplay = pp.getByRole('button', { name: 'To Display' });
  check('…To Display is disabled (the checkout itself carries on at the POS)', (await toDisplay.count()) === 0 || await toDisplay.first().isDisabled());
  const openBtn = pp.getByRole('button', { name: 'Open on second screen' });
  check('…and "Open on second screen" is offered (VITE_CUSTOMER_DISPLAY_URL set)', (await openBtn.count()) === 1);
  if (await openBtn.count()) {
    const [popup] = await Promise.all([pp.waitForEvent('popup', { timeout: 10000 }).catch(() => null), openBtn.click()]);
    // the popup event fires before the new window has navigated (url '' / about:blank) — wait for its own address (M7 run)
    if (popup) await popup.waitForURL((u) => String(u).startsWith(DISPLAY), { timeout: 10000 }).catch(() => undefined);
    check('§125: it opens the customer display in its own window (placement needs the browser\'s permission — said, not assumed)', !!popup && popup.url().startsWith(DISPLAY), popup ? popup.url() : 'no window');
    const note = await pp.getByTestId('customer-display-note').innerText().catch(() => '');
    info(`POS note after opening: ${note}`);
    await popup?.close().catch(() => undefined);
  }
  await shot(pp, '10-pos-card-offline.png');

  // ── 7. revoke (§85) ──────────────────────────────────────────────────────────────────────────────────────────────────
  phase('7 revoke');
  dp = await dctx.newPage(); dp.on('pageerror', onErr);
  await dp.goto(DISPLAY + '/');
  await dp.getByTestId('display-23').waitFor({ timeout: 20000 });
  check('the display restarts with its stored credential (no address, no re-pairing)', (await dp.getByTestId('display-23').count()) === 1);
  await pp.goto(POS + '/tenant/devices/customer-displays');
  const row2 = pp.getByTestId('display-row').filter({ hasText: 'Live Pair Proof' }).first();
  await row2.waitFor({ timeout: 15000 });
  await row2.getByRole('button', { name: 'Revoke' }).click();
  await pp.getByRole('button', { name: 'Revoke display' }).click();
  await dp.getByTestId('pairing-code').waitFor({ timeout: 20000 }).catch(() => undefined);
  const afterRevoke = await dp.evaluate(() => localStorage.getItem('aps.customerDisplay.deviceToken'));
  const devAfter = (await client.query(`select device_token_hash, pairing_status, revoked_at is not null as revoked from customer_display_devices where id = $1`, [deviceId])).rows[0];
  check('revoked → the display forgets its credential and shows a NEW pairing code', (await dp.getByTestId('pairing-code').count()) === 1 && afterRevoke === null && devAfter?.revoked === true && devAfter.device_token_hash === null);
  await shot(dp, '11-revoked-pairing-again.png');
  const audit = (await client.query(`select action_type from audit_logs where tenant_id = $1 and entity_id = $2 order by created_at`, [T, deviceId])).rows.map((r) => r.action_type);
  check('every device action is in the audit log', ['customer_display_paired', 'customer_display_connected', 'customer_display_maintenance_on', 'customer_display_maintenance_off', 'customer_display_revoked'].every((a) => audit.includes(a)), audit.join(' → '));
  check('no uncaught errors in the display or the POS page', dErrors.length === 0 && pErrors.length === 0, [...dErrors, ...pErrors].slice(0, 2).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 400));
} finally {
  clearTimeout(watchdog);
  await Promise.race([restore(), sleep(20000)]);
  await client.end().catch(() => undefined);
  if (apiErr.includes('Error')) info('API stderr tail: ' + apiErr.split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' | ').slice(0, 300));
  console.log(results.join('\n'));
  console.log(`\nscreenshots: ${SHOTS}`);
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}
