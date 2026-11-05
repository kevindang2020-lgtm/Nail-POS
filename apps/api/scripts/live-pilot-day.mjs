#!/usr/bin/env node
// live-pilot-day.mjs — WAVE 4 PILOT (Kevin, Oct 13 2026): ONE realistic salon's whole first day, end to end, through the
// REAL HTTP API on the REAL PostgreSQL, as the real users would do it. No SQL shortcuts for anything a user does: the
// script only READS the database to cross-check what the API said (one source of truth). The card processor is the
// sandbox fake (PAYMENTS_SANDBOX=1); Twilio / SendGrid are NOT configured, so every SMS / e-mail takes the honest
// degrade path (the invite link is handed to the manager, the booking OTP is refused or bypassed only where the product
// says so).
//
//   0  boot the API
//   1  SUPER ADMIN onboards a new salon: the public application → review → approve → onboarding case → tenant + owner
//      → the owner's first sign-in (temporary password → own password) → onboarding activation
//   2  OWNER sets up: second branch? (no — one location), branch zone, services / prices / tax, technicians (invite →
//      accept → skills → schedule → commission), payment settings (sandbox), Twilio (not configured), customer display
//      pairing, the Go Check-In kiosk
//   3  THE DAY OPENS: technicians clock in by PIN on the kiosk; Fair Turn in RECOMMEND_AND_CONFIRM; walk-ins via the
//      kiosk; online booking with OTP hold; AI receptionist booking; the appointment arrives; a multi-technician visit
//   4  SERVICE: start → add-on → Service Done; CHECKOUT with a discount, a membership benefit, a gift card partial +
//      card, a tip split; the customer display shows the totals and clears; the receipt
//   5  TAP TO PAY on the manager app (fake provider): claim + split cash / card
//   6  a REFUND; inventory deduction; loyalty points
//   7  END OF DAY: reports reconcile (sales = payments = payroll basis); time clock closes; payroll period → approve →
//      lock → export → a refund after the lock → next-period adjustment; owner app and tech app show the same numbers
//
// Run:  DATABASE_URL=postgres://…/<scratch db> PORT_PROOF=3201 node scripts/live-pilot-day.mjs   (apps/api built).
// NEVER point it at production: it creates a whole new salon (unique code per run) through the Super Admin console.
// PILOT_OUT=<file.json> writes the timeline + every number for docs/PILOT_DAY_REPORT.md.
import { spawn } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pgLogErrors } from './lib/pg-log-errors.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3201), API = `http://127.0.0.1:${PORT}`;
const { hashPassword } = require('@aipowersalon/auth');
// The salon's zone: a whole-hour zone where it is 10 o'clock in the morning RIGHT NOW, so the whole pilot day (opening,
// bookings later "today", the end of day) fits inside the salon's business hours whatever the wall clock says. A fixed
// zone would make the pilot fail at night (no slots left today). PILOT_TZ overrides (e.g. America/New_York at midday).
const TZ = process.env.PILOT_TZ || (() => { const h = new Date().getUTCHours(); let off = (10 - h + 24) % 24; if (off > 14) off -= 24; return off === 0 ? 'Etc/GMT' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`; })();
const STOP_AFTER = process.env.PILOT_STOP_AFTER ? Number(process.env.PILOT_STOP_AFTER) : 99;
const EXTERNAL_API = process.env.PILOT_EXTERNAL_API === '1';   // reuse an already-running API on PORT (debugging only)

const results = []; const timeline = []; const numbers = {}; let failed = 0; let phaseName = '';
const t0 = Date.now();
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  [${phaseName}] ${name}${detail ? ' — ' + detail : ''}`); timeline.push({ at: Date.now() - t0, phase: phaseName, check: name, ok: !!ok, detail: String(detail).slice(0, 400) }); if (!ok) failed++; return ok; };
const info = (s) => { results.push(`INFO  [${phaseName}] ${s}`); timeline.push({ at: Date.now() - t0, phase: phaseName, info: s }); };
const phase = (n) => { phaseName = n; results.push(`\n== ${n}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t), headers: r.headers }; } catch { return { status: r.status, body: t, headers: r.headers }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 360);
const money = (c) => (c == null ? '—' : '$' + (Number(c) / 100).toFixed(2));
const localDay = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const d = (n) => localDay(Date.now() + n * 86_400_000);

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
// w4 SQL: the PostgreSQL log is part of the proof — an error the code swallowed (a lost audit row, a refused CHECK, a
// synthetic id sent to a uuid column, a column that does not exist) fails the pilot. The pilot's own read connection is
// excluded (its deliberate "the DB lock refuses an update" probe); only these outcomes are expected (idempotency/locks).
const RUN_STARTED = new Date(Date.now() - 1000);
const DB_NAME = new URL(DB).pathname.replace(/^\//, '');
const OWN_PID = (await client.query('select pg_backend_pid() as p')).rows[0].p;
const PILOT_EXPECTED_PG = /^duplicate key value violates unique constraint|append-only|could not serialize|deadlock detected|canceling statement|pg_stat_statements|current transaction is aborted/;

const tag = String(Date.now()).slice(-6);
const SALON_CODE = `PLT${tag}`;
const OWNER_EMAIL = `owner.${tag}@pilot-day.test`;
const OWNER_PW = 'Pilot!Owner-' + randomUUID().slice(0, 8);
const STAFF_PW = 'Pilot!Staff-' + randomUUID().slice(0, 8);
// the platform's Super Admin for this run: a platform account as seed.ts makes one (PLATFORM_SUPER_ADMIN, MFA not yet
// enrolled) — the pilot enrols a real authenticator through the API before any critical action
const SA_EMAIL = `pilot-sa-${tag}@aipowersalon.test`, SA_PASSWORD = 'Pilot!SA-' + randomUUID().slice(0, 10);
// RFC 6238 TOTP (the authenticator app), ±1 step accepted by the API; each step is used once (replay protection)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32d = (s) => { let bits = 0, v = 0; const out = []; for (const ch of String(s).toUpperCase().replace(/=+$/, '')) { const i = B32.indexOf(ch); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 0xff); bits -= 8; } } return Buffer.from(out); };
const hotp = (key, counter) => { const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(counter / 0x100000000), 0); b.writeUInt32BE(counter >>> 0, 4); const dg = createHmac('sha1', key).update(b).digest(); const o = dg[dg.length - 1] & 0xf; return ((((dg[o] & 0x7f) << 24) | (dg[o + 1] << 16) | (dg[o + 2] << 8) | dg[o + 3]) % 1e6).toString().padStart(6, '0'); };
let totpSecret = null, lastStep = -Infinity;
const nextTotp = async () => { let step = Math.max(Math.floor(Date.now() / 30000) - 1, lastStep + 1); while (step > Math.floor(Date.now() / 30000) + 1) await sleep(1000); lastStep = step; return hotp(b32d(totpSecret), step); };

// ── an HTTP session (cookie jar) ─────────────────────────────────────────────────────────────────────────────────────
const session = (label) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const call = (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => { keep(r); return j(r); });
  return { label, jar, call, get: (p) => call('GET', p), post: (p, b, x) => call('POST', p, b ?? {}, x), patch: (p, b, x) => call('PATCH', p, b ?? {}, x), put: (p, b, x) => call('PUT', p, b ?? {}, x) };
};
const tenantLogin = async (s, identifier, password, branchId) => {
  const l = await s.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier, password });
  let sel = null; if (branchId && ok2(l.status)) sel = await s.post('/auth/select-branch', { branchId });
  return { ok: ok2(l.status) && (!branchId || ok2(sel?.status)), l, sel };
};

// ── the ONE fake for Tap to Pay: a loopback CommerceHub (session mint + charge), as phase-4 runs a loopback Twilio Verify.
// Honoured only because COMMERCEHUB_BASE_URL points at it; COMMERCEHUB_TTP_ENV=sandbox. It answers like CommerceHub does.
const CH_PORT = PORT + 100; const chCalls = []; let chN = 0;
const chFake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch { /* */ }
    chCalls.push({ path: req.url, body: b, signed: !!req.headers['authorization'] && !!req.headers['api-key'] });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/payments-vas/v1/security/credentials') return res.end(JSON.stringify({ sessionId: `ps_${++chN}`, accessToken: `at_${chN}`, publicKey: 'pk_fake', accessTokenTimeToLive: 600 }));
    if (req.url === '/payments/v1/charges') { const total = b?.amount?.total ?? 0; return res.end(JSON.stringify({ gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: `ch_${++chN}` } }, paymentReceipt: { approvedAmount: { total }, processorResponseDetails: { approvalStatus: 'APPROVED', approvalCode: 'A' + chN, responseCode: '000', responseMessage: 'APPROVED' } } })); }
    if (req.url === '/payments/v1/refunds' || req.url === '/payments/v1/cancels') return res.end(JSON.stringify({ gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: `rf_${++chN}` } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'APPROVED', responseCode: '000', responseMessage: 'APPROVED' } } }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => chFake.listen(CH_PORT, '127.0.0.1', r));
// ── the card processor fake: a loopback CardPointe gateway (the shape of scripts/cardpointe-mock-server.mjs). The Super
// Admin points the salon's gateway at it, so POS card payments, refunds and the gateway test run the REAL CardPointeClient.
const CP_PORT = PORT + 101; const cpCalls = []; let cpN = 0;
const cpFake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch { /* */ }
    const basic = String(req.headers['authorization'] || '').startsWith('Basic ');
    cpCalls.push({ method: req.method, path: req.url, body: b, basic });
    res.setHeader('content-type', 'application/json');
    if (!basic) { res.statusCode = 401; return res.end('{}'); }
    const u = req.url || ''; cpN++;
    if (req.method === 'PUT' && u.endsWith('/cardconnect/rest/auth')) return res.end(JSON.stringify({ respstat: 'A', retref: `CP-AUTH-${cpN}`, authcode: `OK${cpN}`, amount: b.amount, resptext: 'Approval', respcode: '00', token: b.account, merchid: b.merchid }));
    if (req.method === 'PUT' && u.endsWith('/cardconnect/rest/refund')) return res.end(JSON.stringify({ respstat: 'A', retref: `CP-RFND-${cpN}`, amount: b.amount, resptext: 'Approval', respcode: '00' }));
    if (req.method === 'PUT' && u.endsWith('/cardconnect/rest/void')) return res.end(JSON.stringify({ respstat: 'A', retref: `CP-VOID-${cpN}`, resptext: 'Approval', respcode: '00' }));
    if (req.method === 'GET' && /\/cardconnect\/rest\/inquireMerchant\//.test(u)) return res.end(JSON.stringify({ merchid: u.split('/').pop(), enabled: true, site: 'pilot-fake' }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => cpFake.listen(CP_PORT, '127.0.0.1', r));
const CARD = { cardToken: '9418594164541111', expiry: '1230' };   // a CardSecure-style token (the iFrame tokenizer's output), never a PAN
// ── SCREENS: the real built apps in Chromium, each served same-origin with the API (its session cookies injected from
//    the very session that did the work). PILOT_SCREENS=0 skips; PILOT_SHOTS sets the folder. Ports: PORT+104..PORT+107 (PORT+100/+101 are the payment fakes).
const SCREENS = process.env.PILOT_SCREENS !== '0';
const SHOTS = (process.env.PILOT_SHOTS || `${createRequire(import.meta.url)('node:os').tmpdir()}/pilot-day-shots`).replace(/\/?$/, '/');
const APPS_DIR = new URL('../../', import.meta.url).pathname;
const screenApps = { 'pos-web': PORT + 104, 'customer-display': PORT + 105, 'tech-web': PORT + 106, 'owner-web': PORT + 107 };
const shots = [];
let browser = null; const appServers = [];
const { existsSync: fsExists, statSync: fsStat, readFileSync: fsRead, mkdirSync } = createRequire(import.meta.url)('node:fs');
const serveApp = (appName, port) => new Promise((res) => {
  const dist = APPS_DIR + appName + '/dist';
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const srv = createServer((req, rsp) => {
    const u = req.url || '/'; const path = u.split('?')[0];
    const file = dist + path;
    if (req.method === 'GET' && path !== '/' && fsExists(file) && fsStat(file).isFile()) { rsp.writeHead(200, { 'content-type': mime[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' }); return rsp.end(fsRead(file)); }
    if (req.method === 'GET' && /text\/html/.test(req.headers.accept || '')) { rsp.writeHead(200, { 'content-type': 'text/html' }); return rsp.end(fsRead(dist + '/index.html')); }
    if (u.startsWith('/realtime') || /event-stream/.test(req.headers.accept || '')) { rsp.writeHead(204); return rsp.end(); }
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const headers = { ...req.headers }; delete headers.host; delete headers.connection; delete headers['content-length'];
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const r = await fetch(API + u, { method: req.method, headers, body, redirect: 'manual' });
        const out = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'connection'].includes(k)) out[k] = v; });
        const sc = r.headers.getSetCookie?.() ?? [];
        if (sc.length) out['set-cookie'] = sc.map((c) => c.replace(/;\s*Secure/ig, '').replace(/;\s*Domain=[^;]*/ig, '').replace(/;\s*SameSite=None/ig, '; SameSite=Lax'));
        rsp.writeHead(r.status, out); rsp.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) { rsp.writeHead(502); rsp.end(String(e?.message || e)); }
    });
  });
  srv.listen(port, '127.0.0.1', () => res(srv)); appServers.push(srv);
});
/** Open `appName` at `path` as `sess` (its cookies), wait for `expect` (regex) in the page, screenshot, return the text. */
const shoot = async (name, appName, path, sess, expect, act) => {
  if (!SCREENS) return { skipped: true, text: '' };
  try {
    if (!fsExists(APPS_DIR + appName + '/dist/index.html')) return { skipped: true, text: '', err: `${appName}/dist missing` };
    if (!browser) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
      mkdirSync(SHOTS, { recursive: true });
    }
    const port = screenApps[appName];
    if (!appServers.find((x) => x.address()?.port === port)) await serveApp(appName, port);
    const mobile = appName === 'tech-web' || appName === 'owner-web';
    const context = await browser.newContext({ viewport: mobile ? { width: 430, height: 932 } : appName === 'customer-display' ? { width: 1920, height: 1080 } : { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    if (sess) await context.addCookies([...sess.jar.values()].map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: `http://127.0.0.1:${port}` }; }));
    const page = await context.newPage(); const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load', timeout: 30_000 });
    const t0 = Date.now();
    if (act) await act(page);
    let text = ''; for (let i = 0; i < 40; i++) { text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' '); if (!expect || expect.test(text)) break; await sleep(250); }
    if (mobile && Date.now() - t0 < 3200) await sleep(3200 - (Date.now() - t0));   // the apps' 2.6 s animated splash overlays the screen
    const file = `${SHOTS}pilot-${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file, fullPage: !mobile });
    await context.close();
    shots.push({ name, app: appName, path, file: file.split('/').pop(), matched: expect ? expect.test(text) : true, pageErrors });
    return { text, pageErrors, matched: expect ? expect.test(text) : true };
  } catch (e) { shots.push({ name, app: appName, path, error: String(e?.message || e).slice(0, 200) }); return { text: '', err: String(e?.message || e) }; }
};

let proc = null; let errs = '';
const ctx = {};   // everything the day creates (ids), for the report
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  try { chFake.close(); cpFake.close(); } catch { /* */ }
  try { await browser?.close(); } catch { /* */ }
  for (const srv of appServers) { try { srv.close(); } catch { /* */ } }
  await sleep(800);
  await client.end().catch(() => undefined);
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 25 * 60_000);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };   // NO PAYMENTS_SANDBOX: the salon's own gateway (the loopback CardPointe) takes the cards
for (const k of ['PAYMENTS_SANDBOX', 'CARDPOINTE_BASE_URL', 'CARDPOINTE_MERCHANT_ID', 'CARDPOINTE_USERNAME', 'CARDPOINTE_PASSWORD']) delete env[k];
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SENDGRID_API_KEY']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off', VOICE_WRITE_TOOLS_ENABLED: 'true' });
Object.assign(env, { COMMERCEHUB_BASE_URL: `http://127.0.0.1:${CH_PORT}`, COMMERCEHUB_TTP_API_KEY: 'fake-key', COMMERCEHUB_TTP_API_SECRET: 'fake-secret', COMMERCEHUB_TTP_MERCHANT_ID: 'FAKE-MID', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 'FAKE-TPID', COMMERCEHUB_TTP_ENV: 'sandbox' });

try {
  // ══ 0. BOOT ════════════════════════════════════════════════════════════════════════════════════════════════════════
  phase('0 boot');
  if (!EXTERNAL_API) {
    proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (c) => { errs += c; });
  }
  let up = false; for (let i = 0; i < 480 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL (card processor = the sandbox fake; Twilio / SendGrid unset)', up, errs.split('\n').filter((l) => /Error|error/.test(l)).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // ══ 1. SUPER ADMIN ONBOARDS A NEW SALON ════════════════════════════════════════════════════════════════════════════
  phase('1 onboarding');
  const pub = session('public');
  const appKey = randomUUID();
  const appBody = { ownerFirstName: 'Grace', ownerLastName: 'Pilot', salonName: `Pilot Day Nails ${tag}`, email: OWNER_EMAIL, phone: `609555${tag.slice(-4)}`,
    smsEmailConsent: true, consentText: 'I agree to be contacted about the AIPowerSalon free POS package.', idempotencyKey: appKey, zip: '08109', state: 'NJ', city: 'Merchantville',
    address: '1 Pilot Avenue', technicianCount: 4, locationCount: 1, currentPos: 'paper', formVersion: '2026-07-25', ein: '12-3456789' };
  const ap1 = await pub.post('/public/website/applications', appBody);
  const ap1b = await pub.post('/public/website/applications', appBody);
  check('the salon applies on the public website form → a reference number (no internal id); the double-tap returns the SAME reference',
    ok2(ap1.status) && /^APS-/.test(ap1.body?.reference ?? '') && ap1b.body?.reference === ap1.body?.reference && !('id' in (ap1.body ?? {})), `${ap1.status} ${short(ap1.body)} / ${ap1b.status}`);
  ctx.reference = ap1.body?.reference;

  await q(`insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, platform_role, mfa_enabled) values (null, null, 'Pilot', 'Admin', 'Pilot Admin', $1, $2, 'active', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', true)`, [SA_EMAIL, await hashPassword(SA_PASSWORD)]);
  const sa = session('super-admin');
  const sal = await sa.post('/auth/login', { portal: 'super-admin', identifier: SA_EMAIL, password: SA_PASSWORD, mfaCode: '123456' });
  const enr = await sa.post('/auth/mfa/enroll', {});
  totpSecret = enr.body?.secret ?? null;
  const cnf = totpSecret ? await sa.post('/auth/mfa/confirm', { code: await nextTotp() }) : { status: 0 };
  check('the Super Admin signs in and enrols her authenticator app (TOTP confirmed — critical actions need it)', ok2(sal.status) && sa.jar.size > 0 && ok2(enr.status) && !!totpSecret && ok2(cnf.status),
    `login ${sal.status} ${short(sal.body?.outcome)} enroll ${enr.status} confirm ${cnf.status} ${short(cnf.body)}`);
  const list = await sa.get(`/super-admin/platform/applications?status=new&pageSize=100`);
  const rows = Array.isArray(list.body) ? list.body : (list.body?.items ?? list.body?.applications ?? list.body?.rows ?? []);
  if (!rows.length) info(`applications list shape: ${short(list.body)}`);
  const app = rows.find((a) => (a.referenceNumber ?? a.reference_number ?? a.reference) === ctx.reference) ?? rows.find((a) => (a.email ?? '').toLowerCase() === OWNER_EMAIL);
  ctx.applicationId = app?.id;
  check('the application is in the Super Admin\'s Applications list (status new, EIN never in clear)', list.status === 200 && !!app && app.status === 'new' && !JSON.stringify(app).includes('3456789'),
    `${list.status} found ${!!app} status ${app?.status} ${short(app && Object.fromEntries(Object.entries(app).filter(([k]) => /ein|status|reference/i.test(k))))}`);
  const rv = await sa.post(`/super-admin/platform/applications/${ctx.applicationId}/status`, { status: 'under_review', note: 'Pilot day review' });
  const apv = await sa.post(`/super-admin/platform/applications/${ctx.applicationId}/approve`, { note: 'Pilot salon approved for the free POS package' });
  check('review → APPROVE (note required)', ok2(rv.status) && ok2(apv.status), `${rv.status} ${short(rv.status >= 300 ? rv.body : null)} / ${apv.status} ${short(apv.status >= 300 ? apv.body : apv.body?.status)}`);
  const conv = await sa.post(`/super-admin/platform/applications/${ctx.applicationId}/convert-to-onboarding`, {});
  ctx.onboardingId = conv.body?.onboarding_id ?? conv.body?.onboardingId ?? conv.body?.onboarding?.id;
  check('approved → an onboarding case (Onboarding & Approvals) linked to the application', ok2(conv.status) && !!ctx.onboardingId, `${conv.status} ${short(conv.body)}`);

  const ct = await sa.post('/super-admin/tenants', { displayName: appBody.salonName, legalName: `${appBody.salonName} LLC`, tenantCode: SALON_CODE, ownerName: 'Grace Pilot', ownerEmail: OWNER_EMAIL,
    ownerPhone: appBody.phone, plan: 'Standard', state: 'NJ', city: 'Merchantville', initialCommissionPercent: 50 });
  ctx.tenantId = ct.body?.tenant?.id ?? ct.body?.tenant?.tenantId;
  check('the Super Admin creates the tenant (salon code, one branch, the owner as an INVITED user, a pending sandbox gateway)', ok2(ct.status) && ct.body?.ok !== false && !!ctx.tenantId, `${ct.status} ${short(ct.body)}`);
  const T = ctx.tenantId;
  const tRow = (await q(`select t.status, t.owner_user_id, (select count(*)::int from branches b where b.tenant_id = t.id) as branches, (select status from users u where u.id = t.owner_user_id) as owner_status from tenants t where t.id = $1`, [T]))[0];
  ctx.branchId = (await q(`select id from branches where tenant_id = $1 order by created_at limit 1`, [T]))[0]?.id;
  ctx.ownerUserId = tRow?.owner_user_id;
  check('DB: one tenant, one branch, the owner user invited (no password yet)', tRow?.branches === 1 && tRow?.owner_status === 'invited', short(tRow));
  const linked = await sa.post(`/super-admin/platform/applications/${ctx.applicationId}/converted`, { tenantId: T });
  check('the application is linked to the new tenant (converted)', ok2(linked.status), `${linked.status} ${short(linked.body)}`);

  // the owner's first sign-in: the Super Admin issues a temporary password (the invite), the owner replaces it
  const rp = await sa.post(`/super-admin/tenants/${T}/reset-owner-password`, {});
  const temp = rp.body?.temporaryPassword;
  check('the Super Admin issues the owner\'s first-sign-in temporary password (shown once)', ok2(rp.status) && typeof temp === 'string' && temp.length >= 8, `${rp.status} ${short({ ...rp.body, temporaryPassword: temp ? '<redacted>' : null })}`);
  const own = session('owner');
  let ol = await own.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier: OWNER_EMAIL, password: temp });
  info(`owner first login with the temporary password → ${ol.status} ${short(ol.body?.outcome ?? ol.body?.code ?? ol.body)}`);
  if (ol.body?.changePasswordSessionId || ol.body?.outcome === 'PASSWORD_CHANGE_REQUIRED' || ol.body?.mustChangePassword) {
    const ch = await own.post('/auth/change-temporary-password', { changePasswordSessionId: ol.body?.changePasswordSessionId, newPassword: OWNER_PW, confirmPassword: OWNER_PW });
    info(`change-temporary-password → ${ch.status} ${short(ch.body)}`);
  } else if (ok2(ol.status)) {
    const ch = await own.post('/auth/change-password', { currentPassword: temp, newPassword: OWNER_PW, confirmPassword: OWNER_PW });
    info(`change-password → ${ch.status} ${short(ch.body)}`);
  }
  const own2 = session('owner');
  const ol2 = await own2.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier: OWNER_EMAIL, password: OWNER_PW });
  const osel = await own2.post('/auth/select-branch', { branchId: ctx.branchId });
  const ownerStatus = (await q(`select status from users where id = $1`, [ctx.ownerUserId]))[0]?.status;
  check('the owner signs in with her OWN password at her salon (the temporary one is gone) and opens her branch; her account is active',
    ok2(ol2.status) && ok2(osel.status) && ownerStatus === 'active', `login ${ol2.status} ${short(ol2.status >= 300 ? ol2.body : ol2.body?.outcome)} select ${osel.status} status ${ownerStatus}`);
  Object.assign(own, own2);

  // the tenant goes live: ONBOARDING → PENDING_APPROVAL → ACTIVE (Constitution 7 lifecycle, step-up required)
  const saSu = await sa.post('/auth/step-up', { password: SA_PASSWORD, code: await nextTotp() });
  const lc1 = await sa.post(`/super-admin/tenants/${T}/lifecycle`, { state: 'PENDING_APPROVAL', reason: 'Pilot day: setup verified' });
  const lc2 = await sa.post(`/super-admin/tenants/${T}/lifecycle`, { state: 'ACTIVE', reason: 'Pilot day: go live' });
  const tAfter = (await q(`select status from tenants where id = $1`, [T]))[0]?.status;
  check('with a fresh step-up the Super Admin moves the salon ONBOARDING → PENDING_APPROVAL → ACTIVE (tenant status active)', ok2(saSu.status) && ok2(lc1.status) && ok2(lc2.status) && lc2.body?.ok !== false && tAfter === 'active',
    `step-up ${saSu.status} ${short(saSu.status >= 300 ? saSu.body : null)} → ${lc1.status} ${short(lc1.body?.errors ?? lc1.body?.tenant?.lifecycleState ?? lc1.body)} → ${lc2.status} ${short(lc2.body?.errors ?? lc2.body?.tenant?.lifecycleState ?? lc2.body)} db ${tAfter}`);
  const onb = await sa.get(`/super-admin/onboarding/${ctx.onboardingId}`);
  info(`onboarding case after the tenant exists: ${onb.status} ${short(onb.body)}`);
  check('the onboarding case now belongs to the new tenant', onb.status === 200 && onb.body?.tenantId === T, `tenantId ${onb.body?.tenantId}`);
  const appNow = (await q(`select status, onboarding_id, converted_tenant_id from tenant_applications where id = $1`, [ctx.applicationId]))[0];
  check('the application row records the whole path: converted to the tenant, with its onboarding case linked', ['converted', 'converted_tenant'].includes(appNow?.status) && String(appNow?.onboarding_id) === String(ctx.onboardingId) && appNow?.converted_tenant_id === T, short(appNow));
  if (STOP_AFTER <= 1) throw new Error('STOP_AFTER');

  // ══ 2. THE OWNER SETS UP HER SALON ═════════════════════════════════════════════════════════════════════════════════
  phase('2 setup');
  const B = ctx.branchId;
  // the salon's address, zone and tax
  const biz = await own.patch('/pos/settings/business-branch', { address: '1 Pilot Avenue', city: 'Merchantville', state: 'NJ', zip: '08109', timezone: TZ, phone: '6095550100' });
  info(`the salon's zone for the pilot: ${TZ} — local time now ${new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date())}`);
  const tax = await own.patch('/pos/settings/tax', { enabled: true, taxRatePercent: 6.625, taxLabel: 'NJ Sales Tax', appliesToServices: true, appliesToProducts: true });
  const brow = (await q(`select timezone, address from branches where id = $1`, [B]))[0];
  check(`business details + the salon's zone (${TZ}) and NJ sales tax 6.625 % saved; the branch row carries the zone`, ok2(biz.status) && ok2(tax.status) && brow?.timezone === TZ,
    `biz ${biz.status} ${short(biz.status >= 300 ? biz.body : null)} tax ${tax.status} ${short(tax.status >= 300 ? tax.body : null)} branch ${short(brow)}`);

  // front desk + manager accounts: the OWNER invites them herself (POST /pos/access/invitations — the same invitation the
  // Super Admin sends, into her own salon, within her own permissions; no e-mail provider → the accept link is handed over)
  const staff = {};
  for (const [key, role, name] of [['rec', 'RECEPTIONIST', 'Rae Desk'], ['mgr', 'MANAGER', 'Max Floor']]) {
    const em = `${key}.${tag}@pilot-day.test`;
    let inv = await own.post('/pos/access/invitations', { email: em, fullName: name, role, branchId: B, channel: 'email' });
    // w4 SQL item 5: a MANAGER invite needs step-up (403 STEP_UP_REQUIRED → the owner confirms her password → retry);
    // a receptionist invite does not
    let stepUp = null;
    if (role === 'MANAGER') {
      stepUp = { first: inv.status, code: inv.body?.code ?? null };
      const su = await own.post('/auth/step-up', { password: OWNER_PW }); stepUp.su = su.status;
      inv = await own.post('/pos/access/invitations', { email: em, fullName: name, role, branchId: B, channel: 'email' });
    }
    const tok = inv.body?.manualAcceptToken;
    const acc = tok ? await pub.post('/public/website/invitations/accept', { token: tok, password: STAFF_PW, fullName: name }) : { status: 0, body: null };
    const s2 = session(key); const li = await tenantLogin(s2, em, STAFF_PW, B);
    staff[key] = s2;
    check(`${role}: invited by the OWNER from her salon${role === 'MANAGER' ? ' (a manager invite first answers 403 STEP_UP_REQUIRED; she confirms her password)' : ''} (e-mail not configured → delivery "${inv.body?.deliveryStatus}", the link handed over), accepted with her own password, signs in at the branch`,
      ok2(inv.status) && !!tok && ok2(acc.status) && li.ok && (role !== 'MANAGER' || (stepUp.first === 403 && stepUp.code === 'STEP_UP_REQUIRED' && ok2(stepUp.su))), `${stepUp ? 'step-up ' + short(stepUp) + ' ' : ''}invite ${inv.status} ${short(inv.status >= 300 ? inv.body : { d: inv.body?.deliveryStatus, n: inv.body?.deliveryNote })} accept ${acc.status} ${short(acc.status >= 300 ? acc.body : null)} login ${li.l.status} ${short(li.l.status >= 300 ? li.l.body : null)} select ${li.sel?.status}`);
  }
  const rec = staff.rec, mgr = staff.mgr;
  const invAudit = await q(`select count(*)::int as n from audit_logs where tenant_id = $1 and action_type = 'salon_staff_invitation_created'`, [T]).catch(() => [{ n: -1 }]);
  const recInv = await rec.post('/pos/access/invitations', { email: `x.${tag}@pilot-day.test`, fullName: 'Not Allowed', role: 'MANAGER' });
  check('the owner\'s two staff invitations are audited against the salon; the receptionist cannot invite anyone (403)', invAudit[0]?.n === 2 && recInv.status === 403, `audit ${short(invAudit)} rec ${recInv.status} ${short(recInv.body)}`);
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const hrs = await own.patch('/pos/settings/store-hours-auto-logout', { storeHours: Object.fromEntries(DAYS.map((x) => [x, { isOpen: true, openTime: '09:00', closeTime: '19:30' }])), timezone: TZ });
  check('store hours: open 7 days, 9:00–7:30', ok2(hrs.status), `${hrs.status} ${short(hrs.status >= 300 ? hrs.body : null)}`);
  const recTax = await rec.patch('/pos/settings/tax', { taxRatePercent: 0 });
  const taxNow = await own.get('/pos/settings/tax');
  check('RBAC: the receptionist cannot change the sales tax (403) and the rate stays 6.625 %', recTax.status === 403 && JSON.stringify(taxNow.body).includes('6.625'), `${recTax.status} ${short(recTax.body)} now ${short(taxNow.body)}`);

  // the menu: a category, three services (commission on each) and an add-on
  const cat = await own.post('/pos/services/categories', { name: 'Nails' });
  const catId = cat.body?.id ?? cat.body?.categoryId ?? cat.body?.category?.id;
  const mkSvc = async (name, price, dur, pct) => { const r = await own.post('/pos/services', { name, categoryId: catId, priceCents: price, durationMinutes: dur, commissionType: 'percent', commissionValue: pct, onlineBookingEnabled: true, customerAppBookingEnabled: true, aiBookingEnabled: true, status: 'active' }); return { r, id: r.body?.id ?? r.body?.serviceId ?? r.body?.service?.id }; };
  const GEL = await mkSvc('Gel Manicure', 4500, 45, 60), PEDI = await mkSvc('Spa Pedicure', 6000, 60, 50), ACR = await mkSvc('Acrylic Full Set', 7000, 75, 55);
  const addon = await own.post('/pos/service-add-ons', { name: 'Nail Art (2 nails)', priceCents: 1500, durationDeltaMinutes: 15, isTaxable: true, serviceIds: [GEL.id] });
  // the floor's add-on (kiosk, queue, Tech App "add add-on", checkout) is a SERVICE in an "Add-ons" category — the
  // Service Add-ons screen's record above only reaches the customer booking options (finding P-6, two add-on models)
  const catA = await own.post('/pos/services/categories', { name: 'Add-ons' });
  const catAId = catA.body?.id ?? catA.body?.categoryId ?? catA.body?.category?.id;
  const artR = await own.post('/pos/services', { name: 'Nail Art (2 nails)', categoryId: catAId, priceCents: 1500, durationMinutes: 15, commissionType: 'percent', commissionValue: 50, onlineBookingEnabled: true, status: 'active' });
  ctx.services = { gel: GEL.id, pedi: PEDI.id, acrylic: ACR.id, addOn: artR.body?.id ?? artR.body?.serviceId, screenAddOn: addon.body?.id ?? addon.body?.addOnId ?? addon.body?.addOn?.id, category: catId };
  check('the floor add-on "Nail Art (2 nails)" $15.00 (50 %) in the "Add-ons" category', ok2(catA.status) && ok2(artR.status) && !!ctx.services.addOn, `cat ${catA.status} svc ${artR.status} ${short(artR.status >= 300 ? artR.body : null)}`);
  const svcRows = await q(`select name, price_cents::int as price, commission_type, commission_value::float as pct from services where tenant_id = $1 order by name`, [T]);
  check('the menu: category "Nails", Gel Manicure $45.00 (60 %), Spa Pedicure $60.00 (50 %), Acrylic Full Set $70.00 (55 %), Nail Art add-on $15.00 on the gel',
    ok2(cat.status) && [GEL, PEDI, ACR].every((x) => ok2(x.r.status) && !!x.id) && ok2(addon.status) && svcRows.length >= 3 && svcRows.find((r) => r.name === 'Gel Manicure')?.price === 4500 && svcRows.find((r) => r.name === 'Gel Manicure')?.pct === 60,
    `cat ${cat.status} ${short(cat.status >= 300 ? cat.body : null)} svcs ${[GEL, PEDI, ACR].map((x) => x.r.status + (x.r.status >= 300 ? short(x.r.body) : '')).join(',')} addon ${addon.status} ${short(addon.status >= 300 ? addon.body : null)} db ${short(svcRows)}`);

  // technicians: hired on the POS (invite → accept), skills, weekly schedule, commission, app access, clock PIN
  const TECH_DEF = [
    { key: 'lisa', first: 'Lisa', last: 'Tran', pin: '4811', svcs: ['gel', 'acrylic', 'addOn'] },
    { key: 'mary', first: 'Mary', last: 'Nguyen', pin: '4822', svcs: ['gel', 'pedi', 'addOn'] },
    { key: 'anna', first: 'Anna', last: 'Le', pin: '4833', svcs: ['gel', 'pedi', 'acrylic', 'addOn'] },
  ];
  const tech = {}; ctx.techs = {};
  const week = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((dname) => [dname, { isWorking: true, startTime: '09:00', endTime: '19:00', lunchStart: '13:00', lunchEnd: '13:30' }]));
  for (const t of TECH_DEF) {
    const em = `${t.key}.${tag}@pilot-day.test`;
    const cr = await own.post('/pos/technicians', { firstName: t.first, lastName: t.last, email: em, phone: `609${String((Number(tag) * 3 + TECH_DEF.indexOf(t)) % 10_000_000).padStart(7, '0')}`, techAppEnabled: true, serviceIds: t.svcs.map((k) => ctx.services[k]) });
    const id = cr.body?.technicianId ?? cr.body?.id; t.id = id; ctx.techs[t.key] = id;
    const link = cr.body?.invite?.acceptUrl ?? null;
    const token = link ? new URL(link).searchParams.get('token') : null;
    const acc = token ? await pub.post('/public/website/invitations/accept', { token, password: STAFF_PW, fullName: `${t.first} ${t.last}` }) : { status: 0, body: null };
    const sk = await own.patch(`/pos/technicians/${id}/skills`, { skillGroups: ['Manicure', 'Pedicure', 'Nail Art'] });
    const sv = await own.patch(`/pos/technicians/${id}/services`, { serviceIds: t.svcs.map((k) => ctx.services[k]) });
    const sc = await own.patch(`/pos/technicians/${id}/schedule`, { weekly: week, branchId: B });
    const pin = await own.post(`/pos/technician-clock/technicians/${id}/clock-pin/reset`, { pin: t.pin });
    const s3 = session(t.key); const li = await tenantLogin(s3, em, STAFF_PW, B); tech[t.key] = s3;
    check(`${t.first}: hired on the POS (invite "${cr.body?.invite?.deliveryStatus ?? '—'}" → link handed over → accepted), skills, services, 7-day 9–7 schedule, clock PIN; she signs in to the Tech App`,
      ok2(cr.status) && !!id && !!token && ok2(acc.status) && ok2(sk.status) && ok2(sv.status) && ok2(sc.status) && ok2(pin.status) && li.ok,
      `create ${cr.status} ${short(cr.status >= 300 ? cr.body : cr.body?.invite)} accept ${acc.status} ${short(acc.status >= 300 ? acc.body : null)} skills ${sk.status} svcs ${sv.status} sched ${sc.status} ${short(sc.status >= 300 ? sc.body : null)} pin ${pin.status} ${short(pin.status >= 300 ? pin.body : null)} login ${li.l.status} ${short(li.l.status >= 300 ? li.l.body : null)} sel ${li.sel?.status}`);
  }
  // commission: Lisa 60 % house default per service; Anna has a personal 65 % on the acrylic
  // (a technician's personal rate needs the Super Admin's one-time Admin Authorization Code — by design)
  const com0 = await own.patch(`/pos/technicians/${ctx.techs.anna}/commission`, { byService: [{ serviceId: ctx.services.acrylic, percent: 65 }] });
  const code = await sa.post('/super-admin/commission-auth-code/generate', { tenantId: T, reason: 'Pilot day: Anna personal acrylic rate' });
  const com = await own.patch(`/pos/technicians/${ctx.techs.anna}/commission`, { byService: [{ serviceId: ctx.services.acrylic, percent: 65 }], adminAuthCode: code.body?.code });
  const com2 = await own.patch(`/pos/technicians/${ctx.techs.anna}/commission`, { byService: [{ serviceId: ctx.services.acrylic, percent: 70 }], adminAuthCode: code.body?.code });
  const comR = await own.get(`/pos/technicians/${ctx.techs.anna}/commission`);
  const annaRule = (await q(`select v.commission_value::int as v, v.status from compensation_policies p join compensation_policy_versions v on v.policy_id = p.id where p.tenant_id = $1 and p.technician_id = $2 and p.service_id = $3 and v.status = 'active'`, [T, ctx.techs.anna, ctx.services.acrylic]));
  check('commission rules: without the Super Admin\'s code a personal rate is refused (403); with the one-time code Anna gets 65 % on the Acrylic Full Set — an ACTIVE "Technician + Service" rule of the one engine; the code does not work twice',
    com0.status === 403 && ok2(code.status) && ok2(com.status) && [400, 403].includes(com2.status) && (comR.body?.byService ?? []).some((x) => x.serviceId === ctx.services.acrylic && Number(x.percent) === 65) && annaRule.length === 1 && annaRule[0].v === 65,
    `no-code ${com0.status} code ${code.status} set ${com.status} ${short(com.status >= 300 ? com.body : null)} reuse ${com2.status} read ${short(comR.body)} rule ${short(annaRule)}`);

  // payments: the Super Admin configures THIS salon's gateway (CardPointe, sandbox) — pointed at the loopback fake —
  // runs the live test connection, and the owner sees it ready (step-up from the go-live is still fresh)
  const pg0 = await own.get('/pos/payment-gateway/status');
  const gw = await sa.post(`/super-admin/tenants/${T}/payment-gateway`, { processorType: 'cardpointe', environment: 'sandbox', baseUrl: `http://127.0.0.1:${CP_PORT}/cardconnect/rest`, merchantId: '496160873888', apiUsername: 'pilotuser', apiPassword: 'pilot-pass-' + tag, status: 'active' });
  const gwt = await sa.post(`/super-admin/tenants/${T}/payment-gateway/test-connection`, {});
  const pg1 = await own.get('/pos/payment-gateway/status');
  const gwRow = (await q(`select status, environment, api_password_enc is not null as enc, api_password_enc like '%pilot-pass%' as plain from tenant_payment_config where tenant_id = $1`, [T]))[0];
  check('PAYMENTS: before setup the owner sees "setup required"; the Super Admin sets the salon\'s own CardPointe gateway (sandbox → the loopback fake), the live test connection passes, the owner now sees it active; the password is stored encrypted, never in clear',
    pg0.body?.setupRequired === true && ok2(gw.status) && ok2(gwt.status) && pg1.body?.status === 'active' && gwRow?.enc === true && gwRow?.plain === false,
    `before ${short(pg0.body?.status)} set ${gw.status} ${short(gw.status >= 300 ? gw.body : null)} test ${gwt.status} ${short(gwt.body)} after ${short(pg1.body)} row ${short(gwRow)}`);
  // Twilio: not configured → the salon's SMS readiness says so honestly
  const sms = await own.get('/tenant/sms-plan');
  const msgR = await sa.get(`/super-admin/tenants/${T}/messaging-credentials`);
  info(`SMS plan (tenant): ${sms.status} ${short(sms.body)}; messaging credentials (SA): ${msgR.status} ${short(msgR.body)}`);

  // the customer display at the front desk: register → pairing code on the display → the owner claims it → token
  const st = await own.post('/pos/customer-displays/stations', { name: 'Front Desk' });
  ctx.stationId = st.body?.id ?? st.body?.stationId ?? st.body?.station?.id;
  const dp = await pub.post('/customer-display/pairing', { platform: 'windows' });
  const claim = await own.post('/pos/customer-displays/pair', { code: dp.body?.code, name: 'Front Desk Display', stationId: ctx.stationId });
  const poll = await pub.post(`/customer-display/pairing/${dp.body?.pairingId}/poll`, { pollSecret: dp.body?.pollSecret });
  ctx.displayToken = poll.body?.deviceToken; ctx.displayDeviceId = claim.body?.id ?? claim.body?.deviceId;
  check('customer display: the Front Desk register, the display shows a pairing code, the owner claims it on the POS, the display picks up its credential (paired)',
    ok2(st.status) && ok2(dp.status) && !!dp.body?.code && ok2(claim.status) && poll.body?.status === 'paired' && !!ctx.displayToken,
    `station ${st.status} ${short(st.status >= 300 ? st.body : null)} start ${dp.status} claim ${claim.status} ${short(claim.status >= 300 ? claim.body : null)} poll ${poll.status} ${poll.body?.status}`);

  // inventory: a retail product (cuticle oil, 10 on the shelf) and the gel polish the Gel Manicure uses (its recipe)
  const oil = await own.post('/tenant/inventory/products', { name: 'Cuticle Oil', sku: `OIL-${tag}`, unitType: 'bottle', costCents: 400, retailPriceCents: 1200, isRetail: true, reorderLevel: 3, reorderQuantity: 12 });
  ctx.oilId = oil.body?.id ?? oil.body?.productId ?? oil.body?.product?.id;
  const polish = await own.post('/tenant/inventory/products', { name: 'Gel Polish — Ballet Pink', sku: `GEL-${tag}`, unitType: 'bottle', costCents: 900, isRetail: false, isService: true, reorderLevel: 2, reorderQuantity: 6 });
  ctx.polishId = polish.body?.id ?? polish.body?.productId ?? polish.body?.product?.id;
  const st1 = await own.post(`/tenant/inventory/products/${ctx.oilId}/stock/add`, { quantity: 10, costCents: 400, note: 'Opening stock' });
  const st2 = await own.post(`/tenant/inventory/products/${ctx.polishId}/stock/add`, { quantity: 6, costCents: 900, note: 'Opening stock' });
  const rcp = await own.put(`/tenant/inventory/recipes/${ctx.services.gel}`, { lines: [{ productId: ctx.polishId, quantity: 1 }] });
  const invSum0 = await own.get('/tenant/inventory/products');
  const onHand = (id) => { const r = (invSum0.body?.items ?? invSum0.body?.products ?? invSum0.body ?? []).find?.((x) => (x.id ?? x.productId) === id); return r?.onHand ?? r?.quantityOnHand ?? r?.on_hand ?? r?.stock ?? null; };
  ctx.inv0 = { oil: onHand(ctx.oilId), polish: onHand(ctx.polishId) };
  check('INVENTORY set up: Cuticle Oil (retail $12.00, 10 in stock), Gel Polish (6 in stock) and the Gel Manicure\'s recipe (1 polish per service)',
    ok2(oil.status) && ok2(polish.status) && ok2(st1.status) && ok2(st2.status) && ok2(rcp.status),
    `oil ${oil.status} ${short(oil.status >= 300 ? oil.body : null)} polish ${polish.status} stock ${st1.status}/${st2.status} ${short(st1.status >= 300 ? st1.body : null)} recipe ${rcp.status} ${short(rcp.status >= 300 ? rcp.body : null)} onHand ${short(ctx.inv0)}`);

  // the Go Check-In kiosk: the Super Admin provisions the device, the owner turns check-in on
  const kdev = await sa.post(`/super-admin/tenants/${T}/go-check-in`, { deviceName: 'Front Door iPad', branchId: B, deviceType: 'ipad', baseUrl: 'https://checkin.pilot.test' });
  // the master switch is the Super Admin's (the salon tunes the toggles; its `enabled` is ignored by design)
  const ken = await sa.patch(`/super-admin/tenants/${T}/go-check-in/settings`, { enabled: true });
  const ktog = await own.patch('/pos/settings/go-check-in', { walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true, autoSendToQueue: true, requireFrontDeskApproval: false });
  ctx.kioskSlug = kdev.body?.checkinSlug;
  check('Go Check-In kiosk provisioned by the Super Admin (slug + one-time device token) and switched on (Super Admin master switch; the owner\'s walk-in toggles)', ok2(kdev.status) && !!ctx.kioskSlug && ok2(ken.status) && ok2(ktog.status),
    `device ${kdev.status} ${short(kdev.status >= 300 ? kdev.body : { slug: kdev.body?.checkinSlug })} enable ${ken.status} ${short(ken.status >= 300 ? ken.body : null)}`);

  if (STOP_AFTER <= 2) throw new Error('STOP_AFTER');

  // ══ 3. THE DAY OPENS ═══════════════════════════════════════════════════════════════════════════════════════════════
  phase('3 day opens');
  const LISA = ctx.techs.lisa, MARY = ctx.techs.mary, ANNA = ctx.techs.anna;
  const nameOf = (id) => ({ [LISA]: 'Lisa', [MARY]: 'Mary', [ANNA]: 'Anna' })[id] ?? id;
  // Fair Turn: the Super Admin turns on the queue-assignment package; the owner chooses RECOMMEND_AND_CONFIRM
  const pkg = await sa.post(`/super-admin/ai/tenants/${T}/subscriptions`, { packageCode: 'ai_queue_technician_assignment', status: 'active' });
  const st0 = await own.get('/pos/ai-queue-assignment/settings');
  const ft = await own.put('/pos/ai-queue-assignment/settings', { scope: 'branch', patch: { rotationPolicy: 'traditional_weighted_rotation', assignmentMode: 'RECOMMEND_AND_CONFIRM' }, expectedVersion: st0.body?.branch?.version ?? 0, reason: 'Pilot day: the front desk confirms every turn' });
  check('Fair Turn: the package is on (Super Admin) and the owner sets traditional weighted rotation in RECOMMEND_AND_CONFIRM', ok2(pkg.status) && ok2(ft.status),
    `pkg ${pkg.status} ${short(pkg.status >= 300 ? pkg.body : null)} settings ${st0.status} put ${ft.status} ${short(ft.status >= 300 ? ft.body : null)}`);

  // the kiosk opens; each technician clocks in with her PIN (Lisa, then Mary, then Anna)
  const ks = await pub.post(`/go-check-in/${ctx.kioskSlug}/start-session`, {});
  const KS = ks.body?.sessionId, KT = ks.body?.sessionToken;
  const kiosk = (method, path, body) => fetch(`${API}/go-check-in/session/${KS}${path}`, { method, headers: { 'content-type': 'application/json', 'x-checkin-token': KT }, body: body === undefined ? undefined : JSON.stringify(body) }).then(j);
  check('the Go Check-In kiosk starts a session for the salon (name from the server, nothing from the device)', ok2(ks.status) && !!KS && !!KT && /Pilot Day Nails/.test(ks.body?.config?.salonName ?? ''), `${ks.status} ${short(ks.body?.config)}`);
  const wrongPin = await kiosk('POST', '/technician/clock-in', { pin: '0000', idempotencyKey: randomUUID() });
  const clk = [];
  for (const t of TECH_DEF) { clk.push(await kiosk('POST', '/technician/clock-in', { pin: t.pin, idempotencyKey: `clock-in-${t.key}-${tag}` })); await sleep(40); }
  const again = await kiosk('POST', '/technician/clock-in', { pin: TECH_DEF[0].pin, idempotencyKey: `clock-in-lisa-${tag}` });
  const joins = await q(`select technician_id from technician_turn_events where tenant_id = $1 and branch_id = $2 and event_type = 'JOIN' order by sequence_number`, [T, B]);
  const openShifts = (await q(`select count(*)::int as n from technician_shifts where tenant_id = $1 and end_time is null and status = 'active'`, [T]))[0].n;   // the open punch (580): end_time NULL — there is no clock_out_at column
  check('clock-in by PIN on the kiosk: a wrong PIN is refused; Lisa, Mary and Anna clock in (server time) and JOIN the Fair Turn rotation in that order; the replayed tap writes nothing new',
    wrongPin.status >= 400 && clk.every((r) => ok2(r.status)) && ok2(again.status) && joins.map((x) => nameOf(x.technician_id)).join() === 'Lisa,Mary,Anna' && openShifts === TECH_DEF.length,
    `wrong ${wrongPin.status} ${clk.map((r) => r.status + (r.status >= 300 ? short(r.body) : '')).join(',')} replay ${again.status} joins ${short(joins.map((x) => nameOf(x.technician_id)))} openShifts ${openShifts}`);

  // walk-ins at the kiosk: Jenny (gel + nail art), Kim (spa pedicure)
  const walk = async (name, phone, serviceIds, addOnIds = []) => {
    const lk = await kiosk('POST', '/lookup-phone', { phone });
    const w = await kiosk('POST', '/check-in-walk-in', { customerName: name, phone, serviceIds, addOnIds });
    return { lk, w, queueItemId: w.body?.queueItemId ?? null };
  };
  const JENNY = await walk('Jenny Walker', `+1609557${tag.slice(-4)}`, [ctx.services.gel], [ctx.services.addOn].filter(Boolean));
  const KIM = await walk('Kim Pham', `+1609558${tag.slice(-4)}`, [ctx.services.pedi]);
  ctx.queue = { jenny: JENNY.queueItemId, kim: KIM.queueItemId };
  const qrows = await q(`select id, customer_name, status, requested_services from pos_queue_items where tenant_id = $1 order by created_at`, [T]);
  check('two walk-ins check in on the kiosk (new customer profiles from name + phone) and land in the POS queue',
    ok2(JENNY.w.status) && JENNY.w.body?.status === 'checked_in' && ok2(KIM.w.status) && !!JENNY.queueItemId && !!KIM.queueItemId && qrows.length === 2,
    `jenny ${JENNY.lk.status}/${JENNY.w.status} ${short(JENNY.w.body)} kim ${KIM.w.status} queue ${short(qrows.map((r) => [r.customer_name, r.status]))}`);

  // RECOMMEND_AND_CONFIRM: the engine recommends Lisa (first in), the receptionist confirms; Kim → Mary
  const recommendAndConfirm = async (G, label) => {
    const r = await rec.post(`/pos/ai-queue-assignment/entries/${G}/recommend`, {});
    const recId = r.body?.recommendationId;
    const who = r.body?.envelope?.recommendedTechnicianId ?? r.body?.recommendedTechnicianId ?? (r.body?.envelope?.fairTurn ?? r.body?.fairTurn)?.recommendedTechnicianId ?? null;
    const a = await rec.post(`/pos/ai-queue-assignment/recommendations/${recId}/decision`, { decision: 'accepted', idempotencyKey: `pilot-acc-${label}-${tag}` });
    const item = (await q(`select assigned_technician_id from pos_queue_items where id = $1`, [G]))[0];
    return { r, a, who, assigned: item?.assigned_technician_id };
  };
  const fj = await recommendAndConfirm(ctx.queue.jenny, 'jenny');
  const fk = await recommendAndConfirm(ctx.queue.kim, 'kim');
  check('Fair Turn recommends Lisa for Jenny and Mary for Kim (the rotation, with the "why"); the front desk confirms each',
    ok2(fj.r.status) && fj.who === LISA && ok2(fj.a.status) && fj.assigned === LISA && ok2(fk.r.status) && fk.who === MARY && ok2(fk.a.status) && fk.assigned === MARY,
    `jenny ${fj.r.status} → ${nameOf(fj.who)} acc ${fj.a.status} ${short(fj.a.status >= 300 ? fj.a.body : null)} kim ${fk.r.status} → ${nameOf(fk.who)} acc ${fk.a.status}`);

  const localNowMin = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()); return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value); })();
  const TODAY = localDay();
  info(`salon local time ${hhmmOf(localNowMin)} on ${localDay()}`);
  function hhmmOf(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // ONLINE BOOKING (customer app): SMS verification cannot be switched on without a working Twilio Verify → the salon
  // books without a code (the honest degrade path); the slot is then taken
  const pv = await own.patch(`/pos/settings/booking-phone-verification/branches/${B}`, { enabled: true, verifyEveryBooking: true, channels: { online: true, customerApp: true, aiReceptionist: true } });
  check('booking phone verification (OTP) cannot be switched on while the salon\'s Twilio Verify is not configured (409 — no fake codes)', pv.status === 409, `${pv.status} ${short(pv.body)}`);
  const CUST_EMAIL = `nina.${tag}@pilot-day.test`, CUST_PW = 'Pilot!Cust-' + randomUUID().slice(0, 8), CUST_PHONE = `+1609559${tag.slice(-4)}`;
  const reg = await pub.post('/customer/auth/register', { salonCode: SALON_CODE, firstName: 'Nina', lastName: 'Online', email: CUST_EMAIL, phone: CUST_PHONE, password: CUST_PW });
  const cust = session('customer');
  const cl = await cust.post('/auth/login', { portal: 'customer', identifier: CUST_EMAIL, password: CUST_PW });
  const opts = await cust.get(`/customer/booking/options?salonId=${B}`);
  const avA = await cust.get(`/customer/booking/availability?serviceId=${ctx.services.acrylic}&technicianId=${ANNA}&date=${TODAY}&salonId=${B}`);
  const slotsA = (avA.body?.slots ?? []).filter((x) => x.available !== false && (Number(x.startTime.slice(0, 2)) * 60 + Number(x.startTime.slice(3, 5))) >= localNowMin + 30);
  const pick = slotsA[0]?.startTime;
  const bk = await cust.post('/customer/booking', { serviceId: ctx.services.acrylic, technicianId: ANNA, date: TODAY, startTime: pick, salonId: B }, { 'idempotency-key': `pilot-book-${tag}` });
  const bkAgain = await cust.post('/customer/booking', { serviceId: ctx.services.acrylic, technicianId: ANNA, date: TODAY, startTime: pick, salonId: B }, { 'idempotency-key': `pilot-book-${tag}` });
  ctx.onlineAppointmentId = bk.body?.appointmentId ?? bk.body?.id;
  const apRow = ctx.onlineAppointmentId ? (await q(`select status, phone_verification, technician_id, source, start_time from pos_tech_appointments where id::text = $1`, [String(ctx.onlineAppointmentId)]))[0] : null;
  const avA2 = await cust.get(`/customer/booking/availability?serviceId=${ctx.services.acrylic}&technicianId=${ANNA}&date=${TODAY}&salonId=${B}`);
  const stillFree = (avA2.body?.slots ?? []).find((x) => x.startTime === pick)?.available;
  check(`ONLINE BOOKING: Nina registers in the customer app, sees the menu, books the Acrylic Full Set with Anna today at ${pick ?? '—'}; the retried request (same key) books nothing twice; the slot is no longer offered`,
    reg.body?.ok === true && cl.status === 200 && opts.status === 200 && !!pick && ok2(bk.status) && !!ctx.onlineAppointmentId && ok2(bkAgain.status) && (bkAgain.body?.appointmentId ?? bkAgain.body?.id) === ctx.onlineAppointmentId && apRow?.technician_id === ANNA && stillFree !== true,
    `reg ${short(reg.body)} login ${cl.status} opts ${opts.status} slots ${avA.status} ${slotsA.length} pick ${pick} book ${bk.status} ${short(bk.status >= 300 ? bk.body : null)} replay ${bkAgain.status} row ${short(apRow)} after ${stillFree}`);
  info(`the online appointment's phone verification label: ${apRow?.phone_verification ?? '—'} (OTP not available without Twilio Verify)`);

  // AI RECEPTIONIST: the Super Admin issues the salon's voice key; the AI books a pedicure with Mary by phone
  const vk = await sa.post('/super-admin/voice/keys', { tenantId: T, branchId: B, label: 'Pilot AI receptionist', provider: 'retell' });
  const VOICE_KEY = vk.body?.raw;
  const voice = (method, path, body, idem) => fetch(API + path, { method, headers: { 'x-voice-key': VOICE_KEY, 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j);
  const vs = await voice('GET', '/api/ai-receptionist/v1/services');
  const va = await voice('GET', `/api/ai-receptionist/v1/availability?serviceId=${ctx.services.pedi}&technicianId=${MARY}&date=${TODAY}`);
  const vslots = (va.body?.data?.slots ?? va.body?.slots ?? []).map((x) => x.displayTime ?? x.startTime ?? x).filter((x) => typeof x === 'string' && (Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))) >= localNowMin + 90);
  const vpick = vslots[0];
  const vb = await voice('POST', '/api/ai-receptionist/v1/appointments', { serviceId: ctx.services.pedi, technicianId: MARY, date: TODAY, startTime: vpick, customerName: 'Vera Voice', customerPhone: `+1609550${tag.slice(-4)}`, callerConfirmed: true }, `pilot-voice-${tag}`);
  ctx.voiceAppointmentId = vb.body?.data?.appointment?.id ?? vb.body?.appointmentId ?? vb.body?.appointment?.id;
  const vRow = ctx.voiceAppointmentId ? (await q(`select status, source, technician_id from pos_tech_appointments where id::text = $1`, [String(ctx.voiceAppointmentId)]))[0] : null;
  const offset = (() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value ?? ''; const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(p); return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00'; })();
  const vStart = vb.body?.data?.appointment?.startAt ?? '';
  check(`AI RECEPTIONIST: with the Super Admin's voice key the AI lists the services, finds Mary free at ${vpick ?? '—'} and books Vera's pedicure (no verification code without Twilio); the time it hands the voice platform is in the SALON's zone (${offset})`,
    ok2(vk.status) && !!VOICE_KEY && vs.status === 200 && va.status === 200 && !!vpick && ok2(vb.status) && !!ctx.voiceAppointmentId && vRow?.technician_id === MARY && vStart.endsWith(offset),
    `key ${vk.status} ${short(vk.status >= 300 ? vk.body : null)} services ${vs.status} avail ${va.status} ${short(va.status >= 300 ? va.body : vslots.slice(0, 3))} book ${vb.status} ${short(vb.body)} row ${short(vRow)}`);

  // THE APPOINTMENT ARRIVES: Nina walks in; the front desk checks her in → the queue, with Anna (her booked technician)
  const arr = await rec.post(`/pos/check-in/appointment/${ctx.onlineAppointmentId}`, {});
  const ninaQ = (await q(`select id, status, assigned_technician_id, requested_technician_id, appointment_id from pos_queue_items where tenant_id = $1 and appointment_id::text = $2`, [T, String(ctx.onlineAppointmentId)]))[0];
  ctx.queue.nina = ninaQ?.id;
  check('the appointment arrives: the front desk checks Nina in → she is in the queue for Anna (her booked technician)', ok2(arr.status) && !!ninaQ && (ninaQ.assigned_technician_id === ANNA || ninaQ.requested_technician_id === ANNA),
    `${arr.status} ${short(arr.status >= 300 ? arr.body : arr.body?.status ?? arr.body)} q ${short(ninaQ)}`);
  if (ninaQ && ninaQ.assigned_technician_id !== ANNA) { const asg = await rec.post(`/pos/queue/items/${ninaQ.id}/assign-technician`, { technicianId: ANNA }); info(`Nina assigned to Anna at the desk → ${asg.status}`); }

  // A MULTI-TECHNICIAN VISIT: Olivia wants a gel manicure AND a spa pedicure at the same time — two technicians
  const og = await rec.post('/pos/queue/items', { customerName: 'Olivia Both', customerPhone: `+1609551${tag.slice(-4)}`, serviceIds: [ctx.services.gel, ctx.services.pedi], source: 'walk_in' });
  const OG = og.body?.queueItemId ?? og.body?.id; ctx.queue.olivia = OG;
  const plan = await rec.post(`/pos/queue/plans/assign`, { items: [{ queueItemId: OG, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: ctx.services.gel, technicianId: LISA, expectedTechnicianId: null }, { serviceId: ctx.services.pedi, technicianId: MARY, expectedTechnicianId: null }] }], idempotencyKey: `pilot-olivia-${tag}`, source: 'staff' });
  const oDet = await rec.get(`/pos/queue/items/${OG}`);
  const lines = oDet.body?.serviceLines ?? oDet.body?.lines ?? oDet.body?.item?.serviceLines ?? [];
  check('MULTI-TECHNICIAN: Olivia\'s visit is split — the gel to Lisa, the pedicure to Mary — in ONE assignment', ok2(og.status) && ok2(plan.status),
    `create ${og.status} ${short(og.status >= 300 ? og.body : null)} plan ${plan.status} ${short(plan.status >= 300 ? plan.body : null)} lines ${short(lines.map?.((l) => [l.serviceName ?? l.serviceId, nameOf(l.technicianId ?? l.assignedTechnicianId)]))}`);

  if (STOP_AFTER <= 3) throw new Error('STOP_AFTER');

  // ══ 4. SERVICE → SERVICE DONE → CHECKOUT ═══════════════════════════════════════════════════════════════════════════
  // SCREENS — the front desk's own POS, in Chromium, as the receptionist: the queue with the morning's guests
  if (SCREENS) {
    const sq = await shoot('pos-queue', 'pos-web', '/queue', rec, /Jenny/);
    const sc = await shoot('pos-check-in', 'pos-web', '/check-in', rec, /Check/i);
    check('SCREEN: the POS Queue (receptionist, Chromium) shows the kiosk walk-ins; the Check-In screen renders; no page errors',
      sq.matched && /Kim/.test(sq.text ?? '') && sc.matched && !(sq.pageErrors?.length) && !(sc.pageErrors?.length), short({ q: sq.err ?? (sq.text ?? '').slice(0, 160), qe: sq.pageErrors, c: sc.err ?? sc.pageErrors }));
  }

  phase('4 service + checkout');
  // the front desk sends each guest to the Tech Queue; each technician accepts / starts / finishes HER part in the Tech App
  const parts = async (G) => q(`select id, assigned_technician_id as technician_id from pos_tech_queue_tickets where queue_item_id = $1 order by visit_part`, [G]);
  const serve = async (G, addOnBy = null) => {
    const mv = await rec.post(`/pos/queue/items/${G}/move-to-tech-queue`, {});
    const out = { mv: mv.status, steps: [], ok: ok2(mv.status), err: mv.status >= 300 ? mv.body : null };
    for (const p of await parts(G)) {
      const who = Object.values(TECH_DEF).find((t) => t.id === p.technician_id); const tS = tech[who?.key];
      const a = await tS.post(`/tech/tickets/${p.id}/accept`, {});
      const st = await tS.call('POST', `/tech/tickets/${p.id}/start-service`, undefined, { 'idempotency-key': randomUUID() });
      let ad = null; if (addOnBy && addOnBy === p.technician_id) ad = await tS.post(`/tech/tickets/${p.id}/add-addon`, { serviceId: ctx.services.addOn });
      const dn = await tS.post(`/tech/tickets/${p.id}/service-done`, {}, { 'idempotency-key': randomUUID() });
      const rs = [a, st, ...(ad ? [ad] : []), dn];
      out.steps.push(`${who?.first}:${rs.map((r) => r.status).join('/')}`);
      if (!rs.every((r) => ok2(r.status))) { out.ok = false; out.err = rs.find((r) => !ok2(r.status))?.body; }
    }
    out.ticketId = (await q(`select ticket_id from pos_queue_items where id = $1`, [G]))[0]?.ticket_id ?? null;
    return out;
  };
  const sJ = await serve(ctx.queue.jenny);
  const sK = await serve(ctx.queue.kim, MARY);   // Mary adds the nail-art add-on during Kim's pedicure
  const sO = await serve(ctx.queue.olivia);       // two technicians, one visit
  const sN = await serve(ctx.queue.nina);
  ctx.tickets = { jenny: sJ.ticketId, kim: sK.ticketId, olivia: sO.ticketId, nina: sN.ticketId };
  const tk = await q(`select t.id, t.status, (select json_agg(json_build_object('svc', l.service_name_snapshot, 'tech', l.technician_id, 'price', l.line_total_cents::int) order by l.created_at) from ticket_service_lines l where l.ticket_id = t.id and l.removed_at is null) as lines from tickets t where t.id = any($1::uuid[])`, [Object.values(ctx.tickets).filter(Boolean)]);
  const tOf = (id) => tk.find((x) => x.id === id);
  const credits = await q(`select technician_id, count(*)::int as n from technician_turn_events where tenant_id = $1 and event_type = 'TURN_CREDIT' group by technician_id`, [T]);
  check('SERVICE: every part accepted → started → Service Done in the Tech App; Mary adds the nail-art add-on mid-service; Olivia\'s ONE ticket carries Lisa\'s gel and Mary\'s pedicure; four service_done tickets; Fair Turn credits the technicians',
    [sJ, sK, sO, sN].every((x) => x.ok && !!x.ticketId) && tk.length === 4 && tk.every((x) => x.status === 'service_done')
      && (tOf(ctx.tickets.kim)?.lines ?? []).some((l) => /Nail Art/.test(l.svc) && l.tech === MARY) && new Set((tOf(ctx.tickets.olivia)?.lines ?? []).map((l) => l.tech)).size === 2 && credits.length >= 3,
    `${short([sJ, sK, sO, sN].map((x) => [x.mv, x.steps, x.err && short(x.err)]))} tickets ${short(tk.map((x) => [x.status, (x.lines ?? []).map((l) => `${l.svc}:${nameOf(l.tech)}:${l.price}`)]))} credits ${short(credits.map((c) => [nameOf(c.technician_id), c.n]))}`);

  const TJ = ctx.tickets.jenny, TKIM = ctx.tickets.kim, TO = ctx.tickets.olivia, TN = ctx.tickets.nina;
  const detail = async (t) => (await rec.get(`/pos/checkout/tickets/${t}`)).body;
  const tot = (d) => ({ sub: d?.totals?.subtotalCents ?? d?.subtotalCents, disc: d?.totals?.discountCents ?? d?.discountCents, tax: d?.totals?.taxCents ?? d?.taxCents, tip: d?.totals?.tipCents ?? d?.tipCents, due: d?.totals?.totalDueCents ?? d?.totalDueCents ?? d?.totals?.totalCents });
  const dev = (method, path, body) => fetch(API + '/customer-display/device' + path, { method, headers: { 'x-device-token': ctx.displayToken, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);

  // ── JENNY (Lisa): 10 % first-visit discount, a $10 tip, she also buys a $50 gift card for her friend; the customer
  //    display shows the totals; card through the sandbox processor; the display clears; the receipt
  const jd0 = await detail(TJ);
  info(`Jenny's ticket before checkout: ${short(tot(jd0))} lines ${short((jd0?.lines ?? jd0?.services ?? []).map((l) => [l.serviceName ?? l.name, l.priceCents]))}`);
  const discRec = await rec.post(`/pos/checkout/tickets/${TJ}/apply-discount`, { discountCents: 600, reason: 'First visit 10 %' });   // the front desk may not discount (RBAC)
  const disc = await mgr.post(`/pos/checkout/tickets/${TJ}/apply-discount`, { discountCents: 600, reason: 'First visit 10 %' });
  const tipJ = await rec.post(`/pos/checkout/tickets/${TJ}/apply-tip`, { tipType: 'custom', tipAmountCents: 1000, source: 'pos' });
  const gcs = await rec.post(`/pos/checkout/tickets/${TJ}/gift-card-sale`, { amountCents: 5000, recipient: { name: 'Olivia Both' } });
  ctx.giftCard = gcs.body?.code;
  const send = await rec.post(`/pos/checkout/tickets/${TJ}/send-to-customer-display`, { stationId: ctx.stationId });
  await sleep(300);
  const shown = await dev('GET', '/current');
  const jd1 = await detail(TJ);
  info(`Jenny's ticket at payment: ${short(tot(jd1))}; customer display shows ${short(shown.body?.state ?? shown.body?.mode ?? shown.body)}`);
  const shownText = JSON.stringify(shown.body ?? {});
  const dueJ = tot(jd1).due;
  const dueTxt = Number.isFinite(dueJ) ? (dueJ / 100).toFixed(2) : 'x';
  let scrDisplay = null, scrCheckout = null;
  if (SCREENS) {
    scrCheckout = await shoot('pos-checkout-jenny', 'pos-web', '/checkout', rec, new RegExp(`Jenny Walker[\\s\\S]*Total Due[\\s\\S]*${dueTxt.replace('.', '\\.')}`), async (page) => {
      await page.getByRole('row', { name: /Jenny/ }).getByRole('button', { name: /^Open$/ }).first().click({ timeout: 10_000 }).catch(() => undefined);
    });
    scrDisplay = await shoot('customer-display-totals', 'customer-display', `/?device=${encodeURIComponent(ctx.displayToken ?? '')}`, null, new RegExp(dueTxt.replace('.', '\\.')));
    check(`SCREEN: the POS Checkout workspace (receptionist, Chromium) opens Jenny with Total Due $${dueTxt}; the paired 23-inch customer display (Chromium, its device credential) shows her total $${dueTxt}`,
      !!scrCheckout.matched && !!scrDisplay.matched && !(scrCheckout.pageErrors?.length) && !(scrDisplay.pageErrors?.length), short({ co: scrCheckout.err ?? (scrCheckout.text ?? '').slice(0, 120), d: scrDisplay.err ?? (scrDisplay.text ?? '').slice(0, 200), e: [scrCheckout.pageErrors, scrDisplay.pageErrors] }));
  }
  check('JENNY at the desk: the receptionist may not discount (403) — the manager applies the $6.00 first-visit discount; $10.00 tip and a $50.00 gift card for Olivia go on her ticket; sent to the customer display, which shows the same total the POS shows',
    discRec.status === 403 && ok2(disc.status) && ok2(tipJ.status) && ok2(gcs.status) && !!ctx.giftCard && ok2(send.status) && shown.status === 200 && Number.isFinite(dueJ) && shownText.includes(String(dueJ)),
    `disc ${disc.status} ${short(disc.status >= 300 ? disc.body : null)} tip ${tipJ.status} gc ${gcs.status} ${short(gcs.status >= 300 ? gcs.body : gcs.body?.status)} send ${send.status} ${short(send.status >= 300 ? send.body : null)} display ${shown.status} due ${dueJ} in-display ${shownText.includes(String(dueJ))}`);
  const payJ = await rec.post(`/pos/checkout/tickets/${TJ}/pay/card`, { idempotencyKey: `pilot-card-jenny-${tag}`, ...CARD });
  const payJ2 = await rec.post(`/pos/checkout/tickets/${TJ}/pay/card`, { idempotencyKey: `pilot-card-jenny-${tag}`, ...CARD });
  await sleep(500);
  const afterPay = await dev('GET', '/current');
  // the receptionist taps "Clear Display" (the POS reads the register's display session for this ticket and closes it)
  const cds = await rec.get('/pos/customer-displays');
  const sess = (cds.body?.devices ?? cds.body?.items ?? cds.body ?? []).map?.((x) => x.session).find((x) => x && x.ticketId === TJ);
  const close = sess ? await rec.post(`/pos/customer-display/sessions/${sess.sessionId}/close`, {}) : { status: 0, body: cds.body };
  await sleep(300);
  const cleared = await dev('GET', '/current');
  if (SCREENS) {
    const scl = await shoot('customer-display-cleared', 'customer-display', `/?device=${encodeURIComponent(ctx.displayToken ?? '')}`, null, /Check In Here/);
    await sleep(0);
    check(`SCREEN: after "Clear Display" the customer display no longer shows Jenny's $${dueTxt} — it is back to the check-in screen`, !!scl.matched && !(scl.text ?? '').includes(dueTxt) && !(scl.pageErrors?.length), short({ t: (scl.text ?? '').slice(0, 200), e: scl.err ?? scl.pageErrors }));
  }
  const gcRow = (await q(`select status, balance_cents::int as bal from gift_cards where tenant_id = $1 and code = $2`, [T, ctx.giftCard]).catch(() => []))[0];
  const rcpt = await rec.post(`/pos/checkout/tickets/${TJ}/receipt/sms`, {});
  check('JENNY pays by card through the salon\'s own gateway (CardPointe client → the loopback fake): approved ONCE (the retry replays it); her gift card for Olivia is ACTIVE with $50.00 only now that it is paid; the display shows the payment complete, the receptionist clears it and it leaves the checkout; the SMS receipt is recorded as SIMULATED (no texting provider — nothing claimed as sent)',
    ok2(payJ.status) && payJ.body?.status === 'approved' && /^CP-AUTH-/.test(payJ.body?.processorTransactionId ?? '') && cpCalls.filter((c) => c.path.endsWith('/auth')).length === 1 && payJ2.body?.paymentId === payJ.body?.paymentId && gcRow?.status === 'active' && gcRow?.bal === 5000
      && afterPay.body?.state === 'payment_success' && ok2(close.status) && !JSON.stringify(cleared.body ?? {}).includes(String(dueJ)) && ok2(rcpt.status) && rcpt.body?.delivery === 'simulated',
    `pay ${payJ.status} ${short(payJ.body)} replay ${payJ2.status} gc ${short(gcRow)} display after pay ${short(afterPay.body?.state)} close ${close.status} ${short(close.status >= 300 || !close.status ? close.body : null)} then ${short(cleared.body?.state ?? cleared.body?.mode ?? cleared.body)} receipt ${rcpt.status} ${short(rcpt.body)}`);

  // ── KIM (Mary): she joins the salon's "Pedi Club" membership (20 % off pedicures) — the benefit comes off her bill
  const mPlan = await own.post('/pos/memberships/plans', { name: 'Pedi Club', planCode: `PEDI${tag}`, productType: 'recurring', description: '20 % off every pedicure', memberVisible: true });
  const planId = mPlan.body?.planId ?? mPlan.body?.id;
  const k_ver = await own.post(`/pos/memberships/plans/${planId}/versions`, { billingInterval: 'month', intervalCount: 1, priceCents: 2900, autoRenew: false, termType: 'evergreen',
    benefits: [{ benefitType: 'percent_discount', label: '20 % off pedicures', percent: 20, categorySnapshot: 'Nails', sortOrder: 1 }] });
  const kimCustomer = (await q(`select customer_id from tickets where id = $1`, [TKIM]))[0]?.customer_id;
  const k_enr = await own.post('/pos/memberships/enroll', { customerId: kimCustomer, planId, channel: 'pos', agreementVersion: 'v1' });
  ctx.kimMembershipId = k_enr.body?.membershipId;
  const k_recalc = await rec.post(`/pos/checkout/tickets/${TKIM}/recalculate`, {});
  const k_kd = await detail(TKIM);
  const kimDisc = (k_kd?.discountSnapshot?.applied ?? []).filter((x) => x.category === 'membership').reduce((a, x) => a + Number(x.appliedCents ?? 0), 0);
  numbers.kimMemberDiscountCents = kimDisc;
  info(`Kim's ticket: ${short(tot(k_kd))} discounts ${short((k_kd?.discountSnapshot?.applied ?? k_kd?.discounts ?? []).map?.((x) => [x.category, x.appliedCents ?? x.amountCents, x.description]))}`);
  check('KIM: the owner publishes the "Pedi Club" plan (20 % off pedicures) and enrolls Kim; at checkout the membership benefit comes off her ticket automatically',
    ok2(mPlan.status) && ok2(k_ver.status) && ok2(k_enr.status) && !!ctx.kimMembershipId && Number(kimDisc) > 0,
    `plan ${mPlan.status} ${short(mPlan.status >= 300 ? mPlan.body : null)} k_ver ${k_ver.status} ${short(k_ver.status >= 300 ? k_ver.body : null)} enroll ${k_enr.status} ${short(k_enr.status >= 300 ? k_enr.body : k_enr.body?.status)} k_recalc ${k_recalc.status} disc ${kimDisc}`);
  const k_payK = await rec.post(`/pos/checkout/tickets/${TKIM}/pay/cash`, { amountReceivedCents: 10000 }, { 'idempotency-key': `pilot-cash-kim-${tag}` });
  check('KIM pays cash — change computed by the server', ok2(k_payK.status), `${k_payK.status} ${short(k_payK.body)}`);

  // ── OLIVIA (Lisa + Mary on ONE visit): a $20 tip, then the $50 gift card Jenny bought her + the rest by card (split)
  const tipO = await rec.post(`/pos/checkout/tickets/${TO}/apply-tip`, { tipType: 'custom', tipAmountCents: 2000, source: 'pos' });
  const look = await rec.post('/pos/checkout/gift-cards/lookup', { code: ctx.giftCard });
  const rcO = await rec.post(`/pos/checkout/tickets/${TO}/recalculate`, { paymentMethod: 'split' });   // as the POS does on "Split"
  const od = await detail(TO);
  const dueO = tot(od).due;
  const splitO = await rec.post(`/pos/checkout/tickets/${TO}/pay/split`, { segments: [{ method: 'gift_card', amountCents: 5000, giftCardCode: ctx.giftCard }, { method: 'card', amountCents: dueO - 5000 }], ...CARD }, { 'idempotency-key': `pilot-split-olivia-${tag}` });
  const gcAfter = (await q(`select balance_cents::int as bal from gift_cards where tenant_id = $1 and code = $2`, [T, ctx.giftCard]))[0]?.bal;
  const oPays = await q(`select method, amount_cents::int as amt, status from payments where ticket_id = $1 order by created_at`, [TO]);
  check(`OLIVIA: a $20.00 tip; the gift card (balance $50.00) pays $50.00 and a card pays the rest of ${money(dueO)} — two payments, the card's balance is now $0.00`,
    ok2(tipO.status) && ok2(look.status) && ok2(splitO.status) && gcAfter === 0 && oPays.filter((p) => p.status === 'approved' || p.status === 'captured' || p.status === 'paid').length >= 2,
    `tip ${tipO.status} lookup ${look.status} ${short(look.status >= 300 ? look.body : look.body?.balanceCents)} split ${splitO.status} ${short(splitO.body)} gc ${gcAfter} pays ${short(oPays)}`);

  // the compensation snapshot — the ONE money authority — for every paid ticket so far
  let snaps = []; for (let i = 0; i < 40; i++) { snaps = await q(`select ticket_id, technician_id, sum(tech_service_earnings_cents)::int as earn, sum(card_tip_cents + cash_tip_cents)::int as tip from ticket_compensation_snapshots where ticket_id = any($1::uuid[]) group by ticket_id, technician_id`, [[TJ, TKIM, TO]]); if (snaps.filter((x) => x.ticket_id === TO).length >= 2) break; await sleep(250); }
  const sOf = (t, who) => snaps.find((x) => x.ticket_id === t && x.technician_id === who);
  numbers.snapshots = snaps.map((x) => ({ ticket: Object.entries(ctx.tickets).find(([, v]) => v === x.ticket_id)?.[0], tech: nameOf(x.technician_id), earnCents: x.earn, tipCents: x.tip }));
  info(`compensation snapshots: ${short(numbers.snapshots)}`);
  check('TIP SPLIT + COMMISSION: Olivia\'s $20.00 tip is split between Lisa and Mary with no lost cent; Jenny\'s $10.00 tip is all Lisa\'s; every paid ticket wrote its immutable snapshot',
    !!sOf(TO, LISA) && !!sOf(TO, MARY) && sOf(TO, LISA).tip + sOf(TO, MARY).tip === 2000 && sOf(TO, LISA).tip > 0 && sOf(TO, MARY).tip > 0 && sOf(TJ, LISA)?.tip === 1000 && !!sOf(TKIM, MARY),
    short(numbers.snapshots));

  if (STOP_AFTER <= 4) throw new Error('STOP_AFTER');

  // ══ 5. TAP TO PAY on the manager's phone (the Owner & Manager Pay app) ═════════════════════════════════════════════
  phase('5 tap to pay');
  {
  const DEV = `iphone-${tag}`;
  const onb = await sa.post(`/super-admin/tap-to-pay/tenants/${T}/onboarding`, { appleEntitlementStatus: 'approved', pspEnrollmentStatus: 'active', notes: 'Pilot day: sandbox Tap to Pay' });
  const reg = await mgr.post('/mobile-checkout/device/register', { deviceId: DEV, label: "Max's iPhone", platform: 'ios', osVersion: '18.1', appVersion: '1.0.0', tapToPayCapable: true });
  const appr = await own.post(`/mobile-checkout/devices/${DEV}/approve`, {});
  const cap = await mgr.get(`/mobile-checkout/capability?deviceId=${DEV}`);
  check('Tap to Pay set up: the Super Admin records the salon\'s onboarding (Apple entitlement + PSP active); the manager registers her iPhone; the owner approves it; the phone reports Tap to Pay available (sandbox)',
    ok2(onb.status) && ok2(reg.status) && ok2(appr.status) && cap.status === 200,
    `onb ${onb.status} ${short(onb.status >= 300 ? onb.body : null)} reg ${reg.status} ${short(reg.status >= 300 ? reg.body : reg.body?.status)} approve ${appr.status} ${short(appr.status >= 300 ? appr.body : null)} cap ${cap.status} ${short(cap.body)}`);
  // Nina's ticket: the manager claims it on the phone; split: $20 cash + the rest by Tap to Pay
  const SID = `pay-sess-${tag}`;
  const qmc = await mgr.get('/mobile-checkout/queue');
  const lock = await mgr.post(`/mobile-checkout/tickets/${TN}/lock`, { deviceId: DEV, sessionId: SID });
  const posTry = await rec.post(`/pos/checkout/tickets/${TN}/pay/cash`, { amountReceivedCents: 20000 }, { 'idempotency-key': `pilot-pos-race-${tag}` });
  const tkt = await mgr.get(`/mobile-checkout/tickets/${TN}`);
  const ver1 = tkt.body?.version ?? tkt.body?.ticket?.version;
  info(`Nina's ticket on the phone: ${short({ v: ver1, total: tkt.body?.totals ?? tkt.body?.ticket?.totals })}; POS tried to take cash while the phone held the claim → ${posTry.status} ${short(posTry.body?.message ?? posTry.body)}`);
  check('the manager opens Nina\'s ticket from the phone\'s queue and CLAIMS it; while the phone holds the claim the front desk cannot take a second payment (no duplicate charge)',
    qmc.status === 200 && ok2(lock.status) && posTry.status >= 400 && /mobile device|claim/i.test(JSON.stringify(posTry.body)) && tkt.status === 200, `queue ${qmc.status} lock ${lock.status} ${short(lock.status >= 300 ? lock.body : null)} pos ${posTry.status} ticket ${tkt.status}`);
  const rtl = await mgr.post(`/mobile-checkout/tickets/${TN}/retail`, { productId: ctx.oilId, quantity: 1 });
  info(`retail on the phone: Nina takes a Cuticle Oil home → ${rtl.status} ${short(rtl.status >= 300 ? rtl.body : rtl.body?.ok ?? rtl.body)}`);
  const cash = await mgr.post(`/mobile-checkout/tickets/${TN}/cash-tender`, { sessionId: SID, idempotencyKey: `pilot-ttp-cash-${tag}`, amountCents: 2000, deviceId: DEV });
  let bal = await mgr.get(`/mobile-checkout/tickets/${TN}/balance`);
  const remaining = bal.body?.remainingCents ?? bal.body?.balanceCents ?? bal.body?.remaining;
  let tk2 = await mgr.get(`/mobile-checkout/tickets/${TN}`);
  let pr = await mgr.post(`/mobile-checkout/tickets/${TN}/proceed-to-payment`, { sessionId: SID, deviceId: DEV, expectedVersion: tk2.body?.version ?? tk2.body?.ticket?.version });
  if (pr.body?.reason === 'STEP_UP_REQUIRED') { const su = await mgr.post('/auth/step-up', { password: STAFF_PW }); info(`step-up for the charge → ${su.status}`); pr = await mgr.post(`/mobile-checkout/tickets/${TN}/proceed-to-payment`, { sessionId: SID, deviceId: DEV, expectedVersion: tk2.body?.version ?? tk2.body?.ticket?.version }); }
  const KEY = pr.body?.idempotencyKey ?? `pilot-ttp-${tag}`;
  const att = await mgr.post(`/mobile-checkout/tickets/${TN}/payment-attempts`, { sessionId: SID, idempotencyKey: KEY, amountCents: remaining, deviceId: DEV, expectedVersion: pr.body?.version ?? tk2.body?.version });
  const ready = await mgr.post(`/mobile-checkout/payment-attempts/${KEY}/readiness`, { deviceId: DEV });
  const ds = await mgr.post(`/mobile-checkout/payment-attempts/${KEY}/device-session`, { deviceId: DEV });
  // (the iPhone's reader runs here — the SDK hands back the PaymentSession id it captured)
  const capt = await mgr.post(`/mobile-checkout/payment-attempts/${KEY}/capture-result`, { outcome: 'approved', processorRef: ds.body?.sessionToken ?? ds.body?.session?.sessionToken, brand: 'visa', last4: '4242', capturedAmountCents: remaining, deviceId: DEV });
  const capt2 = await mgr.post(`/mobile-checkout/payment-attempts/${KEY}/capture-result`, { outcome: 'approved', processorRef: ds.body?.sessionToken ?? ds.body?.session?.sessionToken, brand: 'visa', last4: '4242', capturedAmountCents: remaining, deviceId: DEV });
  const nPays = await q(`select method, amount_cents::int as amt, status from payments where ticket_id = $1 order by created_at`, [TN]);
  const nStatus = (await q(`select status from tickets where id = $1`, [TN]))[0]?.status;
  const charges = chCalls.filter((c) => c.path === '/payments/v1/charges');
  check(`TAP TO PAY split: $20.00 cash on the phone, then ${money(remaining)} by Tap to Pay — proceed → intent → readiness → session (CommerceHub fake, signed) → capture: ONE charge at the server-checked amount, the retried result changes nothing; the ticket is paid with two payments`,
    ok2(cash.status) && Number(remaining) > 0 && ok2(att.status) && ok2(ready.status) && ok2(ds.status) && ok2(capt.status) && ok2(capt2.status) && charges.length === 1 && charges[0].signed
      && nStatus === 'paid' && nPays.length === 2 && nPays.some((p) => p.method === 'cash' && p.amt === 2000),
    `cash ${cash.status} ${short(cash.status >= 300 ? cash.body : null)} bal ${short(bal.body)} proceed ${pr.status} ${short(pr.body)} attempt ${att.status} ${short(att.status >= 300 ? att.body : null)} ready ${ready.status} ${short(ready.status >= 300 ? ready.body : null)} session ${ds.status} ${short(ds.status >= 300 ? ds.body : null)} capture ${capt.status} ${short(capt.body)} / ${capt2.status} charges ${charges.length} ticket ${nStatus} pays ${short(nPays)}`);
  const rel = await mgr.post(`/mobile-checkout/tickets/${TN}/lock/release`, { sessionId: SID, reason: 'paid' });
  info(`claim released → ${rel.status}`);

  }
  if (STOP_AFTER <= 5) throw new Error('STOP_AFTER');

  // ══ 6. A REFUND, INVENTORY, LOYALTY ═════════════════════════════════════════════════════════════════════════════════
  phase('6 refund + inventory + loyalty');
  {
    // Jenny calls: the nail art chipped by evening — the owner refunds that line ($15.00) to her card
    const jdet = await own.get(`/pos/checkout/tickets/${TJ}`);
    const artLine = (jdet.body?.completedServices ?? jdet.body?.lines ?? []).find((l) => /Nail Art/.test(l.serviceName ?? l.name ?? ''));
    const pv = await own.get(`/pos/checkout/tickets/${TJ}/refund-preview?amountCents=1500`);
    const rf = await own.post(`/pos/checkout/tickets/${TJ}/refund`, { reason: 'Nail art chipped the same day', amountCents: 1500, serviceLineIds: artLine ? [artLine.serviceLineId ?? artLine.id] : undefined }, { 'idempotency-key': `pilot-refund-jenny-${tag}` });
    const rf2 = await own.post(`/pos/checkout/tickets/${TJ}/refund`, { reason: 'Nail art chipped the same day', amountCents: 1500, serviceLineIds: artLine ? [artLine.serviceLineId ?? artLine.id] : undefined }, { 'idempotency-key': `pilot-refund-jenny-${tag}` });
    const recRf = await rec.post(`/pos/checkout/tickets/${TJ}/refund`, { reason: 'front desk try', amountCents: 100 }, { 'idempotency-key': `pilot-refund-rec-${tag}` });
    let adj = []; for (let i = 0; i < 40; i++) { adj = await q(`select technician_id, category, amount_cents::int as amount, status, period_id from compensation_adjustments where ticket_id = $1 and source = 'refund'`, [TJ]); if (adj.length) break; await sleep(250); }
    const cpRefunds = cpCalls.filter((c) => c.path.endsWith('/refund'));
    numbers.refund = { amountCents: 1500, reversal: adj.map((a) => ({ tech: nameOf(a.technician_id), category: a.category, cents: a.amount, status: a.status })) };
    check('REFUND: the owner refunds Jenny\'s $15.00 nail-art line to her card (the CardPointe refund, ONCE — the retry replays); the receptionist may not refund (403); Lisa\'s commission on that line is reversed as a ledger adjustment (never by editing the paid snapshot)',
      ok2(rf.status) && ok2(rf2.status) && cpRefunds.length === 1 && recRf.status === 403 && adj.length >= 1 && adj.filter((a) => a.technician_id === LISA).reduce((n, a) => n + a.amount, 0) < 0,
      `preview ${pv.status} ${short(pv.body)} refund ${rf.status} ${short(rf.body)} replay ${rf2.status} cp-refunds ${cpRefunds.length} rec ${recRf.status} adj ${short(numbers.refund.reversal)}`);

    // inventory: the oil sold on the phone left the shelf; the two gel manicures' polish is recorded from the recipe
    const used = await own.post(`/tenant/inventory/recipes/${ctx.services.gel}/consume`, { multiplier: 2 });
    const invNow = await own.get('/tenant/inventory/products');
    const onHand2 = (id) => { const r = (invNow.body?.items ?? invNow.body?.products ?? invNow.body ?? []).find?.((x) => (x.id ?? x.productId) === id); return r?.onHand ?? r?.quantityOnHand ?? r?.on_hand ?? r?.stock ?? null; };
    numbers.inventory = { before: ctx.inv0, after: { oil: onHand2(ctx.oilId), polish: onHand2(ctx.polishId) } };
    check('INVENTORY: the Cuticle Oil sold on the phone left the shelf (10 → 9); recording today\'s two gel manicures takes 2 polish by the recipe (6 → 4)',
      ok2(used.status) && numbers.inventory.after.oil === 9 && numbers.inventory.after.polish === 4, `consume ${used.status} ${short(used.status >= 300 ? used.body : used.body)} ${short(numbers.inventory)}`);

    // loyalty: 1 point per dollar paid, once per payment (the event consumer), visible on the customer's card
    let pts = []; for (let i = 0; i < 40; i++) { pts = await q(`select c.full_name as name, sum(e.points)::int as pts, count(*)::int as n from loyalty_point_earnings e join customers c on c.id = e.customer_id where e.tenant_id = $1 group by c.full_name`, [T]).catch(() => []); if (pts.length >= 3) break; await sleep(250); }
    const jennyCust = (await q(`select customer_id from tickets where id = $1`, [TJ]))[0]?.customer_id;
    const lyl = await rec.get(`/pos/customers/${jennyCust}/loyalty`);
    numbers.loyalty = pts;
    const earnRows = await q(`select e.points::int as pts, e.amount_cents::int as amt from loyalty_point_earnings e where e.tenant_id = $1`, [T]);
    const jEarn = pts.find((p) => /Jenny/.test(p.name))?.pts ?? null;
    check('LOYALTY: every approved payment earned 1 point per whole dollar for its customer, exactly once (the payment event consumer); the POS customer card shows Jenny\'s balance NET of the refund reversal (earned − 15)',
      earnRows.length >= 4 && earnRows.every((r) => r.pts === Math.floor(r.amt / 100)) && lyl.status === 200 && lyl.body?.points === (jEarn ?? 0) - 15,
      `${short(pts)} pos ${lyl.status} ${short(lyl.body && { points: lyl.body.points, earned: lyl.body.earned })}`);
  }

  if (STOP_AFTER <= 6) throw new Error('STOP_AFTER');

  // ══ 7. END OF DAY ═══════════════════════════════════════════════════════════════════════════════════════════════════
  phase('7 end of day');
  {
    // ── 7a. THE BOOKS BALANCE: one set of numbers, from every screen ─────────────────────────────────────────────────
    const pays = await q(`select method, status, amount_cents::int as amt, surcharge_cents::int as sur from payments where tenant_id = $1 order by created_at`, [T]);
    const REVENUE = ['approved', 'partial', 'paid', 'captured'];
    const collected = pays.filter((p) => REVENUE.includes(p.status)).reduce((n, p) => n + p.amt, 0);
    const refunded = pays.filter((p) => p.status === 'refunded').reduce((n, p) => n + p.amt, 0);
    const gcSold = (await q(`select coalesce(sum(purchased_cents), 0)::int as n from gift_cards where tenant_id = $1 and sale_ticket_id is not null`, [T]).catch(() => q(`select 0 as n`)))[0].n;
    const snapAll = await q(`select technician_id, sum(gross_price_cents)::int as gross, sum(tech_service_earnings_cents)::int as earn, sum(card_tip_cents + cash_tip_cents)::int as tip from ticket_compensation_snapshots where tenant_id = $1 group by technician_id`, [T]);
    const snapGross = snapAll.reduce((n, x) => n + x.gross, 0), snapTips = snapAll.reduce((n, x) => n + x.tip, 0);
    numbers.payments = pays; numbers.collectedCents = collected; numbers.refundedCents = refunded; numbers.giftCardsSoldCents = gcSold;
    numbers.snapshotsByTech = snapAll.map((x) => ({ tech: nameOf(x.technician_id), gross: x.gross, earn: x.earn, tip: x.tip }));
    const sales = (await own.get('/pos/reports/sales?preset=today')).body?.kpis ?? {};
    const pmix = (await own.get('/pos/reports/payments?preset=today')).body ?? {};
    const tipsR = (await own.get('/pos/reports/tips?preset=today')).body ?? {};
    const comm = (await own.get('/pos/commission-report/state?preset=today')).body ?? {};
    info(`commission report: ${short({ kpis: comm.kpis, rows: (comm.rows ?? []).length, range: comm.range ?? comm.filters ?? comm.window, err: comm.message })}`);
    const fin = (await own.get('/owner/finance/summary?period=today')).body ?? {};
    const finMonth = (await own.get('/owner/finance/summary')).body ?? {};
    numbers.reports = { sales, payments: pmix, tips: { total: tipsR.totalCents, byTechnician: tipsR.byTechnician }, commission: comm.kpis, ownerFinance: { totalRevenueCents: fin.totalRevenueCents ?? finMonth.totalRevenueCents, tipsCents: finMonth.tipsCents, discountsCents: finMonth.discountsCents, taxCollectedCents: finMonth.taxCollectedCents, totalCommissionCents: finMonth.totalCommissionCents } };
    info(`collected ${money(collected)} (refunded ${money(refunded)}); sales KPIs ${short(sales)}; owner finance ${short(numbers.reports.ownerFinance)}`);
    check(`PAYMENTS = PAYMENTS MIX: the POS payments report's card + cash + gift card (${money((pmix.cardCents ?? 0) + (pmix.cashCents ?? 0) + (pmix.giftCardCents ?? 0))}) is exactly what was collected (${money(collected)}); refunds ${money(refunded)} reported separately`,
      (pmix.cardCents ?? 0) + (pmix.cashCents ?? 0) + (pmix.giftCardCents ?? 0) === collected && pmix.refundsCents === refunded, short(pmix));
    const identity = (sales.grossSalesCents ?? 0) - (sales.discountsCents ?? 0) + (sales.taxCollectedCents ?? 0) + (sales.tipsCents ?? 0) + (sales.cardSurchargeCents ?? 0) + gcSold;
    check(`SALES = PAYMENTS: sales ${money(sales.grossSalesCents)} − discounts ${money(sales.discountsCents)} + tax ${money(sales.taxCollectedCents)} + tips ${money(sales.tipsCents)} + card surcharge ${money(sales.cardSurchargeCents)} + gift cards sold ${money(gcSold)} = ${money(identity)} = collected ${money(collected)}`,
      identity === collected, `identity ${identity} vs ${collected}`);
    check(`SALES = PAYROLL BASIS: the report's service sales (${money(sales.serviceSalesCents)}) are the compensation snapshot's service gross (${money(snapGross)}); tips: report ${money(sales.tipsCents)} = snapshot ${money(snapTips)} = commission report ${money(comm.kpis?.totalTipsCents)}`,
      sales.serviceSalesCents === snapGross && sales.tipsCents === snapTips && comm.kpis?.totalTipsCents === snapTips, `${sales.serviceSalesCents}/${snapGross} tips ${sales.tipsCents}/${snapTips}/${comm.kpis?.totalTipsCents}`);
    const byTipR = Object.fromEntries((tipsR.byTechnician ?? []).map((x) => [x.technicianId, x.tipsCents]));
    check('TIPS BY TECHNICIAN: the POS tips report, the commission report and the payroll snapshot agree per technician (Olivia\'s split tip split)',
      snapAll.every((x) => (byTipR[x.technician_id] ?? 0) === x.tip && (comm.rows ?? []).find((r) => r.technicianId === x.technician_id)?.tipsCents === x.tip), short({ report: byTipR, snapshot: numbers.snapshotsByTech }));
    check(`OWNER APP = POS: the Owner app's finance (month to date) shows revenue ${money(finMonth.totalRevenueCents)} = collected, tips ${money(finMonth.tipsCents)}, discounts ${money(finMonth.discountsCents)}, commission ${money(finMonth.totalCommissionCents)} = the commission report`,
      finMonth.totalRevenueCents === collected && finMonth.tipsCents === snapTips && finMonth.discountsCents === sales.discountsCents && finMonth.totalCommissionCents === comm.kpis?.totalCommissionCents && finMonth.taxCollectedCents === sales.taxCollectedCents,
      short(numbers.reports.ownerFinance));
    numbers.reports.ownerFinance.averageTicketCents = fin.averageTicketCents;
    check(`OWNER APP = POS: the Owner app's average ticket today (${money(fin.averageTicketCents)}, sales ÷ paid tickets) is the POS sales report's (${money(sales.averageTicketCents)}: ${money(sales.grossSalesCents)} ÷ ${sales.ticketsCount})`,
      Number.isFinite(fin.averageTicketCents) && fin.averageTicketCents === sales.averageTicketCents, short({ owner: { avg: fin.averageTicketCents, txns: fin.totalTransactions }, pos: { avg: sales.averageTicketCents, gross: sales.grossSalesCents, n: sales.ticketsCount } }));
    const techApp = {}; for (const t of TECH_DEF) techApp[t.key] = (await tech[t.key].get('/tech/earnings')).body;
    numbers.techApp = techApp;
    check('TECH APP = PAYROLL: each technician\'s Tech App earnings today (commission + tips) equal her row in the commission report',
      TECH_DEF.every((t) => { const r = (comm.rows ?? []).find((x) => x.technicianId === t.id); return r && techApp[t.key]?.estimatedCommissionCents === r.commissionCents && techApp[t.key]?.tipsCents === r.tipsCents; }), short(techApp));
    const drawer = (await own.get('/pos/cash-drawer')).body ?? {};
    const cashCollected = pays.filter((p) => p.method === 'cash' && REVENUE.includes(p.status)).reduce((n, p) => n + p.amt, 0);
    check(`CASH DRAWER: tonight's expected register cash (${money(drawer.expectedSalesCents)}) is every cash payment taken today incl. the $20.00 cash part of Nina's split (${money(cashCollected)})`, drawer.expectedSalesCents === cashCollected, short(drawer));

    // ── 7b. the time clock closes: each technician clocks out with her PIN on the kiosk ───────────────────────────────
    const ks2 = await pub.post(`/go-check-in/${ctx.kioskSlug}/start-session`, {});
    const kout = []; for (const t of TECH_DEF) kout.push(await fetch(`${API}/go-check-in/session/${ks2.body?.sessionId}/technician/clock-out`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-checkin-token': ks2.body?.sessionToken }, body: JSON.stringify({ pin: t.pin, idempotencyKey: `clock-out-${t.key}-${tag}` }) }).then(j));
    const tc = (await own.get('/pos/time-clock/state')).body ?? {};
    numbers.timeClock = (tc.technicians ?? []).map((x) => ({ tech: x.technicianName, state: x.state, shifts: (x.shifts ?? []).map((s2) => ({ start: s2.startTime, end: s2.endTime, status: s2.status })) }));
    check('TIME CLOCK closes: Lisa, Mary and Anna clock out by PIN on the kiosk; nobody is left clocked in and every shift has an end time',
      kout.every((r) => ok2(r.status)) && tc.kpis?.clockedInCount === 0 && (tc.technicians ?? []).every((x) => (x.shifts ?? []).every((s2) => !!s2.endTime)), `${kout.map((r) => r.status + (r.status >= 300 ? short(r.body) : '')).join(',')} ${short(tc.kpis)}`);

    // ── 7c. PAYROLL: period → (refund adjustment approved) → prepare → approve (step-up) → export → pay/lock ─────────
    const P1 = await own.post('/pos/payroll/periods', { label: `Pilot week ${tag}`, periodStart: d(-1), periodEnd: d(1) });
    const PID = P1.body?.id;
    const pend = await own.get('/pos/payroll/adjustments?status=pending');
    let decided = 0; for (const a of (pend.body ?? [])) { const r = await own.post(`/pos/payroll/adjustments/${a.id}/decide`, { decision: 'approve' }); if (ok2(r.status)) decided++; }
    const prep = await own.post(`/pos/payroll/periods/${PID}/prepare`, {});
    const lineOf = (t) => (prep.body?.lines ?? []).find((l) => l.technicianId === t);
    numbers.payroll = { period: prep.body?.period && { status: prep.body.period.status, previewHash: prep.body.period.previewHash }, lines: (prep.body?.lines ?? []).map((l) => ({ tech: nameOf(l.technicianId), commissionCents: l.commissionCents, tipsCents: l.tipsCents, adjustmentCents: l.adjustmentCents, payableCents: l.payableCents })) };
    check('PAYROLL PREPARE: the refund\'s commission reversal for Lisa rides in the period as an adjustment; the period\'s lines are exactly the commission report per technician (commission incl. the reversal, tips) — no other calculation',
      ok2(P1.status) && ok2(prep.status) && (lineOf(LISA)?.adjustmentCents ?? 0) < 0 && TECH_DEF.every((t) => { const r = (comm.rows ?? []).find((x) => x.technicianId === t.id); const l = lineOf(t.id); return r && l && l.commissionCents + (l.adjustmentCents ?? 0) === r.commissionCents && l.tipsCents === r.tipsCents; }),
      `${P1.status} ${prep.status} ${short(prep.status >= 300 ? prep.body : numbers.payroll)} decided ${decided}/${(pend.body ?? []).length}`);
    const su = await own.post('/auth/step-up', { password: OWNER_PW });
    const fin1 = await own.post(`/pos/payroll/periods/${PID}/finalize`, { expectedVersion: prep.body?.period?.version, calculationHash: prep.body?.period?.previewHash });
    const ex = await own.post(`/pos/payroll/periods/${PID}/export`, { format: 'csv' });
    const csv = ex.body?.base64 ? Buffer.from(ex.body.base64, 'base64').toString('utf8') : '';
    const payP = await own.post(`/pos/payroll/periods/${PID}/pay`, { method: 'direct_deposit', reference: `ACH-PILOT-${tag}` });
    const lock = await q(`update payroll_lines set payable_cents = payable_cents + 1 where period_id = $1`, [PID]).then(() => 'updated', (e) => String(e.message));
    numbers.payroll.csvHead = csv.split('\n').slice(0, 4);
    check('PAYROLL APPROVE → EXPORT → PAY → LOCK: approved with the owner\'s fresh step-up and the hash she reviewed; the CSV carries every technician\'s exact cents; marked paid; the paid lines are refused at the DATABASE',
      ok2(su.status) && ok2(fin1.status) && ok2(ex.status) && TECH_DEF.every((t) => csv.includes(String(lineOf(t.id)?.payableCents ?? 'x'))) && ok2(payP.status) && payP.body?.period?.status === 'paid' && /locked/i.test(lock),
      `step-up ${su.status} approve ${fin1.status} ${short(fin1.status >= 300 ? fin1.body : null)} export ${ex.status} pay ${payP.status} ${short(payP.status >= 300 ? payP.body : payP.body?.period?.status)} lock ${lock.slice(0, 60)}`);

    // a refund AFTER the lock → the reversal lands in the NEXT open period; the locked lines never move
    const P2 = await own.post('/pos/payroll/periods', { label: `Pilot next week ${tag}`, periodStart: d(2), periodEnd: d(8) });
    const before = await q(`select technician_id, commission_cents, tips_cents, payable_cents from payroll_lines where period_id = $1 order by technician_id`, [PID]);
    const kimArt = ((await own.get(`/pos/checkout/tickets/${TKIM}`)).body?.completedServices ?? []).find((l) => /Nail Art/.test(l.serviceName ?? ''));
    const rf = await own.post(`/pos/checkout/tickets/${TKIM}/refund`, { reason: 'Nail art smudged — refunded next morning', amountCents: 1200, serviceLineIds: kimArt ? [kimArt.serviceLineId] : undefined }, { 'idempotency-key': `pilot-refund-kim-${tag}` });
    let adj = []; for (let i = 0; i < 40; i++) { adj = await q(`select technician_id, amount_cents::int as amount, status, period_id, original_period_id from compensation_adjustments where ticket_id = $1 and source = 'refund'`, [TKIM]); if (adj.length) break; await sleep(250); }
    const after = await q(`select technician_id, commission_cents, tips_cents, payable_cents from payroll_lines where period_id = $1 order by technician_id`, [PID]);
    const pend2 = await own.get('/pos/payroll/adjustments?status=pending');
    for (const a of (pend2.body ?? []).filter((x) => x.periodId === P2.body?.id)) await own.post(`/pos/payroll/adjustments/${a.id}/decide`, { decision: 'approve' });
    const prep2 = await own.post(`/pos/payroll/periods/${P2.body?.id}/prepare`, {});
    const maryNext = (prep2.body?.lines ?? []).find((l) => l.technicianId === MARY);
    numbers.payroll.afterLockRefund = { refundCents: 1200, adjustments: adj.map((a) => ({ tech: nameOf(a.technician_id), cents: a.amount, status: a.status, inNextPeriod: a.period_id === P2.body?.id, fromLockedPeriod: a.original_period_id === PID })), maryNextPeriodAdjustment: maryNext?.adjustmentCents };
    check('REFUND AFTER THE LOCK: Kim\'s $12.00 refund (cash) the next morning reverses Mary\'s commission ONCE as an adjustment in the NEXT open period, linked to the locked one; the locked lines are byte-for-byte unchanged; next period\'s preparation carries it',
      ok2(P2.status) && ok2(rf.status) && adj.length >= 1 && adj.every((a) => a.period_id === P2.body?.id && a.original_period_id === PID) && JSON.stringify(before) === JSON.stringify(after) && (maryNext?.adjustmentCents ?? 0) < 0,
      `p2 ${P2.status} refund ${rf.status} ${short(rf.status >= 300 ? rf.body : null)} ${short(numbers.payroll.afterLockRefund)}`);
    const tp = await tech.mary.get('/tech/payroll');
    const myP = (tp.body?.periods ?? []).find((p2) => p2.periodId === PID);
    check('TECH APP shows the same payroll: Mary sees the paid period with exactly her payable, nothing outstanding',
      tp.status === 200 && !!myP && myP.paidCents === lineOf(MARY)?.payableCents && myP.outstandingCents === 0, `${tp.status} ${short(myP)}`);
    const op = await own.get('/owner/payroll');
    const opP = (op.body?.periods ?? []).find((p2) => p2.periodId === PID);
    const sumPayable = (prep.body?.lines ?? []).reduce((n, l) => n + l.payableCents, 0);
    numbers.payroll.ownerApp = opP;
    check(`OWNER APP shows the same payroll: the paid period's total payable (${money(opP?.totalPayableCents)}) is the sum of the technicians' lines (${money(sumPayable)}); its dates are calendar days (${opP?.periodStart} → ${opP?.periodEnd})`,
      op.status === 200 && opP?.status === 'paid' && opP.totalPayableCents === sumPayable && /^\d{4}-\d{2}-\d{2}$/.test(opP.periodStart ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(opP.periodEnd ?? ''), `${op.status} ${short(opP)}`);
  }

  if (SCREENS) {
    phase('8 screens at close');
    const lisaTA = numbers.techApp?.lisa ?? {};
    const lisaComm = (lisaTA.estimatedCommissionCents ?? 0) / 100, lisaTotal = ((lisaTA.estimatedCommissionCents ?? 0) + (lisaTA.tipsCents ?? 0)) / 100;
    const te = await shoot('tech-app-earnings-lisa', 'tech-web', '/', tech.lisa, new RegExp(`Estimated \\$${lisaTotal.toFixed(2).replace('.', '\\.')}[\\s\\S]*Adjustments −\\$6\\.75`), async (page) => {
      await sleep(1500);
      const nav = page.getByRole('button', { name: /earnings/i }).or(page.getByRole('tab', { name: /earnings/i })).or(page.getByText(/^Earnings$/));
      await nav.first().click({ timeout: 8000 }).catch(() => undefined);
    });
    check(`SCREEN: Lisa's Tech App (Chromium, phone size) Earnings shows $${lisaTotal.toFixed(2)} (commission $${lisaComm.toFixed(2)} after the −$6.75 refund reversal + $20.00 tips) — the same as the commission report and payroll`, !!te.matched && !(te.pageErrors?.length), short({ t: te.err ?? (te.text ?? '').slice(0, 300), e: te.pageErrors }));
    const collectedTxt = (numbers.collectedCents / 100).toFixed(2);
    const od = await shoot('owner-app-dashboard', 'owner-web', '/', own, /Dashboard|Revenue|Today/i);
    const of = await shoot('owner-app-reports', 'owner-web', '/', own, new RegExp(`TOTAL REVENUE[^$]*\\$${Math.floor(numbers.collectedCents / 100)}`), async (page) => { await sleep(1500); await page.getByRole('button', { name: /reports/i }).first().click({ timeout: 8000 }).catch(() => undefined); });
    const pr = await shoot('pos-reports', 'pos-web', '/reports', own, /322\.00|Gross/i);
    check(`SCREEN: the Owner app dashboard renders; POS Reports render the day (net sales $304.00, no invented rating); the Owner app Reports tab shows total revenue $${collectedTxt} (rounded to dollars) (Chromium)`,
      !!od.matched && !!of.matched && !!pr.matched && /Average Rating —/i.test(pr.text ?? '') && /Net Sales \$304\.00/i.test(pr.text ?? '') && [od, of, pr].every((x) => !(x.pageErrors?.length)), short({ od: od.err ?? (od.text ?? '').slice(0, 160), of: of.matched, ofT: (of.text ?? '').slice(0, 200), pr: pr.matched, e: [od, of, pr].map((x) => x.pageErrors) }));
    info(`screenshots (${shots.length}) in ${SHOTS}: ${shots.map((x) => `${x.file ?? x.name}${x.matched === false ? ' (text not found)' : ''}${x.error ? ' ERROR ' + x.error : ''}`).join(', ')}`);
  }

  if (STOP_AFTER <= 7) throw new Error('STOP_AFTER');
} catch (e) {
  if (String(e?.message) !== 'STOP_AFTER') check('the pilot ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  const apiErrors = errs.split('\n').filter((l) => /\bERROR\b|Unhandled|TypeError|ReferenceError/.test(l));
  if (!EXTERNAL_API) { phase('9 api log'); check('the API logged no unexpected errors during the day', apiErrors.length === 0, apiErrors.slice(0, 4).join(' | ').slice(0, 600)); }
  await cleanup().catch(() => undefined);
  await sleep(500);   // let the server flush the last log lines
  const pgErrors = pgLogErrors({ dbName: DB_NAME, since: RUN_STARTED, excludePids: [OWN_PID], expected: PILOT_EXPECTED_PG });
  phase('9 postgres log');
  if (pgErrors === null) info('SKIP the PostgreSQL log is not readable here — swallowed-SQL-error check skipped');
  else check(`PostgreSQL logged no unexpected ERROR for ${DB_NAME} during the day (an error the code swallowed is a lost write or an empty read)`, pgErrors.length === 0,
    pgErrors.slice(0, 8).map((x) => `x${x.n} ${x.msg} :: ${x.stmt.slice(0, 140)}`).join(' | '));
  console.log(results.join('\n'));
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.filter((r) => /^(PASS|FAIL)/.test(r)).length} checks passed`);
  if (process.env.PILOT_OUT) writeFileSync(process.env.PILOT_OUT, JSON.stringify({ salonCode: SALON_CODE, ctx, numbers, timeline, shots, apiErrors: apiErrors.slice(0, 50) }, null, 2));
  process.exit(failed ? 1 : 0);
}
