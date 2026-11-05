#!/usr/bin/env node
// live-display-checkin-browser.mjs — 23-inch dual-screen spec, Unit 7 (§8, §12, §14–§28): the guest's own check-in on the
// customer display, in a REAL browser (Chromium) against the real API and PostgreSQL.
//   1. one device identity (§8, §12, §18): a paired display in a branch with NO Go Check-In kiosk checks its guests in with
//      ITS OWN credential — the session row names the display and no kiosk; the request names no salon and no branch
//   2. the branch's catalog and prices (§22–§23): the same "Gel Manicure" costs one thing on the proof branch's display and
//      the salon's own Main price on Main's display; neither shows the other branch's services
//   3. who may be asked for (§25): working today at THIS branch and qualified for every chosen service; a later shift says
//      when it starts; not scheduled, switched off by the front desk, or another branch's technician: never listed
//   4. a visit of several services (§16–§17): "Today at …", every service with its technician (first names), compact with
//      "+ 1 more"; one "I'm Here" checks both appointments in; the footer's band is the queue engine's estimate (§26–§27)
//   5. a walk-in with services and an add-on (§20–§24): the add-on only with a service; the queue entry carries the
//      branch's prices, the add-on attached to its service, the preferred technician; a new customer profile by phone
//   6. one session per guest: eleven guests, eleven lookups, none refused (one session for the day refused the ninth);
//      within ONE session the ninth lookup is still refused
//   7. a guest who walks away (§28, §105, §107): 90 s untouched → the screen clears and their session ends
//   8. the layout at 1920×1080, 1600×900 and 1366×768 with the visit opened and the walk-in fully used: no page scroll,
//      nothing cut off
//   9. maintenance and revoke stop the display's check-in at once: the session it holds is refused on its next request
// Requires: apps/api built; apps/customer-display built.
//   DATABASE_URL=postgres://… CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/live-display-checkin-browser.mjs
// Creates a proof branch in the salon and removes it at the end with everything in it (proof-cleanup.mjs); removes its
// Main display; restores the check-in settings it touched.
// Never point it at production.
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { chromium } = require('playwright');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3037, DISPLAY_PORT = 4179;
const API = `http://127.0.0.1:${API_PORT}`, DISPLAY = `http://127.0.0.1:${DISPLAY_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'd23-checkin-shots-')); mkdirSync(SHOTS, { recursive: true });
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

// the branch's wall clock
const local = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
};
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const clock = (m) => { const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const NOW = local();
if (NOW.minutes > 19 * 60) { console.error(`it is ${clock(NOW.minutes)} at the branch — the proof needs a working day ahead (a later shift, an appointment); run it before 7 pm ${TZ_NAME}`); process.exit(2); }

// ── seed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const salon = (await q(`select t.id as tenant_id, b.id as branch_id, b.name as branch_name from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 and b.deleted_at is null order by b.created_at limit 1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, MAIN = salon.branch_id;
// the service both branches offer: Main's manicure if it has one (else its first service) — the proof branch gets its own row
const mainGel = (await q(`select name, price_cents from services where tenant_id = $1 and branch_id = $2 and status = 'active' and archived_at is null order by (name ilike '%manicure%') desc, sort_order, name limit 1`, [T, MAIN]))[0];
if (!mainGel) { console.error(`${salon.branch_name} needs an active service`); process.exit(2); }
// earlier runs: their proof branches deleted, their displays revoked
await q(`delete from customer_display_devices where tenant_id = $1 and device_name like 'Live Check-In Proof%'`, [T]);
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Check-In Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
const checkinBefore = (await q(`select * from tenant_checkin_settings where tenant_id = $1`, [T]))[0] ?? null;
await q(`insert into tenant_checkin_settings (tenant_id, enabled, confirmation_timeout_seconds) values ($1, true, 5)
  on conflict (tenant_id) do update set enabled = true, confirmation_timeout_seconds = 5, appointment_checkin_enabled = true, walkin_checkin_enabled = true, service_selection_enabled = true,
  technician_preference_enabled = true, tenant_phone_lookup_enabled = true, show_wait_estimate = true, auto_send_to_queue = true, require_front_desk_approval = false`, [T]);

const B = randomUUID(), stamp = String(Date.now()).slice(-5);
const BRANCH_NAME = `Live Check-In Proof ${stamp}`;
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active',$4)`, [B, T, BRANCH_NAME, TZ_NAME]);
// the proof branch's own catalog: the same service as Main's first one, at ITS price; a pedicure; an add-on
const B_GEL_PRICE = Number(mainGel.price_cents) === 5000 ? 4500 : 5000;
const CAT = { mani: randomUUID(), pedi: randomUUID(), add: randomUUID() };
await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values ($1,$4,$5,'Manicure',1), ($2,$4,$5,'Pedicure',2), ($3,$4,$5,'Add-ons',3)`, [CAT.mani, CAT.pedi, CAT.add, T, B]);
const S = { gel: randomUUID(), spa: randomUUID(), art: randomUUID() };
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, sort_order, status) values
  ($1,$4,$5,$6,$9,45,$10,1,'active'), ($2,$4,$5,$7,'Spa Pedicure',50,6000,1,'active'), ($3,$4,$5,$8,'Nail Art',15,1000,1,'active')`,
  [S.gel, S.spa, S.art, T, B, CAT.mani, CAT.pedi, CAT.add, mainGel.name, B_GEL_PRICE]);
// the team: Olivia (manicure, here all day), Lisa (manicure + pedicure, from later today), Mia (pedicure, not scheduled but
// clocked in), Ava (manicure, not working today), Nora (manicure, scheduled — the front desk switched her off)
const TECH = { olivia: randomUUID(), lisa: randomUUID(), mia: randomUUID(), ava: randomUUID(), nora: randomUUID() };
for (const [k, first] of [['olivia', 'Olivia'], ['lisa', 'Lisa'], ['mia', 'Mia'], ['ava', 'Ava'], ['nora', 'Nora']]) {
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'Checkinproof',$4 || ' Checkinproof','active')`, [TECH[k], T, B, first]);
}
for (const [k, svc] of [['olivia', S.gel], ['lisa', S.gel], ['lisa', S.spa], ['mia', S.spa], ['ava', S.gel], ['nora', S.gel]]) {
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, TECH[k], svc]);
}
const allDay = { start: Math.max(0, NOW.minutes - 120), end: Math.min(23 * 60 + 59, NOW.minutes + 600) };
const LISA_FROM = Math.ceil((NOW.minutes + 61) / 60) * 60;
await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values
  ($1,$2,$3,$7,$8,$9,true), ($1,$2,$4,$7,$10,$11,true), ($1,$2,$5,$7,$8,$9,false), ($1,$2,$6,$7,$8,$9,true)`,
  [T, B, TECH.olivia, TECH.lisa, TECH.ava, TECH.nora, NOW.weekday, hhmm(allDay.start), hhmm(allDay.end), hhmm(LISA_FROM), hhmm(Math.min(23 * 60 + 59, LISA_FROM + 360))]);
await q(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values ($1,$2,$3,'available', now() - interval '3 hours'), ($1,$2,$3,'off_shift', now() - interval '5 minutes')`, [T, B, TECH.nora]);
await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4, now() - interval '1 hour', null, 'active')`, [T, B, TECH.mia, NOW.date]);
// Sophia's visit today: two appointments at the same time (one technician each) — three services
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const SOPHIA = randomUUID(), SOPHIA_PHONE = '55501' + rnd(5);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Sophia','Checkinproof','Sophia Checkinproof',$4,$5)`,
  [SOPHIA, T, B, '+1' + SOPHIA_PHONE, `(${SOPHIA_PHONE.slice(0, 3)}) ${SOPHIA_PHONE.slice(3, 6)}-${SOPHIA_PHONE.slice(6)}`]);
const APPT_AT = Math.ceil((NOW.minutes + 20) / 30) * 30;
const A1 = randomUUID(), A2 = randomUUID();
const appt = (id, tech, svcs, minutes, status) => q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
  values ($1,$2,$3,$4,$5,'Sophia Checkinproof','phone',$6,$7,$8,$9,$10,$11,'not_required')`, [id, T, B, tech, SOPHIA, JSON.stringify(svcs), NOW.date, hhmm(APPT_AT), hhmm(APPT_AT + minutes), minutes, status]);
await appt(A1, TECH.olivia, [{ serviceId: S.gel, serviceName: mainGel.name, durationMinutes: 45 }], 45, 'confirmed');
await appt(A2, TECH.mia, [{ serviceId: S.spa, serviceName: 'Spa Pedicure', durationMinutes: 50 }, { serviceName: 'Paraffin Dip', durationMinutes: 10 }], 60, 'booked');
// the displays: one in the proof branch, one in Main (pairing itself is Unit 6's proof — here they start paired)
const DEV_B = randomUUID(), DEV_M = randomUUID();
const TOK_B = randomBytes(32).toString('base64url'), TOK_M = randomBytes(32).toString('base64url');
await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status, device_token_hash) values
  ($1,$3,$4,'Live Check-In Proof','web_display','paired',$6), ($2,$3,$5,'Live Check-In Proof (Main)','web_display','paired',$7)`, [DEV_B, DEV_M, T, B, MAIN, sha(TOK_B), sha(TOK_M)]);
const kiosksInB = (await q(`select count(*)::int as n from go_checkin_devices where tenant_id = $1 and branch_id = $2`, [T, B]))[0].n;

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' };
let apiErr = '';
const apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
apiProc.stderr.on('data', (c) => { apiErr += c; });
const displayProc = spawn(process.execPath, ['../../node_modules/vite/bin/vite.js', 'preview', '--port', String(DISPLAY_PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: new URL('../../customer-display/', import.meta.url).pathname, env: { ...process.env, VITE_API_BASE: API }, stdio: ['ignore', 'ignore', 'pipe'] });
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };

let browser;
let restored = false;
const restore = async () => {
  if (restored) return; restored = true;
  await q(`delete from tenant_checkin_settings where tenant_id = $1`, [T]).catch(() => undefined);
  if (checkinBefore) {
    const cols = Object.keys(checkinBefore);
    await q(`insert into tenant_checkin_settings (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, cols.map((c) => checkinBefore[c])).catch(() => undefined);
  }
  await q(`delete from customer_display_devices where tenant_id = $1 and id = $2`, [T, DEV_M]).catch(() => undefined);   // its sessions go with it (cascade)
  await q(`update go_checkin_sessions set status = 'completed', completed_at = now() where display_device_id = any($1) and status = 'active'`, [[DEV_B, DEV_M]]).catch(() => undefined);
  // the proof branch and everything in it (its customers, appointments, queue, sessions, displays) — nothing is left
  // in the salon's POS; the audit trail is append-only and keeps its rows
  const gone = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  if (!gone.removed || gone.kept.some((t) => t !== 'audit_logs')) results.push(`INFO  proof branch cleanup: ${JSON.stringify(gone)}`);
  await browser?.close().catch(() => undefined);
  apiProc.kill('SIGTERM'); displayProc.kill('SIGTERM');
};
const watchdog = setTimeout(async () => {
  check('the proof finished within 10 minutes', false, 'watchdog fired');
  await Promise.race([restore(), sleep(20000)]).catch(() => undefined);
  console.log(results.join('\n'));
  try { apiProc.kill('SIGKILL'); displayProc.kill('SIGKILL'); } catch { /* */ }
  process.exit(1);
}, 10 * 60_000);
const shot = async (page, name) => { try { await page.screenshot({ path: join(SHOTS, name) }); } catch { /* best effort */ } };

try {
  check('API booted (health/ready)', await up(API + '/health/ready'));
  check('display served (vite preview, same-origin proxy to the API)', await up(DISPLAY + '/'));
  info(`proof branch "${BRANCH_NAME}" (${TZ_NAME}, now ${clock(NOW.minutes)}); Main = "${salon.branch_name}"`);
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  // the owner, working in the proof branch (for the engine's estimate, maintenance and revoke)
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  let cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const selCookies = (sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
  if (selCookies.length) { const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c])); for (const c of selCookies) jar.set(c.split('=')[0], c); cookie = [...jar.values()].join('; '); }
  const H = { cookie, 'content-type': 'application/json' };
  check('the owner signs in and works in the proof branch (select-branch)', login.ok && sel.ok, `login ${login.status}, select-branch ${sel.status}`);

  // the proof display, already paired (its credential in the device's store — never in the address)
  const dctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await dctx.addInitScript((t) => { try { if (!sessionStorage.getItem('proof.seeded')) { localStorage.setItem('aps.customerDisplay.deviceToken', t); sessionStorage.setItem('proof.seeded', '1'); } } catch { /* */ } }, TOK_B);
  const dp = await dctx.newPage();
  const dErrors = []; dp.on('pageerror', (e) => dErrors.push(String(e)));
  const starts = []; const held = [];
  dp.on('request', (r) => { if (r.url().endsWith('/customer-display/device/check-in/session')) starts.push({ url: r.url(), body: r.postData(), token: r.headers()['x-device-token'] }); });
  dp.on('response', async (r) => { if (r.url().endsWith('/customer-display/device/check-in/session') && r.ok()) { try { held.push(await r.json()); } catch { /* */ } } });
  const lookups = []; dp.on('response', (r) => { if (r.url().includes('/lookup-phone')) lookups.push(r.status()); });

  // ── 1. one device identity ─────────────────────────────────────────────────────────────────────────────────────────
  phase('1 identity');
  await dp.goto(DISPLAY + '/');
  await dp.getByTestId('display-23').waitFor({ timeout: 30000 });
  await dp.getByText('Check In Here').waitFor({ timeout: 20000 });
  await dp.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '5'); return !!b && !b.disabled; }, null, { timeout: 20000 });
  const s1 = await q(`select device_id, display_device_id, branch_id, tenant_id, status from go_checkin_sessions where display_device_id = $1`, [DEV_B]);
  check('the display checks guests in with ITS OWN credential — the branch has no Go Check-In kiosk at all', kiosksInB === 0 && s1.length === 1 && s1[0].device_id === null && s1[0].branch_id === B && s1[0].tenant_id === T && s1[0].status === 'active', `${kiosksInB} kiosks in the branch; session: display ✓, kiosk ${s1[0]?.device_id ?? 'none'}`);
  check('…the request names no salon and no branch — the credential decides; it rides a header, never the address', starts.length >= 1 && !starts[0].body && !starts[0].url.includes(T) && !starts[0].url.includes(B) && starts[0].token === TOK_B && !starts[0].url.includes(TOK_B));
  await shot(dp, '01-check-in-own-identity.png');

  // ── 2. the branch's catalog and prices ─────────────────────────────────────────────────────────────────────────────
  phase('2 catalog');
  const tiles = async (page) => (await page.locator('.d23-svc').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await dp.locator('.d23-svc').first().waitFor({ timeout: 15000 });
  const bTiles = await tiles(dp);
  const mctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await mctx.addInitScript((t) => { try { if (!sessionStorage.getItem('proof.seeded')) { localStorage.setItem('aps.customerDisplay.deviceToken', t); sessionStorage.setItem('proof.seeded', '1'); } } catch { /* */ } }, TOK_M);
  const mp = await mctx.newPage();
  await mp.goto(DISPLAY + '/');
  await mp.locator('.d23-svc').first().waitFor({ timeout: 30000 });
  const mTiles = await tiles(mp);
  const usd = (c) => '$' + Math.round(Number(c) / 100);
  check(`the proof branch's display: "${mainGel.name}" at ITS price (${usd(B_GEL_PRICE)}), its pedicure — and its add-on is not a service tile`, bTiles.includes(`${mainGel.name} ${usd(B_GEL_PRICE)}`) && bTiles.includes('Spa Pedicure $60') && !bTiles.some((t) => t.startsWith('Nail Art')), bTiles.join(' · '));
  check(`Main's display: "${mainGel.name}" at Main's price (${usd(mainGel.price_cents)}) — none of the proof branch's services`, mTiles.includes(`${mainGel.name} ${usd(mainGel.price_cents)}`) && !mTiles.some((t) => t.startsWith('Spa Pedicure')), mTiles.join(' · '));
  await shot(dp, '02a-branch-prices.png'); await shot(mp, '02b-main-prices.png');
  await mctx.close();

  // (if the salon has full-screen idle ads (§7) and the screen sat untouched, a touch returns to check-in)
  const wake = async () => {
    if (await dp.locator('[data-testid="fullscreen-ads"]').count()) {
      info('the full-screen idle ad was up — a touch returns to check-in');
      await dp.mouse.click(960, 540);
      await dp.locator('[data-testid="fullscreen-ads"]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined);
    }
  };
  // ── 3. who may be asked for ────────────────────────────────────────────────────────────────────────────────────────
  phase('3 technicians');
  await wake();
  const options = async () => (await dp.locator('.d23-walkin select option').allInnerTexts()).map((t) => t.trim());
  const later = `Lisa · From ${clock(LISA_FROM)}`;
  await dp.waitForFunction(() => document.querySelectorAll('.d23-walkin select option').length > 1, null, { timeout: 15000 });
  const o0 = await options();
  check('nothing chosen: everyone working today at this branch — Lisa from later, Mia clocked in; not Ava (off today), not Nora (switched off), not Main\'s team', JSON.stringify(o0) === JSON.stringify(['Any available', later, 'Mia', 'Olivia']), o0.join(' | '));
  await dp.getByRole('button', { name: new RegExp(`^${mainGel.name}`) }).click();
  await dp.waitForFunction((n) => document.querySelectorAll('.d23-walkin select option').length === n, 3, { timeout: 15000 }).catch(() => undefined);
  const o1 = await options();
  check(`"${mainGel.name}" chosen: only those who do it — Mia does pedicures only`, JSON.stringify(o1) === JSON.stringify(['Any available', later, 'Olivia']), o1.join(' | '));
  await dp.getByRole('button', { name: /^Spa Pedicure/ }).click();
  await dp.waitForFunction((n) => document.querySelectorAll('.d23-walkin select option').length === n, 2, { timeout: 15000 }).catch(() => undefined);
  const o2 = await options();
  check('…and a pedicure too: only Lisa does both — with when her shift starts', JSON.stringify(o2) === JSON.stringify(['Any available', later]), o2.join(' | '));
  await shot(dp, '03-technicians-for-the-choice.png');

  // ── 4. a visit of several services ─────────────────────────────────────────────────────────────────────────────────
  phase('4 visit');
  await wake();
  const est = await j(await fetch(API + '/pos/check-in/wait-estimate', { headers: H }));
  const type = async (digits) => { for (const d of digits) await dp.getByRole('button', { name: d, exact: true }).click(); };
  await type(SOPHIA_PHONE);
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('Appointment Found').waitFor({ timeout: 15000 });
  const card = async () => (await dp.locator('.d23-appt').innerText()).replace(/\s+/g, ' ');
  const c0 = await card();
  check(`"Today at ${clock(APPT_AT)}", every service with its technician's first name — compact: two rows, then "+ 1 more"`, c0.includes(`Today at ${clock(APPT_AT)}`) && c0.includes(`${mainGel.name} with Olivia`) && c0.includes('Spa Pedicure with Mia') && !c0.includes('Paraffin Dip') && c0.includes('+ 1 more') && !c0.includes('Checkinproof'), c0.slice(0, 160));
  await dp.getByRole('button', { name: '+ 1 more' }).click();
  check('"+ 1 more" opens the rest inside the card', (await card()).includes('Paraffin Dip with Mia'));
  // the layout with the visit open (§17: "do not make the entire screen scroll")
  const layout = async (label) => dp.evaluate((l) => {
    const de = document.documentElement; const vw = innerWidth, vh = innerHeight;
    const btn = document.querySelector(l === 'visit' ? '.d23-imhere' : '.d23-walkin-go'); const col = document.querySelector('.d23-col-center');
    const b = btn?.getBoundingClientRect(), c = col?.getBoundingClientRect();
    const list = document.querySelector('.d23-visit-list'); const lr = list?.getBoundingClientRect();
    return { noScroll: de.scrollHeight <= vh + 1 && de.scrollWidth <= vw + 1, inCard: !!b && !!c && b.top >= c.top - 1 && b.bottom <= c.bottom + 1 && b.right <= c.right + 1, inView: !!b && b.bottom <= vh && b.right <= vw,
      listInCard: !lr || (!!c && lr.top >= c.top - 1 && lr.bottom <= c.bottom + 1), btnH: b ? Math.round(b.height) : 0 };
  }, label);
  for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
    await dp.setViewportSize({ width: w, height: h }); await sleep(350);
    const L = await layout('visit');
    check(`${w}×${h} — the visit opened: no page scroll; the services and "I'm Here" inside the card, on screen`, L.noScroll && L.inCard && L.inView && L.listInCard && L.btnH >= 44, JSON.stringify(L));
    await shot(dp, `04-visit-${w}x${h}.png`);
  }
  await dp.setViewportSize({ width: 1920, height: 1080 }); await sleep(300);
  await dp.getByRole('button', { name: "I'm Here" }).click();
  const result = dp.locator('.d23-result');
  await result.waitFor({ timeout: 15000 });
  const r0 = (await result.innerText()).replace(/\s+/g, ' ');
  const appts = await q(`select id, status from pos_tech_appointments where id = any($1)`, [[A1, A2]]);
  check('one "I\'m Here" checked BOTH appointments of the visit in', appts.length === 2 && appts.every((a) => a.status === 'checked_in') && r0.includes('Both of your appointments are checked in.'), `${appts.map((a) => a.status).join(', ')} · ${r0.slice(0, 120)}`);
  if (est.body?.configured) {
    const band = `${est.body.quotedWaitMinutes}–${est.body.quotedWaitMinutes + 10} min`;
    check(`the footer's wait is the queue engine's estimate as a band (${band}) — the display computed nothing`, r0.includes(band), `engine ${est.body.quotedWaitMinutes} min · footer "${r0.slice(0, 140)}"`);
  } else {
    check('the queue engine gives no estimate here — the footer shows none (the display never makes one up)', !/\d+–\d+ min/.test(r0), JSON.stringify(est.body).slice(0, 120));
  }
  await shot(dp, '05-visit-checked-in.png');

  // ── 5. a walk-in with services and an add-on ───────────────────────────────────────────────────────────────────────
  phase('5 walk-in');
  const sessionsBefore = (await q(`select id, status from go_checkin_sessions where display_device_id = $1 order by started_at`, [DEV_B]));
  const ETHAN_PHONE = '55502' + rnd(5);
  await type(ETHAN_PHONE.slice(0, 1));                               // the next guest's first tap
  const pageText = await dp.evaluate(() => document.body.innerText);
  check('the next guest\'s first tap clears the last result — nothing of Sophia is left', !(await result.count()) && !pageText.includes('Sophia') && !pageText.includes('Paraffin'));
  await sleep(1200);
  const sessionsAfter = (await q(`select id, status from go_checkin_sessions where display_device_id = $1 order by started_at`, [DEV_B]));
  const sophiaSession = sessionsBefore[sessionsBefore.length - 1];
  check('…and starts the next guest\'s own session: Sophia\'s is completed', sessionsAfter.length === sessionsBefore.length + 1 && sessionsAfter.find((s) => s.id === sophiaSession.id)?.status === 'completed' && sessionsAfter[sessionsAfter.length - 1].status === 'active', `${sessionsBefore.length} → ${sessionsAfter.length} sessions`);
  await type(ETHAN_PHONE.slice(1));
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('No appointment found').waitFor({ timeout: 15000 });
  const art = dp.getByRole('button', { name: /^Nail Art/ });
  const artOffFirst = await art.isDisabled();
  await dp.getByRole('button', { name: new RegExp(`^${mainGel.name}`) }).click();
  const artOnAfter = !(await art.isDisabled());
  await art.click();
  check('the add-on waits for a service (§20), then joins it', artOffFirst && artOnAfter && (await art.getAttribute('aria-pressed')) === 'true');
  await dp.getByRole('button', { name: /^Spa Pedicure/ }).click();
  await dp.waitForFunction((n) => document.querySelectorAll('.d23-walkin select option').length === n, 2, { timeout: 15000 }).catch(() => undefined);
  await dp.locator('.d23-walkin select').selectOption(TECH.lisa);
  await dp.getByPlaceholder('First name').fill('Ethan');
  await shot(dp, '06-walk-in-filled.png');
  for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768]]) {
    await dp.setViewportSize({ width: w, height: h }); await sleep(350);
    const L = await layout('walkin');
    check(`${w}×${h} — the walk-in fully used (services, add-on, technician): no page scroll; "Check In" inside the card, on screen`, L.noScroll && L.inCard && L.inView && L.btnH >= 44, JSON.stringify(L));
    await shot(dp, `07-walk-in-${w}x${h}.png`);
  }
  await dp.setViewportSize({ width: 1920, height: 1080 }); await sleep(300);
  const walkResp = dp.waitForResponse((r) => r.url().includes('/check-in-walk-in'), { timeout: 15000 });
  await dp.getByRole('button', { name: 'Check In', exact: true }).click();
  const wr = await walkResp; const wBody = await wr.json().catch(() => ({}));
  await result.waitFor({ timeout: 15000 });
  const r1 = (await result.innerText()).replace(/\s+/g, ' ');
  const qi = (await q(`select qi.requested_services, qi.requested_technician_id, qi.assigned_technician_id, qi.branch_id, qi.status, c.first_name, c.normalized_phone from pos_queue_items qi left join customers c on c.id = qi.customer_id
    where qi.tenant_id = $1 and qi.customer_name = 'Ethan' and qi.branch_id = $2 order by qi.created_at desc limit 1`, [T, B]))[0];
  const rs = qi ? (typeof qi.requested_services === 'string' ? JSON.parse(qi.requested_services) : qi.requested_services) : [];
  const line = (id) => rs.find((x) => x.serviceId === id);
  check('Ethan joins THIS branch\'s queue: the branch\'s prices, the add-on attached to its service', !!qi && wr.ok() && line(S.gel)?.priceCents === B_GEL_PRICE && line(S.spa)?.priceCents === 6000 && line(S.art)?.isAddon === true && line(S.art)?.parentServiceId === S.gel,
    rs.map((x) => `${x.serviceName} ${x.priceCents}${x.isAddon ? ` (add-on of ${x.parentServiceId === S.gel ? mainGel.name : '?'})` : ''}`).join(', '));
  // the check-in records a chosen technician as the queue entry's technician (assigned_technician_id) — as the POS
  // walk-in always has; whether a GUEST's choice should rather be the queue's "requested technician" is Kevin's call
  check('…with Lisa, the technician he chose, on the entry', qi?.assigned_technician_id === TECH.lisa, `assigned ${qi?.assigned_technician_id === TECH.lisa ? 'Lisa' : qi?.assigned_technician_id}, requested ${qi?.requested_technician_id ?? '—'}`);
  check('a new customer profile from the first name and phone — nothing else asked (§21)', qi?.first_name === 'Ethan' && String(qi?.normalized_phone ?? '').replace(/\D/g, '').endsWith(ETHAN_PHONE));
  check('§24 the server works out how long the services take (45 + 50 + 15 min)', wBody.estimatedServiceMinutes === 110, String(wBody.estimatedServiceMinutes));
  check('the footer: "You\'re checked in!", Thanks, Ethan — and a wait band', /You’re checked in!/.test(r1) && r1.includes('Thanks, Ethan') && (est.body?.configured ? /\d+–\d+ min/.test(r1) : true), r1.slice(0, 120));
  await shot(dp, '08-walk-in-checked-in.png');

  // ── 6. one session per guest ───────────────────────────────────────────────────────────────────────────────────────
  phase('6 eleven guests');
  for (let i = 1; i <= 9; i++) {
    await type('55503' + rnd(5));
    await dp.getByRole('button', { name: 'Find My Appointment' }).click();
    await dp.getByText('No appointment found').waitFor({ timeout: 15000 });
    await dp.getByPlaceholder('First name').fill(`Guest${i}`);
    await dp.getByRole('button', { name: new RegExp(`^${mainGel.name}`) }).click();
    await dp.getByRole('button', { name: 'Check In', exact: true }).click();
    await result.waitFor({ timeout: 15000 });
  }
  await result.waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);   // the last guest's turn ends on its own (§28)
  await sleep(1500);
  const sess = await q(`select status from go_checkin_sessions where display_device_id = $1`, [DEV_B]);
  check(`eleven guests, eleven lookups — every one answered (one session for the day refused the ninth)`, lookups.length === 11 && lookups.every((s) => s >= 200 && s < 300), `lookups: ${lookups.join(',')}`);
  check('…each guest on a session of their own', sess.length >= 12 && sess.filter((s) => s.status === 'completed').length >= 11, `${sess.length} sessions, ${sess.filter((s) => s.status === 'completed').length} completed`);
  const own = await j(await fetch(API + '/customer-display/device/check-in/session', { method: 'POST', headers: { 'x-device-token': TOK_B } }));
  const statuses = [];
  for (let i = 0; i < 9; i++) {
    const r = await fetch(`${API}/go-check-in/session/${own.body.sessionId}/lookup-phone`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-checkin-token': own.body.sessionToken }, body: JSON.stringify({ phone: '55504' + rnd(5) }) });
    statuses.push(r.status);
  }
  await fetch(`${API}/go-check-in/session/${own.body.sessionId}/complete`, { method: 'POST', headers: { 'x-checkin-token': own.body.sessionToken } });
  check('…and ONE guest\'s allowance still holds: the ninth lookup in one session is refused', statuses.slice(0, 8).every((s) => s >= 200 && s < 300) && statuses[8] === 429, statuses.join(','));

  // ── 7. a guest who walks away ──────────────────────────────────────────────────────────────────────────────────────
  phase('7 walk away (90 s)');
  await type('55505' + rnd(5));
  await dp.getByRole('button', { name: 'Find My Appointment' }).click();
  await dp.getByText('No appointment found').waitFor({ timeout: 15000 });
  await dp.getByPlaceholder('First name').fill('Walker');
  const before7 = (await q(`select id from go_checkin_sessions where display_device_id = $1 and status = 'active' order by started_at desc limit 1`, [DEV_B]))[0];
  await sleep(85_000);
  const still = (await dp.evaluate(() => document.body.innerText)).includes('No appointment found');
  await sleep(8_000);
  const t7 = await dp.evaluate(() => document.body.innerText);
  const phoneShown = (await dp.locator('.d23-phone .val').innerText()).trim();
  const name7 = await dp.getByPlaceholder('First name').inputValue().catch(() => '');
  const s7 = (await q(`select status from go_checkin_sessions where id = $1`, [before7?.id]))[0];
  check('a guest who walked away: still there at 85 s; cleared after 90 s untouched — number, name and lookup gone', still && phoneShown === '(555) 123-4567' && name7 === '' && !t7.includes('No appointment found') && t7.includes('No Appointment?'), `phone "${phoneShown}", name "${name7}"`);
  check('…and their session ended (the next guest gets a fresh one)', s7?.status === 'completed', s7?.status);
  await shot(dp, '09-walked-away-cleared.png');

  // ── 8. maintenance and revoke ──────────────────────────────────────────────────────────────────────────────────────
  // A session of this display (started with its credential, as the display does) is asked again after each switch: the
  // server re-checks the display's standing on EVERY request — it does not wait for the screen to notice.
  phase('8 maintenance / revoke');
  const startOwn = async () => j(await fetch(API + '/customer-display/device/check-in/session', { method: 'POST', headers: { 'x-device-token': TOK_B } }));
  const svcCall = async (s) => (await fetch(`${API}/go-check-in/session/${s.sessionId}/services`, { headers: { 'x-checkin-token': s.sessionToken } })).status;
  const open1 = await startOwn();
  check('a session of the display works', open1.status === 201 || open1.status === 200 ? (await svcCall(open1.body)) === 200 : false, `start ${open1.status}`);
  const mt = await j(await fetch(`${API}/pos/customer-displays/${DEV_B}`, { method: 'PATCH', headers: H, body: JSON.stringify({ maintenance: true }) }));
  const heldInMaint = await svcCall(open1.body);
  const startInMaint = (await startOwn()).status;
  await dp.getByTestId('maintenance').waitFor({ timeout: 20000 }).catch(() => undefined);
  check('maintenance (the owner): its open session is refused on the next request, no new one starts — and the screen shows maintenance', mt.status === 200 && heldInMaint === 403 && startInMaint === 403 && (await dp.getByTestId('maintenance').count()) === 1, `patch ${mt.status}, open session ${heldInMaint}, new ${startInMaint}`);
  await shot(dp, '10-maintenance.png');
  const nHeld = held.length;
  await fetch(`${API}/pos/customer-displays/${DEV_B}`, { method: 'PATCH', headers: H, body: JSON.stringify({ maintenance: false }) });
  await dp.getByText('Check In Here').waitFor({ timeout: 20000 }).catch(() => undefined);
  for (let i = 0; i < 40 && held.length === nHeld; i++) await sleep(250);
  check('maintenance off: the check-in is back, on a fresh session', (await dp.getByText('Check In Here').count()) === 1 && held.length > nHeld);
  const open2 = await startOwn();
  const rv = await j(await fetch(`${API}/pos/customer-displays/${DEV_B}/revoke`, { method: 'POST', headers: H }));
  const heldRevoked = await svcCall(open2.body);
  const startRevoked = (await startOwn()).status;
  await dp.getByTestId('pairing-code').waitFor({ timeout: 20000 }).catch(() => undefined);
  const revokedOk = (rv.status === 200 || rv.status === 201) && heldRevoked === 403 && startRevoked === 403 && (await dp.getByTestId('pairing-code').count()) === 1;
  check('revoke (the owner): its open session is refused, no new one starts — the display forgets its credential (pairing code)', revokedOk, `revoke ${rv.status}, open session ${heldRevoked}, new ${startRevoked}`);
  await shot(dp, '11-revoked.png');
  check('no page errors on the display', dErrors.length === 0, dErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' '));
  if (apiErr) info('API stderr (tail): ' + apiErr.slice(-600).replace(/\s+/g, ' '));
} finally {
  clearTimeout(watchdog);
  await restore();
  await client.end().catch(() => undefined);
}
console.log(results.join('\n'));
console.log(`\n${failed ? `FAILED — ${failed} check(s)` : 'PASS — every check'} · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
