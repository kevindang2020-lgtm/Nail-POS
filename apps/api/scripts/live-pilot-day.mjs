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
//  10  THE HANDOFF MANDATE'S GAPS (Oct 22 2026): 24 technicians (12 a page), open times / Best Matches by skill, 110
//      bookings past the first page, a booking race, catalog durations, Fair Turn skip reasons, every card failure the
//      gateway can give (decline, busy, unknown → verify, dropped connection), receipt → expense, no double-pay period,
//      the weekly 50 % check / 50 % cash paycheck with the technician's cash confirmation, an announcement for one salon,
//      and each salon's own Twilio account (in-process loopback: lib/twilio-loopback.mjs)
//  11  THE LARGE SALON (Oct 23 2026, 200-technician mandate): 200 technicians hired through the API with mixed skills,
//      17 pages of 12, search #200, exact-service filters, 1,000 more appointments, one page's day grid, openings,
//      20-desk booking race, the Tech App for #1/#25/#100/#193/#200 (+ permission attacks), a 100-technician clock-in
//      burst, a 30-guest walk-in burst and EXPLAIN ANALYZE of the large-salon reads (lib/pilot-large-salon.mjs); then
//      M5 (Oct 24 2026, lib/pilot-large-salon-m5.mjs): pagination edge totals, 500 / 1,000 / 2,000-record days, 50+
//      realtime streams, the board's memory over 17 pages and its off-screen invalidation in Chromium, #193 live on her
//      phone, reconnect, #150's schedule change, #120's break, the 200-technician payroll (400 payouts, exceptions,
//      approve selected), the Tech App at phone size, #201 / #50 deactivated / a transfer, and the two matrices; then the
//      blocked-time dataset (lib/pilot-large-salon-blocks.mjs) and the Owner App at 200 (lib/pilot-large-salon-owner.mjs)
//  12  SECURE TAP TO PAY M6-5 (Oct 23 2026): three payment phones with their own P-256 keys sign every request over real
//      HTTP — POS pairing codes (shared / personal), a normal registration + approval, three concurrent checkouts, a
//      claim race, a shift change on the shared phone, tampering (altered body, replayed nonce, stale timestamp, unsigned,
//      copied key), a mid-day revoke, unknown → verify, POS + owner history (lib/pilot-secure-tap-to-pay.mjs)
//  13  ENGLISH + VIETNAMESE POS (Oct 27 2026): the salon default Vietnamese vs a user's own choice, persistence across sign-in
//      and devices, Vietnamese names byte-identical + accent-free search at 200 technicians, a busy floor with an UNKNOWN card,
//      the Vietnamese screens, the one-screen matrix (tooling/e2e/pos-vi-one-screen.mjs), 20 switches on a live board
//      (subscriptions / memory / state), Customer Queue + Checkout UNKNOWN across switches, a reviewed Vietnamese
//      announcement, receipts in the customer's language, Super Admin stays English (lib/pilot-vietnamese.mjs)
//  14  RECOVERY FLOWS (Oct 27 2026, Remaining Production §68): a wallet top-up, a Skip-the-Line app payment, a split card and a
//      card refund each lose the processor's answer; Verify (staff / POS) or the stranded sweep settles each exactly once,
//      and every other tender is refused while one is open (lib/pilot-recovery.mjs, PILOT_SKIP=14)
//
// Run:  DATABASE_URL=postgres://…/<scratch db> PORT_PROOF=3201 node scripts/live-pilot-day.mjs   (apps/api built).
// NEVER point it at production: it creates a whole new salon (unique code per run) through the Super Admin console.
// PILOT_OUT=<file.json> writes the timeline + every number for docs/PILOT_DAY_REPORT.md.
import { spawn } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pgLogErrors } from './lib/pg-log-errors.mjs';
import { largeSalonPhase } from './lib/pilot-large-salon.mjs';
import { largeSalonM5Phase } from './lib/pilot-large-salon-m5.mjs';
import { largeSalonBlocksPhase } from './lib/pilot-large-salon-blocks.mjs';
import { largeSalonOwnerPhase } from './lib/pilot-large-salon-owner.mjs';
import { secureTapToPayPhase } from './lib/pilot-secure-tap-to-pay.mjs';
import { vietnamesePhase } from './lib/pilot-vietnamese.mjs';
import { recoveryPhase } from './lib/pilot-recovery.mjs';
import { pdfText } from '../../../packages/testing/src/pdf-text.mjs';   // 17.5: read the pay stub's text back out of the PDF

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
// PILOT_SKIP=11 skips the large-salon phase (self-contained) — for a quick re-run of phase 12 only; PILOT_SKIP=11m5 keeps
// phase 11's first part and skips its M5 continuation (lib/pilot-large-salon-m5.mjs)
const SKIP = new Set(String(process.env.PILOT_SKIP ?? '').split(',').map((x) => x.trim()).filter(Boolean));
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
let lastStepUpWindow = -1;
const nextTotp = async () => { let step = Math.max(Math.floor(Date.now() / 30000) - 1, lastStep + 1); while (step > Math.floor(Date.now() / 30000) + 1) await sleep(1000); lastStep = step; return hotp(b32d(totpSecret), step); };

// ── an HTTP session (cookie jar) ─────────────────────────────────────────────────────────────────────────────────────
const session = (label) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  // the server consumes the CURRENT 30-second window on a TOTP step-up (single use per window), so two step-ups by the
  // same account inside one window are refused by design — the proof waits for a fresh window, as a person would
  const call = async (method, path, body, extra = {}) => { if (path === '/auth/step-up' && body?.code) { while (Math.floor(Date.now() / 30000) <= lastStepUpWindow) await sleep(500); lastStepUpWindow = Math.floor(Date.now() / 30000); } return callRaw(method, path, body, extra); };
  const callRaw = (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => { keep(r); return j(r); });
  // 17.5 (Oct 27 2026): a binary GET (the pay-stub PDF) — the bytes as they came, with the response headers
  const bytes = (path) => fetch(API + path, { method: 'GET', headers: hdr() }).then(async (r) => { keep(r); return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) }; });
  return { label, jar, call, bytes, get: (p) => call('GET', p), post: (p, b, x) => call('POST', p, b ?? {}, x), patch: (p, b, x) => call('PATCH', p, b ?? {}, x), put: (p, b, x) => call('PUT', p, b ?? {}, x) };
};
/** The owner's first sign-in after Security Deep Scan C2 / C1: the Super Admin (fresh step-up, a reason) has a temporary
 *  password SENT to the owner — the response names only the channel and a masked address; the owner reads it from her
 *  inbox (the proof's mock outbox), exchanges it at /auth/temp-password-login, sets her own password (no session is minted:
 *  mustSignIn), then signs in normally. */
const readOutbox = () => { try { return readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
async function ownerFirstSignIn(sa, tenantId, salonCode, email, newPassword) {
  const su = await sa.post('/auth/step-up', { password: SA_PASSWORD, code: await nextTotp() });
  const before = readOutbox().length;
  const rp = await sa.post(`/super-admin/tenants/${tenantId}/reset-owner-password`, { reason: 'Pilot day: the owner\'s first sign-in', deliveryMethod: 'email' });
  let mail = null;
  for (let i = 0; i < 20 && !mail; i++) { mail = readOutbox().slice(before).reverse().find((m) => m.channel === 'email' && String(m.to).toLowerCase() === email.toLowerCase()) ?? null; if (!mail) await sleep(100); }
  const temp = /temporary password is: (\S+)/.exec(mail?.body ?? '')?.[1] ?? null;
  const s = session('first-sign-in');
  const tl = temp ? await s.post('/auth/temp-password-login', { emailOrPhone: email, tenantCodeOrSlug: salonCode, password: temp }) : { status: 0, body: null };
  const ch = tl.body?.changePasswordSessionId ? await s.post('/auth/change-temporary-password', { changePasswordSessionId: tl.body.changePasswordSessionId, newPassword, confirmPassword: newPassword }) : { status: 0, body: null };
  return { su, rp, mail: !!mail, temp: !!temp, tl, ch, returnedPassword: JSON.stringify(rp.body ?? {}).includes(String(temp ?? '\u0000')) || 'temporaryPassword' in (rp.body ?? {}) };
}
const tenantLogin = async (s, identifier, password, branchId) => {
  const l = await s.post('/auth/login', { portal: 'tenant', salonCode: SALON_CODE, identifier, password });
  let sel = null; if (branchId && ok2(l.status)) sel = await s.post('/auth/select-branch', { branchId });
  return { ok: ok2(l.status) && (!branchId || ok2(sel?.status)), l, sel };
};

// ── the ONE fake for Tap to Pay: a loopback CommerceHub (session mint + charge), as phase-4 runs a loopback Twilio Verify.
// Honoured only because COMMERCEHUB_BASE_URL points at it; COMMERCEHUB_TTP_ENV=sandbox. It answers like CommerceHub does.
const CH_PORT = PORT + 100; const chCalls = []; let chN = 0;
// phase 12 (M6-5): the provider's other answers for a charge, chosen per PaymentSession id — 'pending' = 200 but neither
// approved nor declined (transactionState PENDING), 'drop' = the connection is cut before any answer
const chControl = { pending: new Set(), drop: new Set() };
const chFake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch { /* */ }
    chCalls.push({ path: req.url, body: b, signed: !!req.headers['authorization'] && !!req.headers['api-key'] });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/payments-vas/v1/security/credentials') return res.end(JSON.stringify({ sessionId: `ps_${++chN}`, accessToken: `at_${chN}`, publicKey: 'pk_fake', accessTokenTimeToLive: 600 }));
    if (req.url === '/payments/v1/charges' && chControl.drop.has(b?.source?.session)) return req.socket.destroy();
    if (req.url === '/payments/v1/charges' && chControl.pending.has(b?.source?.session)) return res.end(JSON.stringify({ gatewayResponse: { transactionState: 'PENDING', transactionProcessingDetails: { transactionId: `pend_${++chN}` } }, paymentReceipt: { processorResponseDetails: { responseMessage: 'PENDING' } } }));
    if (req.url === '/payments/v1/charges') { const total = b?.amount?.total ?? 0; return res.end(JSON.stringify({ gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: `ch_${++chN}` } }, paymentReceipt: { approvedAmount: { total }, processorResponseDetails: { approvalStatus: 'APPROVED', approvalCode: 'A' + chN, responseCode: '000', responseMessage: 'APPROVED' } } })); }
    if (req.url === '/payments/v1/refunds' || req.url === '/payments/v1/cancels') return res.end(JSON.stringify({ gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: `rf_${++chN}` } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'APPROVED', responseCode: '000', responseMessage: 'APPROVED' } } }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => chFake.listen(CH_PORT, '127.0.0.1', r));
// ── the card processor fake: a loopback CardPointe gateway (the shape of scripts/cardpointe-mock-server.mjs). The Super
// Admin points the salon's gateway at it, so POS card payments, refunds and the gateway test run the REAL CardPointeClient.
const CP_PORT = PORT + 101; const cpCalls = []; let cpN = 0;
const CP_TOKENS = { decline: '9400000000000101', hostRetry: '9400000000000202', unknown: '9400000000000303', dropped: '9400000000000404', lostApproved: '9400000000000505' };
const cpUnknownOrders = new Map(); const cpDroppedOrders = new Set();
// phase 14 (§68, Oct 27 2026): 'lostApproved' = the processor APPROVES the charge and then the connection is cut (the answer
// is lost, the money moved); a refund of a retref in cpControl.loseRefundFor is made at the processor and its answer lost.
// Both are written into the processor's own record (cpRecorded, by order id), which inquireByOrderid then answers from.
const cpRecorded = new Map(); const cpAuthByRetref = new Map(); const cpControl = { loseRefundFor: new Set() };
const cpFake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let b = {}; try { b = JSON.parse(raw || '{}'); } catch { /* */ }
    const basic = String(req.headers['authorization'] || '').startsWith('Basic ');
    cpCalls.push({ method: req.method, path: req.url, body: b, basic });
    res.setHeader('content-type', 'application/json');
    if (!basic) { res.statusCode = 401; return res.end('{}'); }
    const u = req.url || ''; cpN++;
    if (req.method === 'PUT' && u.endsWith('/cardconnect/rest/auth')) {
      // phase 10 (mandate §27 card failure modes): CardSecure-style test tokens that make the gateway answer each way
      const acct = String(b.account ?? '');
      if (acct === CP_TOKENS.decline) return res.end(JSON.stringify({ respstat: 'C', retref: `CP-DECL-${cpN}`, amount: b.amount, resptext: 'Insufficient funds', respcode: '51', merchid: b.merchid }));
      if (acct === CP_TOKENS.hostRetry) return res.end(JSON.stringify({ respstat: 'B', retref: `CP-RETRY-${cpN}`, resptext: 'Host unavailable, retry', respcode: '91', merchid: b.merchid }));
      if (acct === CP_TOKENS.unknown) { cpUnknownOrders.set(String(b.orderid), b.amount); return res.end(JSON.stringify({ retref: `CP-UNK-${cpN}`, resptext: 'Pending', merchid: b.merchid })); }
      if (acct === CP_TOKENS.dropped) { cpDroppedOrders.add(String(b.orderid)); return req.socket.destroy(); }
      if (acct === CP_TOKENS.lostApproved) { cpRecorded.set(String(b.orderid), [{ respstat: 'A', retref: `CP-LOST-${cpN}`, authcode: `LA${cpN}`, amount: b.amount, resptext: 'Approval' }]); return req.socket.destroy(); }
      cpAuthByRetref.set(`CP-AUTH-${cpN}`, { order: String(b.orderid), amount: b.amount });
      return res.end(JSON.stringify({ respstat: 'A', retref: `CP-AUTH-${cpN}`, authcode: `OK${cpN}`, amount: b.amount, resptext: 'Approval', respcode: '00', token: b.account, merchid: b.merchid }));
    }
    if (req.method === 'GET' && /\/cardconnect\/rest\/inquireByOrderid\//.test(u)) {
      // the processor's own record: the "unknown" charge did go through (approved); the dropped one never arrived
      const order = decodeURIComponent(u.split('/inquireByOrderid/')[1].split('/')[0]);
      if (cpRecorded.has(order)) return res.end(JSON.stringify(cpRecorded.get(order)));
      if (cpUnknownOrders.has(order)) return res.end(JSON.stringify([{ respstat: 'A', retref: `CP-INQ-${cpN}`, authcode: `IQ${cpN}`, amount: cpUnknownOrders.get(order), resptext: 'Approval' }]));
      return res.end(JSON.stringify([{ resptext: 'Txn not found' }]));
    }
    if (req.method === 'PUT' && u.endsWith('/cardconnect/rest/refund') && cpControl.loseRefundFor.has(String(b.retref))) {
      const o = cpAuthByRetref.get(String(b.retref));
      if (o) cpRecorded.set(o.order, [{ respstat: 'A', retref: String(b.retref), amount: o.amount, resptext: 'Approval' }, { respstat: 'A', retref: `CP-RFND-${cpN}`, amount: b.amount, resptext: 'Approval' }]);
      return req.socket.destroy();
    }
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
const screenApps = { 'pos-web': PORT + 104, 'customer-display': PORT + 105, 'tech-web': PORT + 106, 'owner-web': PORT + 107, 'admin-web': PORT + 108 };   // admin-web: phase 13's Super-Admin-stays-English proof
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
    // realtime streams (SSE): piped through as they arrive (M5, Oct 24 2026 — the customer display's 3-second clear, the
    // booking board's off-screen invalidation and the Tech App's live assignment are proved on the real stream); the
    // socket closes with the page. PILOT_SCREEN_SSE=0 answers 204 (the old behaviour: the apps fall back to polling).
    if (u.startsWith('/realtime') || /\/stream(\?|$)/.test(u.split('#')[0]) || /event-stream/.test(req.headers.accept || '')) {
      if (process.env.PILOT_SCREEN_SSE === '0') { rsp.writeHead(204); return rsp.end(); }
      const ac = new AbortController(); req.on('close', () => ac.abort());
      const headers = { ...req.headers }; delete headers.host; delete headers.connection;
      fetch(API + u, { method: 'GET', headers, signal: ac.signal }).then(async (r) => {
        const out = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(k)) out[k] = v; });
        rsp.writeHead(r.status, out); rsp.flushHeaders?.();
        if (!r.body) return rsp.end();
        for await (const chunk of r.body) { if (rsp.destroyed) break; rsp.write(chunk); }
        rsp.end();
      }).catch(() => { try { if (!rsp.headersSent) rsp.writeHead(502); rsp.end(); } catch { /* the page went away */ } });
      return;
    }
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
const ensureBrowser = async () => {
  if (!browser) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1243/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fsExists(p) && fsStat(p).isFile()) || undefined, args: ['--no-sandbox'] });
    mkdirSync(SHOTS, { recursive: true });
  }
  return browser;
};
const ensureApp = async (appName) => { const port = screenApps[appName]; if (!appServers.find((x) => x.address()?.port === port)) await serveApp(appName, port); return port; };
/** A page that STAYS open (M5): `appName` at `path` as `sess`, `viewport`, optional init scripts; the caller closes it. */
const openLive = async (appName, path, sess, { viewport, init = [] } = {}) => {
  if (!SCREENS) return null;
  if (!fsExists(APPS_DIR + appName + '/dist/index.html')) return null;
  await ensureBrowser(); const port = await ensureApp(appName);
  const context = await browser.newContext({ viewport: viewport ?? (appName === 'customer-display' ? { width: 1920, height: 1080 } : { width: 1440, height: 900 }), deviceScaleFactor: 1 });
  if (sess) await context.addCookies([...sess.jar.values()].map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: `http://127.0.0.1:${port}` }; }));
  for (const sc of init) await context.addInitScript(sc);
  const page = await context.newPage(); const pageErrors = []; const requests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('request', (r) => requests.push({ t: Date.now(), url: r.url(), method: r.method() }));
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'load', timeout: 30_000 });
  const shot = async (name) => { const file = `${SHOTS}pilot-${String(shots.length + 1).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: file }).catch(() => undefined); shots.push({ name, app: appName, path, file: file.split('/').pop(), matched: true, pageErrors }); return file; };
  return { context, page, pageErrors, requests, port, shot, close: () => context.close().catch(() => undefined) };
};
/** Open `appName` at `path` as `sess` (its cookies), wait for `expect` (regex) in the page, screenshot, return the text. */
const shoot = async (name, appName, path, sess, expect, act) => {
  if (!SCREENS) return { skipped: true, text: '' };
  try {
    if (!fsExists(APPS_DIR + appName + '/dist/index.html')) return { skipped: true, text: '', err: `${appName}/dist missing` };
    await ensureBrowser();
    const port = await ensureApp(appName);
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
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, Number(process.env.PILOT_TIMEOUT_MIN || 45) * 60_000);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };   // NO PAYMENTS_SANDBOX: the salon's own gateway (the loopback CardPointe) takes the cards
for (const k of ['PAYMENTS_SANDBOX', 'CARDPOINTE_BASE_URL', 'CARDPOINTE_MERCHANT_ID', 'CARDPOINTE_USERNAME', 'CARDPOINTE_PASSWORD']) delete env[k];
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SENDGRID_API_KEY']) delete env[k];
// Security Deep Scan C2 (Oct 23 2026): a temporary password reaches ONLY the account holder now — the proof reads the mock
// senders' outbox (packages/notifications mockOutbox; development only) the way the owner reads her e-mail.
const OUTBOX = `${createRequire(import.meta.url)('node:os').tmpdir()}/pilot-outbox-${tag}.jsonl`;
env.MOCK_OUTBOX_FILE = OUTBOX;
Object.assign(env, { PAYMENT_ATTEMPT_SWEEP_EVERY_MS: process.env.PAYMENT_ATTEMPT_SWEEP_EVERY_MS || '15000' });   // phase 14 (§68): the stranded sweep ticks every 15 s here (development only)
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off', VOICE_WRITE_TOOLS_ENABLED: 'true' });
// phase 10: Twilio answered in-process by the proof's loopback preload (lib/twilio-loopback.mjs) — each salon's account / From
// is recorded, nothing reaches Twilio. Off with PILOT_TWILIO_LOOPBACK=0.
const TWILIO_LOG = process.env.PILOT_TWILIO_LOOPBACK === '0' || EXTERNAL_API ? null : `${createRequire(import.meta.url)('node:os').tmpdir()}/pilot-twilio-${tag}.jsonl`;
if (TWILIO_LOG) Object.assign(env, { TWILIO_LOOPBACK_LOG: TWILIO_LOG, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${new URL('./lib/twilio-loopback.mjs', import.meta.url).pathname}`.trim() });
// Security Deep Scan D2: the salon's gateway base URL must be https on an allow-listed processor host — the proof registers
// https://pilot-loopback.cardconnect.com and the proof-only preload (lib/processor-loopback.mjs) forwards it to the fake.
const CP_HOST = 'pilot-loopback.cardconnect.com';
if (!EXTERNAL_API) Object.assign(env, { PROCESSOR_LOOPBACK_HOST: CP_HOST, PROCESSOR_LOOPBACK_TARGET: `http://127.0.0.1:${CP_PORT}`, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --import ${new URL('./lib/processor-loopback.mjs', import.meta.url).pathname}`.trim() });
// the screens' origins (each app served on its own loopback port, same-origin with the API through its proxy) are this
// run's app origins — as app.aipowersalon.com:<port> is in production — so a credentialed realtime stream is accepted
if (!process.env.WEB_CORS_ORIGINS) env.WEB_CORS_ORIGINS = ['https://app.aipowersalon.com', ...[104, 105, 106, 107, 108].map((k) => `http://127.0.0.1:${PORT + k}`)].join(',');
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

  // the owner's first sign-in (Security Deep Scan C2 / C1): the temporary password goes to HER inbox, never to the Super Admin
  const fs1 = await ownerFirstSignIn(sa, T, SALON_CODE, OWNER_EMAIL, OWNER_PW);
  check('the Super Admin (fresh step-up + a reason) has a first-sign-in temporary password SENT to the owner — the response names the channel and a masked address, never the password',
    ok2(fs1.su.status) && ok2(fs1.rp.status) && fs1.rp.body?.delivery === 'email' && /\*\*\*/.test(String(fs1.rp.body?.sentTo ?? '')) && !fs1.returnedPassword && fs1.mail && fs1.temp,
    `step-up ${fs1.su.status} reset ${fs1.rp.status} ${short(fs1.rp.body)} inbox ${fs1.mail} password-in-response ${fs1.returnedPassword}`);
  check('the owner exchanges it at /auth/temp-password-login and sets her own password — no session is minted by the change (mustSignIn)',
    ok2(fs1.tl.status) && !!fs1.tl.body?.changePasswordSessionId && ok2(fs1.ch.status) && fs1.ch.body?.mustSignIn === true && !fs1.ch.body?.accessToken,
    `temp-login ${fs1.tl.status} ${short(fs1.tl.body?.changePasswordSessionId ? { changePasswordSessionId: '<id>' } : fs1.tl.body)} change ${fs1.ch.status} ${short(fs1.ch.body)}`);
  const own = session('owner');
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
  const staff = {}; const staffStepUp = {};
  for (const [key, role, name] of [['rec', 'RECEPTIONIST', 'Rae Desk'], ['mgr', 'MANAGER', 'Max Floor']]) {
    const em = `${key}.${tag}@pilot-day.test`;
    let inv = await own.post('/pos/access/invitations', { email: em, fullName: name, role, branchId: B, channel: 'email' });
    // w4 SQL item 5: a MANAGER invite needs step-up (403 STEP_UP_REQUIRED → the owner confirms her password → retry);
    // since Security Deep Scan §59 (2881125c, Oct 26 2026) every invitation is a step-up route — a receptionist's too
    // (the owner's step-up then stays fresh for a few minutes, so the manager invite right after may pass at once)
    let stepUp = { first: inv.status, code: inv.body?.code ?? null, su: null };
    if (inv.status === 403 && inv.body?.code === 'STEP_UP_REQUIRED') {
      const su = await own.post('/auth/step-up', { password: OWNER_PW }); stepUp.su = su.status;
      inv = await own.post('/pos/access/invitations', { email: em, fullName: name, role, branchId: B, channel: 'email' });
    }
    staffStepUp[role] = stepUp;
    const tok = inv.body?.manualAcceptToken;
    const acc = tok ? await pub.post('/public/website/invitations/accept', { token: tok, password: STAFF_PW, fullName: name }) : { status: 0, body: null };
    const s2 = session(key); const li = await tenantLogin(s2, em, STAFF_PW, B);
    staff[key] = s2;
    check(`${role}: invited by the OWNER from her salon (an invitation is a step-up route: 403 STEP_UP_REQUIRED → she confirms her password; the manager's right after rides the same fresh step-up) (e-mail not configured → delivery "${inv.body?.deliveryStatus}", the link handed over), accepted with her own password, signs in at the branch`,
      ok2(inv.status) && !!tok && ok2(acc.status) && li.ok && (stepUp.first === 403 && stepUp.code === 'STEP_UP_REQUIRED' ? ok2(stepUp.su) : (role === 'MANAGER' && staffStepUp.RECEPTIONIST?.code === 'STEP_UP_REQUIRED' && ok2(staffStepUp.RECEPTIONIST?.su))), `${stepUp ? 'step-up ' + short(stepUp) + ' ' : ''}invite ${inv.status} ${short(inv.status >= 300 ? inv.body : { d: inv.body?.deliveryStatus, n: inv.body?.deliveryNote })} accept ${acc.status} ${short(acc.status >= 300 ? acc.body : null)} login ${li.l.status} ${short(li.l.status >= 300 ? li.l.body : null)} select ${li.sel?.status}`);
  }
  // `let`: phase 13 signs the receptionist out and back in (language persistence) — phase 14 must use her NEW session
  let rec = staff.rec; const mgr = staff.mgr;
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
  const gw = await sa.post(`/super-admin/tenants/${T}/payment-gateway`, { processorType: 'cardpointe', environment: 'sandbox', baseUrl: `https://${CP_HOST}/cardconnect/rest`, merchantId: '496160873888', apiUsername: 'pilotuser', apiPassword: 'pilot-pass-' + tag, status: 'active' });
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
  // M5 (Oct 24 2026, 23-inch spec §43–§46 / §107): the Front Desk display is OPEN in Chromium across Jenny's whole checkout
  // and payment, recording every frame it renders — the 3-second privacy clear is then proved on the real screen, not by
  // the receptionist closing the session by hand
  const FRAME_RECORDER = () => {
    window.__frames = [];
    const snap = () => { const p = document.querySelector('[data-testid="right-panel"]'); window.__frames.push({ t: Date.now(), mode: p?.getAttribute('data-mode') ?? null, right: p ? p.innerText : '', page: document.body ? document.body.innerText : '' }); };
    const start = () => { snap(); new MutationObserver(snap).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-mode'] }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  };
  const liveDisplay = SCREENS ? await openLive('customer-display', `/?device=${encodeURIComponent(ctx.displayToken ?? '')}`, null, { init: [FRAME_RECORDER] }).catch((e) => { info(`live display page did not open: ${String(e?.message || e).slice(0, 160)}`); return null; }) : null;
  if (liveDisplay) await liveDisplay.page.getByTestId('display-23').waitFor({ timeout: 30_000 }).catch(() => undefined);
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
    if (liveDisplay) {
      // the display that stays open: it follows the checkout on its own stream (no reload) and shows her total
      await liveDisplay.page.waitForFunction((due) => (document.querySelector('[data-testid="right-panel"]')?.textContent ?? '').includes(due), `$${dueTxt}`, { timeout: 20_000 }).catch(() => undefined);
      const txt = (await liveDisplay.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      await liveDisplay.shot('customer-display-totals');
      scrDisplay = { matched: txt.includes(`$${dueTxt}`), text: txt, pageErrors: liveDisplay.pageErrors };
    } else scrDisplay = await shoot('customer-display-totals', 'customer-display', `/?device=${encodeURIComponent(ctx.displayToken ?? '')}`, null, new RegExp(dueTxt.replace('.', '\\.')));
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
  const jennySessionId = afterPay.body?.sessionId ?? null;
  let close = { status: 0, body: null }, cleared = null;
  if (liveDisplay) {
    // §43–§46 / §107 ON THE OPEN SCREEN: "payment complete" → exactly 3 s → the customer is destroyed (the right panel leaves
    // the completed summary) and the display RELEASES the session — nobody taps "Clear Display"
    const dp = liveDisplay.page; const right = dp.locator('[data-testid="right-panel"]');
    await dp.locator('[data-testid="right-panel"][data-mode="completed"], [data-testid="right-panel"][data-mode="receipt"]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    if ((await right.getAttribute('data-mode').catch(() => null)) === 'receipt') await right.getByRole('button', { name: 'No receipt' }).click({ timeout: 5000 }).catch(() => undefined);
    await dp.waitForFunction(() => { const f = window.__frames ?? []; const c = f.findIndex((x) => x.mode === 'completed'); return c >= 0 && f.slice(c).some((x) => x.mode && x.mode !== 'completed' && x.mode !== 'receipt'); }, null, { timeout: 15_000 }).catch(() => undefined);
    await sleep(1500);   // keep recording a moment after the clear: a late fetch must never repaint her
    const frames = await dp.evaluate(() => window.__frames ?? []).catch(() => []);
    const firstDone = frames.find((f) => f.mode === 'completed');
    const firstAfter = firstDone ? frames.find((f) => f.t >= firstDone.t && f.mode && f.mode !== 'completed' && f.mode !== 'receipt') : null;
    const holdMs = firstDone && firstAfter ? firstAfter.t - firstDone.t : null;
    const after = firstAfter ? frames.filter((f) => f.t >= firstAfter.t) : [];
    const JENNY_WORDS = ['Jenny', `$${dueTxt}`, '10.00', 'Gel Manicure', 'Nail Art'];
    const leaks = after.flatMap((f) => JENNY_WORDS.filter((w) => f.right.includes(w) || (w === 'Jenny' && f.page.includes(w))));
    cleared = await dev('GET', '/current');
    const sessRow = jennySessionId ? (await q(`select state, closed_at is not null as closed from customer_display_sessions where id::text = $1`, [String(jennySessionId)]).catch(() => []))[0] : null;
    await liveDisplay.shot('customer-display-cleared');
    numbers.displayClear = { holdMs, frames: frames.length, framesAfterClear: after.length, leaks, modeAfter: firstAfter?.mode ?? null, serverStateAfter: cleared.body?.state ?? null, session: sessRow, pageErrors: liveDisplay.pageErrors.slice(0, 3) };
    check(`DISPLAY 3-SECOND PRIVACY CLEAR (23-inch §43–§46, §107 — M5): the Front Desk display, open in Chromium across Jenny's checkout and payment, shows "payment complete" and ${holdMs ?? '—'} ms later leaves it by itself; not one of the ${after.length} frames after that shows her name, total or services; the display RELEASED the session (server: idle, session ${sessRow?.state ?? '—'}) — no "Clear Display" tap`,
      holdMs != null && holdMs >= 2700 && holdMs <= 4500 && after.length > 0 && leaks.length === 0 && cleared.body?.state === 'idle' && !JSON.stringify(cleared.body ?? {}).includes(String(dueJ)) && sessRow?.state === 'completed' && sessRow?.closed === true && !liveDisplay.pageErrors.length,
      short(numbers.displayClear));
    await liveDisplay.close();
  } else {
    // no screens: the receptionist taps "Clear Display" (the POS reads the register's display session for this ticket and closes it)
    const cds = await rec.get('/pos/customer-displays');
    const sess = (cds.body?.devices ?? cds.body?.items ?? cds.body ?? []).map?.((x) => x.session).find((x) => x && x.ticketId === TJ);
    close = sess ? await rec.post(`/pos/customer-display/sessions/${sess.sessionId}/close`, {}) : { status: 0, body: cds.body };
    await sleep(300);
    cleared = await dev('GET', '/current');
  }
  const gcRow = (await q(`select status, balance_cents::int as bal from gift_cards where tenant_id = $1 and code = $2`, [T, ctx.giftCard]).catch(() => []))[0];
  const rcpt = await rec.post(`/pos/checkout/tickets/${TJ}/receipt/sms`, {});
  check('JENNY pays by card through the salon\'s own gateway (CardPointe client → the loopback fake): approved ONCE (the retry replays it); her gift card for Olivia is ACTIVE with $50.00 only now that it is paid; the display shows the payment complete and then leaves the checkout (by itself with the screen open; the receptionist\'s "Clear Display" without screens); the SMS receipt is recorded as SIMULATED (no texting provider — nothing claimed as sent)',
    ok2(payJ.status) && payJ.body?.status === 'approved' && /^CP-AUTH-/.test(payJ.body?.processorTransactionId ?? '') && cpCalls.filter((c) => c.path.endsWith('/auth')).length === 1 && payJ2.body?.paymentId === payJ.body?.paymentId && gcRow?.status === 'active' && gcRow?.bal === 5000
      && afterPay.body?.state === 'payment_success' && (liveDisplay ? true : ok2(close.status)) && !JSON.stringify(cleared?.body ?? {}).includes(String(dueJ)) && ok2(rcpt.status) && rcpt.body?.delivery === 'simulated',
    `pay ${payJ.status} ${short(payJ.body)} replay ${payJ2.status} gc ${short(gcRow)} display after pay ${short(afterPay.body?.state)} ${liveDisplay ? 'cleared by the display itself' : `close ${close.status} ${short(close.status >= 300 || !close.status ? close.body : null)}`} then ${short(cleared?.body?.state ?? cleared?.body?.mode ?? cleared?.body)} receipt ${rcpt.status} ${short(rcpt.body)}`);

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

    // inventory: the oil sold on the phone left the shelf; the two gel manicures' polish left it at SERVICE DONE by the
    // recipe (D4, Oct 22 2026: the service.completed consumer deducts each completed line once — nobody records it by
    // hand any more). The consumer runs after the commit: wait for the two service_usage movements before reading.
    let recipeMoves = 0; for (let i = 0; i < 80; i++) { recipeMoves = Number((await q(`select count(*)::int as n from inventory_stock_movements where tenant_id = $1 and product_id = $2 and movement_type = 'service_usage' and related_type = 'ticket_line'`, [T, ctx.polishId]))[0]?.n ?? 0); if (recipeMoves >= 2) break; await new Promise((r) => setTimeout(r, 250)); }
    const used = { status: recipeMoves >= 2 ? 200 : 500, body: { serviceUsageMovements: recipeMoves } };
    const invNow = await own.get('/tenant/inventory/products');
    const onHand2 = (id) => { const r = (invNow.body?.items ?? invNow.body?.products ?? invNow.body ?? []).find?.((x) => (x.id ?? x.productId) === id); return r?.onHand ?? r?.quantityOnHand ?? r?.on_hand ?? r?.stock ?? null; };
    numbers.inventory = { before: ctx.inv0, after: { oil: onHand2(ctx.oilId), polish: onHand2(ctx.polishId) } };
    check('INVENTORY: the Cuticle Oil sold on the phone left the shelf (10 → 9); today\'s two gel manicures took 2 polish by the recipe at Service Done (6 → 4), one movement per ticket line, nothing recorded by hand',
      ok2(used.status) && numbers.inventory.after.oil === 9 && numbers.inventory.after.polish === 4, `consume ${used.status} ${short(used.status >= 300 ? used.body : used.body)} ${short(numbers.inventory)}`);

    // loyalty: 1 point per dollar paid, once per payment (the event consumer), visible on the customer's card
    // the earnings are written by the payment event consumer, AFTER each payment commits: wait until every approved
    // payment of the day has its earning row (the fifth run read the rows while the last one was still in flight)
    // D3 (Oct 22 2026): every PAID tender is judged — the partial cash part of Nina's split included — and a gift-card
    // sale earns nothing: Jenny's $50 card is excluded from her base; the earning row still records that it was judged
    const approvedPayments = Number((await q(`select count(*)::int as n from payments p join tickets t on t.id = p.ticket_id where p.tenant_id = $1 and p.status in ('approved','partial') and p.amount_cents > 0 and t.customer_id is not null`, [T]))[0]?.n ?? 0);
    let pts = []; for (let i = 0; i < 80; i++) { pts = await q(`select c.full_name as name, sum(e.points)::int as pts, count(*)::int as n from loyalty_point_earnings e join customers c on c.id = e.customer_id where e.tenant_id = $1 group by c.full_name`, [T]).catch(() => []); if (pts.reduce((a, p) => a + p.n, 0) >= approvedPayments) break; await sleep(250); }
    const jennyCust = (await q(`select customer_id from tickets where id = $1`, [TJ]))[0]?.customer_id;
    const lyl = await rec.get(`/pos/customers/${jennyCust}/loyalty`);
    numbers.loyalty = pts;
    const earnRows = await q(`select e.points::int as pts, e.amount_cents::int as amt from loyalty_point_earnings e where e.tenant_id = $1`, [T]);
    const jEarn = pts.find((p) => /Jenny/.test(p.name))?.pts ?? null;
    const jExcluded = Number((await q(`select coalesce(sum(excluded_cents),0)::int as x from loyalty_point_earnings where tenant_id = $1 and ticket_id = $2`, [T, TJ]))[0]?.x ?? 0);
    check('LOYALTY (D3): every paid tender — the partial cash part of a split included — earned 1 point per whole ELIGIBLE dollar for its customer, exactly once (the payment event consumer); Jenny\'s $50 gift-card purchase earned nothing (excluded_cents 5000); the POS customer card shows her balance NET of the refund reversal (earned − 15)',
      earnRows.length >= 4 && earnRows.every((r) => r.pts === Math.floor(r.amt / 100)) && jExcluded === 5000 && lyl.status === 200 && lyl.body?.points === (jEarn ?? 0) - 15,
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

  // ══ 10. THE HANDOFF MANDATE'S PILOT GAPS (Oct 22 2026) ════════════════════════════════════════════════════════════
  // What the pilot day above did not walk yet, on the same salon and the same API: a 24-technician board (12 a page on the
  // POS), real open times and Best Matches, a busy day past the first page, concurrent / skill / duration booking rules,
  // Fair Turn's skip reasons, every card failure the gateway can give, receipt-to-expense, the weekly 50 % check / 50 %
  // cash paycheck with the technician's cash confirmation, a platform announcement for ONE salon, and each salon's own
  // Twilio account. Each sub-step is its own check: one failure never hides the rest.
  phase('10 handoff mandate');
  numbers.mandate = {};
  const sub = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran to the end`, false, String(e?.stack || e).split('\n').slice(0, 2).join(' | ')); } };
  const step = async () => { const r = await own.post('/auth/step-up', { password: OWNER_PW }); return r.status; };
  for (const t of TECH_DEF) await own.post('/pos/time-clock/clock-in', { technicianId: t.id });   // back on the floor after the close-out above
  const TOMORROW = d(1);
  // `week` (7 days 9–7, lunch 13:00–13:30) is the schedule the pilot's own technicians got in phase 2

  // ── 10a. 24 technicians: the board, real availability by skill, a day past the first page, booking rules ─────────
  const extra = [];
  await sub('10a 24-technician board', async () => {
    for (let i = 1; i <= 21; i++) {
      const pediOnly = i > 18;   // three pedicure-only technicians: not offered manicure times
      const svcs = pediOnly ? [ctx.services.pedi] : [ctx.services.gel, ctx.services.pedi, ctx.services.addOn];
      const cr = await own.post('/pos/technicians', { firstName: pediOnly ? `Pedi${i}` : `Tech${i}`, lastName: 'Floor', email: `t${i}.${tag}@pilot-day.test`, phone: `6095${String(Number(tag) % 1000).padStart(3, '0')}${String(i).padStart(3, '0')}`, techAppEnabled: false, serviceIds: svcs });
      const id = cr.body?.technicianId ?? cr.body?.id;
      if (id) { await own.patch(`/pos/technicians/${id}/services`, { serviceIds: svcs }); await own.patch(`/pos/technicians/${id}/schedule`, { weekly: week, branchId: B }); }
      extra.push({ id, pediOnly, status: cr.status, email: `t${i}.${tag}@pilot-day.test`, acceptUrl: cr.body?.invite?.acceptUrl ?? null });   // phase 11 signs some of them in to the Tech App
    }
    const grid = await rec.get(`/pos/booking/day-grid?date=${TOMORROW}`);
    const cols = grid.body?.columns ?? [];
    check('24 TECHNICIANS: 21 more hired on the POS (3 pedicure-only); tomorrow\'s day grid has a column for each of the 24 — the POS pages them 12 at a time (2 pages, POSBookingScreen technician paging)',
      extra.every((x) => ok2(x.status) && x.id) && cols.length === 24 && Math.ceil(cols.length / 12) === 2, `created ${extra.filter((x) => x.id).length}/21 ${short(extra.find((x) => !x.id))} columns ${cols.length}`);
    const av = await rec.get(`/pos/booking/availability?date=${TOMORROW}&serviceIds=${ctx.services.gel}`);
    const slotsOf = Object.fromEntries((av.body ?? []).map((r) => [r.technicianId, r.slots.length]));
    const pedi = extra.filter((x) => x.pediOnly), gelOk = [...TECH_DEF.map((t) => t.id), ...extra.filter((x) => !x.pediOnly).map((x) => x.id)];
    const earliest = (av.body ?? []).flatMap((r) => r.slots.map((s2) => ({ t: r.technicianId, s: s2 }))).sort((a, b) => a.s.localeCompare(b.s))[0];
    numbers.mandate.availability = { gelTechsWithSlots: gelOk.filter((x) => slotsOf[x] > 0).length, pediOnlyWithSlots: pedi.filter((x) => slotsOf[x.id] > 0).length, bestMatch: earliest };
    check('OPEN TIMES / BEST MATCHES: availability for a Gel Manicure offers times ONLY to the 21 technicians who do it (the 3 pedicure-only get none); Best Matches = the earliest of those — the same API New Booking now shows',
      av.status === 200 && gelOk.every((x) => slotsOf[x] > 0) && pedi.every((x) => slotsOf[x.id] === 0) && !!earliest && gelOk.includes(earliest.t), short(numbers.mandate.availability));

    // a busy day: 110 appointments tomorrow across the 21 gel technicians (the board used to draw only the first 50)
    const gelTechs = gelOk; const hours = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00'];
    const made = [];
    for (let i = 0; i < 110; i++) {
      const r = await rec.post('/pos/booking/appointments', { customerName: `Guest ${i + 1}`, customerPhone: `+1609556${String(i).padStart(4, '0')}`, serviceIds: [ctx.services.gel], technicianId: gelTechs[i % gelTechs.length], date: TOMORROW, startTime: hours[Math.floor(i / gelTechs.length)], source: 'manual' }, { 'idempotency-key': `pilot-busy-${tag}-${i}` });
      made.push(r.status);
    }
    const p1 = await rec.get(`/pos/booking/state?date=${TOMORROW}&pageSize=100&page=1`);
    const p2 = await rec.get(`/pos/booking/state?date=${TOMORROW}&pageSize=100&page=2`);
    const ids = new Set([...(p1.body?.bookings?.items ?? []), ...(p2.body?.bookings?.items ?? [])].map((x) => x.appointmentId));
    numbers.mandate.busyDay = { created: made.filter(ok2).length, pagination: p1.body?.bookings?.pagination, distinctOnTwoPages: ids.size };
    check('A BUSY DAY: 110 appointments tomorrow are all booked; the day comes in 2 pages of up to 100 (110 distinct) — the board now follows the pages (it drew only the first 50)',
      made.every(ok2) && p1.body?.bookings?.pagination?.totalItems === 110 && p1.body?.bookings?.pagination?.totalPages === 2 && ids.size === 110, short(numbers.mandate.busyDay));

    // two front desks book the same technician at the same minute: exactly one wins, the other is APPOINTMENT_CONFLICT
    const who = pedi[0].id;
    const race = await Promise.all([0, 1].map((k) => rec.post('/pos/booking/appointments', { customerName: `Race ${k}`, serviceIds: [ctx.services.pedi], technicianId: who, date: TOMORROW, startTime: '16:00', source: 'manual' }, { 'idempotency-key': `pilot-race-${tag}-${k}` })));
    const won = race.filter((r) => ok2(r.status)), lost = race.filter((r) => r.status === 409);
    // the visit's length is the catalog's: Gel Manicure 45 + Nail Art 15 = 60 minutes → 17:00–18:00
    const dur = await rec.post('/pos/booking/appointments', { customerName: 'Dana Duration', serviceIds: [ctx.services.gel], serviceLines: [{ serviceId: ctx.services.gel }, { serviceId: ctx.services.addOn, isAddon: true, parentServiceId: ctx.services.gel }], technicianId: gelTechs[0], date: TOMORROW, startTime: '17:00', source: 'manual' }, { 'idempotency-key': `pilot-dur-${tag}` });
    const unskilled = await rec.post('/pos/booking/appointments', { customerName: 'Una Skilled', serviceIds: [ctx.services.gel], technicianId: who, date: TOMORROW, startTime: '17:00', source: 'manual' }, { 'idempotency-key': `pilot-unsk-${tag}` });
    check('BOOKING RULES: two simultaneous bookings of one technician at 4:00 PM → one booked, one 409 APPOINTMENT_CONFLICT; Gel + Nail Art runs 17:00–18:00 (60 min from the catalog); a pedicure-only technician cannot be booked for a manicure (400)',
      won.length === 1 && lost.length === 1 && lost[0].body?.code === 'APPOINTMENT_CONFLICT' && ok2(dur.status) && dur.body?.endTime?.startsWith('18:00') && dur.body?.durationMinutes === 60 && unskilled.status === 400,
      `race ${race.map((r) => r.status + ':' + (r.body?.code ?? '')).join(',')} dur ${dur.status} ${short(dur.status >= 300 ? dur.body : { s: dur.body?.startTime, e: dur.body?.endTime, m: dur.body?.durationMinutes })} unskilled ${unskilled.status} ${short(unskilled.body)}`);
  });

  // ── 10b. Fair Turn's skip reasons: on break, cannot do the service, the guest asked for someone, appointment soon ──
  await sub('10b Fair Turn edge cases', async () => {
    const walkIn = async (name, serviceIds, extraBody = {}) => { const r = await rec.post('/pos/queue/items', { customerName: name, customerPhone: `+1609557${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`, serviceIds, source: 'walk_in', ...extraBody }); return r.body?.queueItemId ?? r.body?.id; };
    const recommend = async (G) => { const r = await rec.post(`/pos/ai-queue-assignment/entries/${G}/recommend`, {}); const ft = r.body?.envelope?.fairTurn ?? r.body?.fairTurn ?? {}; return { status: ok2(r.status) ? 200 : r.status, rec: r.body?.envelope?.recommendedTechnicianId ?? r.body?.recommendedTechnicianId ?? ft.recommendedTechnicianId ?? null, why: JSON.stringify({ skips: ft.skips, ineligible: r.body?.ineligible ?? r.body?.envelope?.ineligible }) }; };
    const br = await own.post('/pos/time-clock/break-start', { technicianId: LISA, kind: 'break', reason: 'Coffee' });
    const g1 = await walkIn('Bea Break', [ctx.services.gel]);
    const r1 = await recommend(g1);
    check('FAIR TURN — ON BREAK: Lisa starts a break; for the next gel walk-in the engine does not recommend her and says why (break)', ok2(br.status) && r1.status === 200 && r1.rec && r1.rec !== LISA && /break/i.test(r1.why), `break ${br.status} ${short(br.body)} → ${nameOf(r1.rec)} ${r1.why.slice(0, 300)}`);
    const g2 = await walkIn('Ace Acrylic', [ctx.services.acrylic]);
    const r2 = await recommend(g2);
    check('FAIR TURN — CANNOT DO THE SERVICE: for an acrylic full set Mary (no acrylic) is never offered; the reason is her skills', r2.status === 200 && r2.rec !== MARY && /skill|missing/i.test(r2.why), `→ ${nameOf(r2.rec)} ${r2.why.slice(0, 300)}`);
    const g3 = await walkIn('Rita Request', [ctx.services.gel], { requestedTechnicianId: ANNA });
    const r3 = await recommend(g3);
    check('FAIR TURN — THE GUEST ASKED FOR ANNA: the engine recommends Anna, and the others are passed over for the customer\'s request', r3.status === 200 && r3.rec === ANNA && /request/i.test(r3.why), `→ ${nameOf(r3.rec)} ${r3.why.slice(0, 300)}`);
    // Mary has an appointment starting in 20 minutes: a 60-minute pedicure walk-in would run into it
    const soon = (() => { const m = localNowMin + 20; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })();
    const ap = await own.post('/pos/booking/appointments', { customerName: 'Sue Soon', serviceIds: [ctx.services.gel], technicianId: MARY, date: TODAY, startTime: soon, source: 'manual' }, { 'idempotency-key': `pilot-soon-${tag}` });
    const g4 = await walkIn('Pia Pedicure', [ctx.services.pedi]);
    const r4 = await recommend(g4);
    check(`FAIR TURN — APPOINTMENT SOON: Mary is booked at ${soon}; a pedicure walk-in now is not given to her (it would run into the appointment) and the reason says so`, ok2(ap.status) && r4.status === 200 && r4.rec !== MARY && /appointment/i.test(r4.why),
      `appt ${ap.status} ${short(ap.status >= 300 ? ap.body : null)} → ${nameOf(r4.rec)} ${r4.why.slice(0, 300)}`);
    await own.post('/pos/time-clock/break-end', { technicianId: LISA });
    for (const G of [g1, g2, g3, g4]) if (G) await rec.post(`/pos/queue/items/${G}/cancel`, { reason: 'pilot edge-case probe' }).catch(() => undefined);
  });

  // ── 10c. CARD FAILURE MODES (the salon's own CardPointe gateway, the loopback fake answering each way) ────────────
  await sub('10c card failure modes', async () => {
    const ticketFor = async (name) => {
      const r = await rec.post('/pos/queue/items', { customerName: name, customerPhone: `+1609558${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`, serviceIds: [ctx.services.gel], source: 'walk_in' });
      const G = r.body?.queueItemId ?? r.body?.id;
      await recommendAndConfirm(G, `card-${name.split(' ')[0].toLowerCase()}`);   // the front desk confirms Fair Turn's pick
      const s2 = await serve(G);
      if (!s2.ticketId) info(`ticket for ${name}: queue ${r.status} serve ${short(s2)}`);
      return s2.ticketId;
    };
    const auths = () => cpCalls.filter((c) => c.method === 'PUT' && c.path.endsWith('/auth')).length;
    const pay = (t, key, token) => rec.post(`/pos/checkout/tickets/${t}/pay/card`, { idempotencyKey: key, cardToken: token, expiry: '1230' });
    const T1 = await ticketFor('Dee Decline');
    const a0 = auths();
    const dec = await pay(T1, `pilot-dec-${tag}`, CP_TOKENS.decline);
    const dec2 = await pay(T1, `pilot-dec-${tag}`, CP_TOKENS.decline);
    const a1 = auths();
    const busy = await pay(T1, `pilot-busy-card-${tag}`, CP_TOKENS.hostRetry);
    const good = await pay(T1, `pilot-good-${tag}`, CARD.cardToken);
    const t1Rows = await q(`select status from payments where ticket_id = $1 and method = 'card' order by created_at`, [T1]);
    numbers.mandate.cardT1 = { decline: dec.body?.status, replay: dec2.body?.status, busy: [busy.status, busy.body?.code], good: good.body?.status, rows: t1Rows.map((x) => x.status) };
    check('CARD — DECLINE: the gateway declines (C) → "declined", recorded as a decline; the guest may try the same card again (a decline is never replayed — by design, checkout-card-idempotency spec) → a second real attempt, declined again',
      ok2(dec.status) && dec.body?.status === 'declined' && dec2.body?.status === 'declined' && a1 - a0 === 2, `${short(numbers.mandate.cardT1)} gateway calls ${a1 - a0}`);
    check('CARD — PROCESSOR BUSY (B): 503 CARD_PROCESSOR_UNAVAILABLE, nothing charged and recorded as FAILED, never as a decline; a good card then pays the ticket (2 declines, 1 failed, 1 approved)',
      busy.status === 503 && busy.body?.code === 'CARD_PROCESSOR_UNAVAILABLE' && good.body?.status === 'approved' && t1Rows.filter((x) => x.status === 'declined').length === 2 && t1Rows.filter((x) => x.status === 'failed').length === 1 && t1Rows.filter((x) => x.status === 'approved').length === 1, short(numbers.mandate.cardT1));

    const T2 = await ticketFor('Una Unknown');
    const unk = await pay(T2, `pilot-unk-${tag}`, CP_TOKENS.unknown);
    const unkRow = (await q(`select status from payments where ticket_id = $1 and method = 'card'`, [T2]))[0];
    const a2 = auths();
    const again = await pay(T2, `pilot-unk2-${tag}`, CARD.cardToken);
    const a3 = auths();
    const ver = await rec.post(`/pos/checkout/tickets/${T2}/pay/card/verify`, {});
    const t2 = (await q(`select t.status, (select string_agg(p.status, ',') from payments p where p.ticket_id = t.id) as pays from tickets t where t.id = $1`, [T2]))[0];
    numbers.mandate.cardT2 = { unknown: [unk.status, unk.body?.code], rowWhileUnknown: unkRow?.status, secondAttempt: [again.status, again.body?.code ?? again.body?.status], verify: [ver.status, ver.body?.status], after: t2 };
    check('CARD — UNKNOWN ANSWER: 409 PAYMENT_STATUS_UNKNOWN ("do not run the card again"), the attempt stays processing; ANOTHER card on the ticket is refused while it is open and never reaches the gateway (before Oct 22 it was charged: the guest paid twice); VERIFY asks the processor, which says approved → the ticket is paid with exactly ONE approved payment',
      unk.status === 409 && unk.body?.code === 'PAYMENT_STATUS_UNKNOWN' && unkRow?.status === 'processing' && a3 === a2 && again.status === 409 && again.body?.code === 'PAYMENT_STATUS_UNKNOWN' && ok2(ver.status) && t2?.status === 'paid' && t2?.pays === 'approved', short(numbers.mandate.cardT2));

    const T3 = await ticketFor('Dan Dropped');
    const drop = await pay(T3, `pilot-drop-${tag}`, CP_TOKENS.dropped);
    const dropRow = (await q(`select status from payments where ticket_id = $1 and method = 'card'`, [T3]))[0];
    const ver3 = await rec.post(`/pos/checkout/tickets/${T3}/pay/card/verify`, {});
    numbers.mandate.cardT3 = { dropped: [drop.status, drop.body?.code], row: dropRow?.status, verify: [ver3.status, ver3.body?.status] };
    check('CARD — CONNECTION DROPPED mid-charge: 409 PAYMENT_STATUS_UNKNOWN (it was a raw 500 before Oct 22), the attempt stays processing; Verify finds no record at the processor yet → still pending, nothing re-charged',
      drop.status === 409 && drop.body?.code === 'PAYMENT_STATUS_UNKNOWN' && dropRow?.status === 'processing' && ok2(ver3.status) && ver3.body?.status !== 'approved', short(numbers.mandate.cardT3));
  });

  // ── 10d. RECEIPT → EXPENSE (the dev OCR is the labelled mock receipt; Textract / S3 / the malware scan are external) ─
  await sub('10d receipt to expense', async () => {
    const sub1 = await sa.post(`/super-admin/ai/tenants/${T}/subscriptions`, { packageCode: 'ai_ocr_receipt_scanner', status: 'active' });
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const scan = await own.post('/ai/ocr/scan-receipt', { imageBase64: PNG, mimeType: 'image/png' });
    const sr = scan.body?.receipt ?? scan.body?.result ?? scan.body ?? {};
    const total = sr.totalCents ?? sr.total_cents ?? sr.total ?? null;
    const vendor = sr.vendor ?? sr.vendorName ?? 'Sample Beauty Supply';
    info(`receipt scan (DEV MOCK provider — no OCR key in development; production answers 503): ${scan.status} ${short(scan.body)}`);
    const body = { amountCents: Number(total) || 4490, incurredOn: TODAY, vendor, category: 'supplies', subtotalCents: 4200, taxCents: 290, lineItems: [{ description: 'Gel Polish ×2', totalCents: 2400 }, { description: 'Acetone 1 gal', totalCents: 1800 }], receiptNumber: `R-${tag}`, intent: 'submit' };
    const e1 = await own.post('/owner/finance/expenses', { ...body, idempotencyKey: `pilot-exp-${tag}` });
    const e2 = await own.post('/owner/finance/expenses', { ...body, idempotencyKey: `pilot-exp2-${tag}` });
    const exp = e1.body?.expense ?? e1.body;
    const ap = await own.post(`/owner/finance/expenses/${exp?.id}/approve`, { version: exp?.version });
    const rep = await own.get('/owner/finance/reports?period=month&branchId=all');   // the Owner App's "All branches" (it sent no branch before Oct 22 and saw only the session's)
    numbers.mandate.expense = { scan: scan.status, created: [e1.status, exp?.status, exp?.id], duplicate: [e2.status, e2.body?.code], approve: [ap.status, (ap.body?.expense ?? ap.body)?.status, ap.status >= 300 ? ap.body : null], reportHasIt: JSON.stringify(rep.body ?? {}).includes(String(body.amountCents)) };
    check(`RECEIPT → EXPENSE: the AI package switched on, the scan reads the receipt (DEV MOCK — labelled), the owner files it (${money(body.amountCents)}, submitted); the same receipt again is 409 RECEIPT_DUPLICATE; approved; the month's finance report carries it`,
      ok2(sub1.status) && ok2(scan.status) && ok2(e1.status) && e2.status === 409 && /DUPLICATE/.test(e2.body?.code ?? '') && ok2(ap.status) && numbers.mandate.expense.reportHasIt, short(numbers.mandate.expense));
    // the POS document pipeline (upload → scan → extract → review): with no object store / malware scanner / Textract it is
    // HONESTLY quarantined — never "extracted"; and the OCR settings save now persists (it answered without saving)
    const bytes = [...Buffer.from(PNG, 'base64')];
    const up = await own.post('/pos/ai-ocr-receipt/upload', { filename: 'receipt.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes, headerBytes: bytes.slice(0, 16) });
    const putS = await own.put('/pos/ai-ocr-receipt/settings', { level: 'tenant', enabled: true, config: { highAmountCents: 30000 } });
    const getS = await own.get('/pos/ai-ocr-receipt/settings');
    numbers.mandate.ocrPipeline = { upload: [up.status, up.body?.pipelineState ?? up.body?.code], settings: [putS.status, getS.body?.config?.highAmountCents] };
    check('RECEIPT PIPELINE without its external services: the upload is accepted and QUARANTINED (no malware scanner / object store / Textract — BLOCKED_EXTERNAL), never shown as extracted; the OCR settings save persists (high-amount 300.00 read back)',
      ok2(up.status) && /quarantin|manual|unscanned/i.test(String(up.body?.pipelineState ?? '')) && ok2(putS.status) && getS.body?.config?.highAmountCents === 30000, short(numbers.mandate.ocrPipeline));
    // ── Receipt / Expense / OCR close-out (Oct 27 2026): what the mandate's INTERNAL rows added, through the API ──
    // §12 / §25 / §17: the upload names its channel and answers the quality verdict (a 1×1 PNG is "low resolution" — advice,
    // never a rejection); page 2 joins the SAME document (quarantined documents may still collect their pages)
    const up2 = await own.post('/pos/ai-ocr-receipt/upload', { filename: 'page1.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes, headerBytes: bytes.slice(0, 16), source: 'owner_app_upload', deferExtraction: true });
    const page2 = await own.post(`/pos/ai-ocr-receipt/documents/${up2.body?.documentId}/pages`, { filename: 'page2.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes, headerBytes: bytes.slice(0, 16) });
    const det = await own.get(`/pos/ai-ocr-receipt/documents/${up2.body?.documentId}`);
    numbers.mandate.ocrClose = { upload: [up2.status, up2.body?.quality, up2.body?.pageCount], page2: [page2.status, page2.body?.pageCount], detail: [det.status, det.body?.pageCount, det.body?.sourceChannel, det.body?.qualityFlags] };
    check('RECEIPT CLOSE-OUT — multi-page + quality (§12 / §17 / §18 / §25): the upload carries its channel (owner_app_upload) and the server\'s quality verdict (a 1 px image → low_resolution, difficult — accepted all the same); page 2 is appended under the SAME document (pageCount 2, one document id, never a second expense)',
      ok2(up2.status) && up2.body?.quality?.difficult === true && (up2.body?.quality?.flags ?? []).includes('low_resolution') && ok2(page2.status) && page2.body?.pageCount === 2 && det.body?.pageCount === 2 && det.body?.sourceChannel === 'owner_app_upload', short(numbers.mandate.ocrClose));
    // §177 / §83 / §142 / §62: notification preferences and an auto-approval rule save and read back; the suggestion for a
    // receipt that was never read is honestly UNMATCHED; the payment match without a transaction feed is honestly UNMATCHED
    const s0 = await own.get('/owner/finance/expense-settings');
    const s1 = await own.put('/owner/finance/expense-settings', { notifyMonthlySummary: false, autoApprovalRules: [{ vendor: 'PSE&G Electric #4102', maxCents: 50000, categoryKey: 'utilities' }], version: s0.body?.version });
    const sug = await own.get(`/owner/finance/receipts/${up2.body?.documentId}/suggested-expense`);
    const pm = await own.post(`/owner/finance/expenses/${exp?.id}/payment-match`, {});
    const pl = await own.post(`/owner/finance/expenses/${exp?.id}/payment-link`, { decision: 'confirm', paymentRef: 'stmt 10/27 ••4242' });
    const s2 = await own.put('/owner/finance/expense-settings', { autoApprovalRules: [], notifyMonthlySummary: true, version: s1.body?.version });
    numbers.mandate.financeClose = { prefs: [s1.status, s1.body?.notifyMonthlySummary, s1.body?.notifyNeedsReview], rules: s1.body?.autoApprovalRules, suggestion: [sug.status, sug.body?.verdict], paymentMatch: [pm.status, pm.body?.verdict, pm.body?.reason], paymentLink: [pl.status, (pl.body?.expense ?? pl.body)?.paymentMatchStatus], restore: s2.status };
    check('FINANCE CLOSE-OUT — preferences, rules, matching (§177 / §83 / §142 / §62 / §63): the monthly summary switches off (the others stay on); the auto-approval rule reads back normalised (pse and g electric, 500.00, utilities); the unread receipt\'s suggested expense is UNMATCHED (nothing invented); the payment match without a transaction feed is UNMATCHED and says why; a person links a statement reference → matched',
      ok2(s1.status) && s1.body?.notifyMonthlySummary === false && s1.body?.notifyNeedsReview === true && s1.body?.autoApprovalRules?.[0]?.vendorNorm === 'pse and g electric' && s1.body?.autoApprovalRules?.[0]?.maxCents === 50000
      && ok2(sug.status) && sug.body?.verdict === 'unmatched' && ok2(pm.status) && pm.body?.verdict === 'unmatched' && /no transaction feed/.test(String(pm.body?.reason)) && ok2(pl.status) && (pl.body?.expense ?? pl.body)?.paymentMatchStatus === 'matched' && ok2(s2.status), short(numbers.mandate.financeClose));
  });

  // ── 10e. THE WEEKLY PAYCHECK: 50 % check / 50 % cash, manager submits, owner approves, check + cash, tech confirms ──
  await sub('10e weekly paycheck 50/50', async () => {
    const dupe = await own.post('/pos/payroll/periods', { label: `Pilot dupe ${tag}`, periodStart: TODAY, periodEnd: TODAY });
    check('PAYROLL — NO DOUBLE PAY: a second pay period over today (already paid above) is refused, 409 PAYROLL_PERIOD_OVERLAP — before Oct 22 it was created and paid the same tickets again',
      dupe.status === 409 && dupe.body?.code === 'PAYROLL_PERIOD_OVERLAP', `${dupe.status} ${short(dupe.body)}`);
    const P3 = await own.post('/pos/payroll/periods', { label: `Pilot paycheck week ${tag}`, periodStart: d(9), periodEnd: d(15) });
    const PID3 = P3.body?.id;
    // the week's money: an approved weekly bonus per technician (off-POS money enters payroll only as a ledger adjustment)
    const BONUS = { [LISA]: 20000, [MARY]: 16000, [ANNA]: 12000 };
    const adj = []; for (const [tid, cents] of Object.entries(BONUS)) adj.push(await own.post(`/pos/payroll/periods/${PID3}/adjustments`, { technicianId: tid, category: 'bonus', amountCents: cents, reasonCode: 'performance_bonus', reason: 'Pilot week: busy-day bonus', idempotencyKey: `pilot-bonus-${tag}-${tid}` }));
    await step();
    // Lisa's $200.00 is a LARGE adjustment (≥ $200, LARGE_ADJUSTMENT_CENTS): it waits for the owner's decision; the others apply at once
    const pendingAdj = ((await own.get('/pos/payroll/adjustments?status=pending')).body ?? []).filter((x) => x.periodId === PID3);
    const dec = []; for (const a of pendingAdj) dec.push(await own.post(`/pos/payroll/adjustments/${a.id}/decide`, { decision: 'approve' }));
    info(`week adjustments: created ${adj.map((a) => `${a.status}:${a.body?.status ?? short(a.body)}`).join(', ')}; pending decided ${dec.map((x) => x.status).join(',') || 'none'}`);
    let wk = await mgr.post(`/pos/payroll/paychecks/periods/${PID3}/calculate`, {});
    const totals0 = wk.body?.totals ?? {};
    const plans = (wk.body?.statements ?? []).map((s2) => ({ tech: nameOf(s2.technicianId), payable: s2.approvedPayableCents, plan: (s2.plan?.instructions ?? []).map((i) => `${i.method}:${i.amountCents}`) }));
    numbers.mandate.paycheck = { period: PID3, plans, totals: totals0 };
    check('PAYCHECK CALCULATE: three statements (each technician\'s approved bonus); the default payout plan splits every one 50 % check / 50 % cash (to the cent)',
      ok2(P3.status) && adj.every((a) => ok2(a.status)) && dec.every((x) => ok2(x.status)) && ok2(wk.status) && plans.length === 3 && plans.every((p) => p.plan.length === 2 && p.plan.some((x) => x.startsWith('check:')) && p.plan.some((x) => x.startsWith('cash:'))) && totals0.checkCents + totals0.cashCents === totals0.payableCents && Math.abs(totals0.checkCents - totals0.cashCents) <= 3,
      `period ${P3.status} adj ${adj.map((a) => a.status).join(',')} decide ${dec.map((x) => x.status).join(',')} calc ${wk.status} ${short(wk.status >= 300 ? wk.body : { plans, totals: totals0 })}`);
    await step();
    const early = await own.post(`/pos/payroll/paychecks/periods/${PID3}/approve`, { expectedVersion: wk.body?.period?.version });   // before the manager submits
    const subm = await mgr.post(`/pos/payroll/paychecks/periods/${PID3}/submit`, { expectedVersion: wk.body?.period?.version });
    const appr = await own.post(`/pos/payroll/paychecks/periods/${PID3}/approve`, { expectedVersion: subm.body?.period?.version, calculationHash: subm.body?.period?.previewHash ?? wk.body?.period?.previewHash });
    wk = await own.get(`/pos/payroll/paychecks/periods/${PID3}`);
    const payouts = (wk.body?.statements ?? []).flatMap((s2) => (s2.payouts ?? []).map((x) => ({ ...x, tech: s2.technicianId })));
    check('MANAGER SUBMITS → OWNER APPROVES: before the manager submits, the owner\'s approve is refused (409 PAYROLL_PERIOD_NOT_READY — an unsubmitted week used to be finalized); the manager submits; the owner approves with a fresh step-up; six payouts exist (a check and a cash for each)',
      ok2(subm.status) && early.status === 409 && early.body?.code === 'PAYROLL_PERIOD_NOT_READY' && ok2(appr.status) && payouts.length === 6, `submit ${subm.status} ${short(subm.status >= 300 ? subm.body : subm.body?.period?.status)} early ${early.status} ${short(early.body?.code)} approve ${appr.status} ${short(appr.status >= 300 ? appr.body : appr.body?.period?.status)} payouts ${payouts.length}`);
    // checks: numbered and issued; a check number can be used once
    await step();
    const checks = payouts.filter((x) => x.method === 'check'), cash = payouts.filter((x) => x.method === 'cash');
    const issued = []; for (const [i, c] of checks.entries()) issued.push(await own.post(`/pos/payroll/paychecks/payouts/${c.id}/check/issue`, { checkNumber: `7${tag.slice(-3)}${i}` }));
    const reuse = checks[1] ? await own.post(`/pos/payroll/paychecks/payouts/${checks[1].id}/check/void`, { reason: 'printer jam', replacementCheckNumber: `7${tag.slice(-3)}0` }) : { status: 0 };
    // cash: prepared from the safe (step-up), handed over, and CONFIRMED by the technician — close-out (Oct 27 2026, §11.5):
    // one with the QR handoff code the owner's screen showed (the Tech App presents it; a wrong code is refused first),
    // one with the technician's PIN + signature on the owner's device, one by the owner + technician dual confirmation
    // (fresh step-up + the PIN); the plain Tech App confirmation then replays as the same confirmation
    const cashSteps = [];
    for (const [i, c] of cash.entries()) {
      const pr = await own.post(`/pos/payroll/paychecks/payouts/${c.id}/cash/prepare`, { cashSource: 'safe' });
      const ho = await own.post(`/pos/payroll/paychecks/payouts/${c.id}/cash/handoff`, {});
      const who = TECH_DEF.find((t) => t.id === c.tech);
      let ack, how, wrong = null;
      if (i === 0) {
        const tok = await own.post(`/pos/payroll/paychecks/payouts/${c.id}/cash/handoff-token`, {});
        wrong = await tech[who.key].post(`/tech/payroll/cash-payouts/${c.id}/acknowledge`, { handoffCode: 'ZZZZZZZZ' });
        ack = await tech[who.key].post(`/tech/payroll/cash-payouts/${c.id}/acknowledge`, { handoffCode: tok.body?.handoffCode ?? '' }); how = `qr_handoff(token ${tok.status})`;
      } else if (i === 1) { ack = await own.post(`/pos/payroll/paychecks/payouts/${c.id}/cash/acknowledge-signature`, { pin: who.pin, signature: 'M 10 60 L 40 20 L 80 70 L 120 30 L 160 60' }); how = 'signature'; }
      else { await step(); ack = await own.post(`/pos/payroll/paychecks/payouts/${c.id}/cash/acknowledge-dual`, { pin: who.pin }); how = 'manager_dual'; }
      const ack2 = await tech[who.key].post(`/tech/payroll/cash-payouts/${c.id}/acknowledge`, {});
      cashSteps.push({ tech: who.first, prepare: pr.status, handoff: ho.status, how, wrong: wrong ? [wrong.status, wrong.body?.code] : null, ack: ack.status, method: ack.body?.cashAckMethod ?? null, replay: ack2.status, replayMethod: ack2.body?.cashAckMethod ?? null, err: [pr, ho, ack].find((r) => !ok2(r.status))?.body });
    }
    const otherTech = TECH_DEF.find((t) => t.id !== cash[0]?.tech);
    const notMine = cash[0] ? await tech[otherTech.key].post(`/tech/payroll/cash-payouts/${cash[0].id}/acknowledge`, {}) : { status: 0 };
    wk = await own.get(`/pos/payroll/paychecks/periods/${PID3}`);
    const tt = wk.body?.totals ?? {};
    numbers.mandate.paycheck.after = { issued: issued.map((r) => r.status), reuse: [reuse.status, reuse.body?.code], cashSteps, notMine: notMine.status, totals: tt };
    const methods = cashSteps.map((x) => x.method);
    check('CHECK + CASH: each check is numbered and issued; reusing a check number is refused (CHECK_NUMBER_IN_USE); each cash half is prepared from the safe, handed over and CONFIRMED three ways — the QR handoff code in the Tech App (a wrong code → 401 HANDOFF_TOKEN_INVALID), the technician\'s PIN + signature on the owner\'s device, the owner + technician dual confirmation; a plain repeat replays the same confirmation; another technician cannot confirm it — refused',
      issued.every((r) => ok2(r.status)) && reuse.status === 409 && cashSteps.every((x) => ok2(x.prepare) && ok2(x.handoff) && ok2(x.ack) && ok2(x.replay) && x.replayMethod === x.method) && methods.join() === 'qr_handoff,signature,manager_dual'
        && cashSteps[0].wrong?.[0] === 401 && cashSteps[0].wrong?.[1] === 'HANDOFF_TOKEN_INVALID' && [403, 404].includes(notMine.status), short(numbers.mandate.paycheck.after));
    check(`PAID / UNPAID: after the cash is confirmed the week shows the cash halves PAID (${money(tt.paidCents)}) and the issued, not yet cleared checks UNPAID (${money(tt.unpaidCents)}); paid + unpaid = payable (${money(tt.payableCents)})`,
      tt.paidCents === totals0.cashCents && tt.unpaidCents === totals0.checkCents && tt.paidCents + tt.unpaidCents === tt.payableCents, short(tt));
    // 17.5 (Oct 27 2026) THE PAY STUB: the first technician downloads her approved week's stub from the Tech App (in
    // Vietnamese), the owner downloads the same statement's stub from the POS (in English); the PDF's own text carries
    // the statement number and the stored totals (gross, payable, paid, still to pay); another technician gets 404; both
    // downloads are audited; the response is an attachment that is never cached
    const st0 = (wk.body?.statements ?? [])[0] ?? null;
    const stubTech = st0 ? TECH_DEF.find((t) => t.id === st0.technicianId) : null;
    const otherStubTech = TECH_DEF.find((t) => t.id !== st0?.technicianId);
    const usd = (c) => (Number(c) < 0 ? '−' : '') + '$' + (Math.abs(Number(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const viStub = st0 && stubTech ? await tech[stubTech.key].bytes(`/tech/payroll/statements/${st0.id}/pay-stub.pdf?lang=vi`) : { status: 0, headers: new Headers(), buf: Buffer.alloc(0) };
    const enStub = st0 ? await own.bytes(`/pos/payroll/paychecks/statements/${st0.id}/pay-stub.pdf?lang=en`) : { status: 0, headers: new Headers(), buf: Buffer.alloc(0) };
    const notHers = st0 ? await tech[otherStubTech.key].bytes(`/tech/payroll/statements/${st0.id}/pay-stub.pdf`) : { status: 0, headers: new Headers(), buf: Buffer.alloc(0) };
    const viText = viStub.status === 200 ? pdfText(viStub.buf) : '';
    const enText = enStub.status === 200 ? pdfText(enStub.buf) : '';
    const want = st0 ? { number: st0.statementNumber, gross: usd(st0.grossEarningsCents), payable: usd(st0.approvedPayableCents), paid: usd(st0.paidCents), unpaid: usd(st0.unpaidCents) } : {};
    const enHas = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, enText.includes(v)]));
    const stubAudits = st0 ? (await q(`select count(*)::int n from audit_events where tenant_id = $1 and module = 'payroll' and action = 'pay_stub.downloaded' and resource_id = $2`, [T, st0.id]))[0].n : -1;
    numbers.mandate.paycheck.payStub = { statement: want, tech: [viStub.status, viStub.headers.get('content-type'), viStub.buf.length], pos: [enStub.status, enStub.buf.length], enHas,
      viHas: { title: viText.includes('PHIẾU LƯƠNG'), technician: viText.includes('Thợ'), number: viText.includes(want.number ?? '\u0000') },
      disposition: enStub.headers.get('content-disposition'), cache: enStub.headers.get('cache-control'), otherTechnician: notHers.status, audits: stubAudits };
    check(`PAY STUB (17.5): ${stubTech?.first ?? 'the technician'} downloads her approved week's stub from the Tech App (Vietnamese — "PHIẾU LƯƠNG", "Thợ", ${want.number}); the owner downloads it from the POS (English) and its text carries the stored totals — gross ${want.gross}, payable ${want.payable}, paid ${want.paid}, still to pay ${want.unpaid}; an attachment, never cached; another technician → 404; both downloads audited`,
      viStub.status === 200 && /application\/pdf/.test(viStub.headers.get('content-type') ?? '') && viStub.buf.subarray(0, 5).toString() === '%PDF-' && numbers.mandate.paycheck.payStub.viHas.title && numbers.mandate.paycheck.payStub.viHas.technician && numbers.mandate.paycheck.payStub.viHas.number
        && enStub.status === 200 && Object.values(enHas).every(Boolean) && /^attachment;/.test(enStub.headers.get('content-disposition') ?? '') && /no-store/.test(enStub.headers.get('cache-control') ?? '')
        && notHers.status === 404 && stubAudits >= 2, short(numbers.mandate.paycheck.payStub));
  });

  // ── 10e2. PAYCHECK CLOSE-OUT (Oct 27 2026): the preparation report, the manager's "ready for review" push, the
  //         branch-scoped manager refusal, a draft period canceled ─────────────────────────────────────────────────────
  await sub('10e2 paycheck close-out', async () => {
    const PID3 = numbers.mandate.paycheck?.period;
    // §12.4 the preparation report of the approved week: every check (the replacement, never the voided one) and every cash
    // envelope by technician; the totals reconcile (planned + unplanned = payable; paid + unpaid = payable)
    const prep = await own.get(`/pos/payroll/paychecks/periods/${PID3}/preparation`);
    const pb = prep.body ?? {};
    const recPrep = await rec.get(`/pos/payroll/paychecks/periods/${PID3}/preparation`);
    numbers.mandate.paycheck.preparation = { status: prep.status, technicians: pb.technicians, checks: pb.checks && { count: pb.checks.count, amount: pb.checks.amountCents, toDeliver: pb.checks.toDeliver }, cash: pb.cash && { count: pb.cash.count, amount: pb.cash.amountCents, acknowledged: pb.cash.acknowledged, bySource: pb.cash.bySource }, totals: pb.totals, receptionist: recPrep.status };
    check(`PREPARATION REPORT (§12.4): the approved week's check run (${pb.checks?.count} checks, ${money(pb.checks?.amountCents)}, ${pb.checks?.toDeliver} to deliver — the voided check is not a line, its replacement is) and cash envelopes (${pb.cash?.count}, ${money(pb.cash?.amountCents)}, all from the safe, ${pb.cash?.acknowledged} confirmed); planned + unplanned = payable and paid + unpaid = payable (${money(pb.totals?.payableCents)}); a receptionist is refused`,
      prep.status === 200 && pb.technicians === 3 && pb.checks?.count === 3 && pb.checks?.toDeliver === 3 && pb.checks?.lines?.every((l) => l.checkStatus !== 'voided') && pb.cash?.count === 3 && pb.cash?.acknowledged === 3 && pb.cash?.bySource?.safe?.count === 3
        && pb.totals?.reconciles === true && pb.totals?.unplannedCents === 0 && pb.totals?.paidCents === pb.cash?.amountCents && pb.totals?.unpaidCents === pb.checks?.amountCents && [403].includes(recPrep.status),
      `${prep.status} ${short(prep.status >= 300 ? prep.body : numbers.mandate.paycheck.preparation)} receptionist ${recPrep.status}`);
    // §17.7 the manager's push: the manager's device registers for push; the owner turns automatic preparation on; "Open last
    // period" (the worker's own call) opens + calculates the last completed period and tells every active manager —
    // a push with the dates and the technician count, never an amount. The last completed month (or week) must be free of
    // the pilot's own periods: if it is not (the pilot runs on the 1st–2nd of a month / a Monday), the overlap refusal is itself the proof.
    const me = await mgr.get('/auth/me'); const MGR_USER = me.body?.userId ?? me.body?.user?.id ?? me.body?.id ?? null;
    const pushReg = await mgr.post('/push/register', { platform: 'web', token: `pilot-mgr-push-${tag}-${randomUUID().slice(0, 8)}` });
    await step();
    const sch = await own.post('/pos/payroll/paychecks/schedule', { frequency: 'monthly', autoPrepare: true });
    let opened = await mgr.post('/pos/payroll/paychecks/open-week', {});
    let freq = 'monthly';
    if (opened.status === 409 && opened.body?.code === 'PAYROLL_PERIOD_OVERLAP') { await step(); await own.post('/pos/payroll/paychecks/schedule', { frequency: 'weekly' }); freq = 'weekly'; opened = await mgr.post('/pos/payroll/paychecks/open-week', {}); }
    const ob = opened.body ?? {};
    const pushes = MGR_USER && ob.periodId ? (await q(`select count(*)::int n from notification_delivery_logs where tenant_id = $1 and user_id = $2 and channel = 'push' and template = 'payroll_ready_for_review' and status = 'sent'`, [T, MGR_USER]))[0].n : -1;
    const calcAudit = ob.periodId ? (await q(`select count(*)::int n from audit_events where tenant_id = $1 and module = 'payroll' and action = 'period.calculated' and resource_id = $2`, [T, ob.periodId]))[0].n : -1;
    const reviewEvt = ob.periodId ? (await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'payroll.manager_review_started' and payload_json->>'periodId' = $2`, [T, ob.periodId]))[0].n : -1;
    const again = ob.periodId ? await mgr.post('/pos/payroll/paychecks/open-week', {}) : { status: 0, body: null };
    numbers.mandate.paycheck.readyPush = { register: pushReg.status, schedule: sch.status, frequency: freq, open: [opened.status, ob.created, ob.periodStart, ob.periodEnd, ob.frequency], pushes, calcAudit, reviewEvt, again: [again.status, again.body?.created] };
    if (opened.status === 409 && opened.body?.code === 'PAYROLL_PERIOD_OVERLAP') info(`NOT_TESTED manager "ready for review" push: the last completed ${freq} period overlaps the pilot's own paid week (${short(opened.body?.details ?? opened.body)}) — the overlap refusal is the deep-scan rule, not a defect`);
    else check(`MANAGER "READY FOR REVIEW" (§17.7 / §3.3): the owner sets a ${freq} schedule with automatic preparation; "Open last period" opens ${ob.periodStart} – ${ob.periodEnd} (${ob.frequency}) and calculates it; the manager's registered device is pushed "Payroll is ready for review" (${pushes} delivery, no amount); the calculation is audited (period.calculated) and payroll.manager_review_started went through the outbox; opening again is the same period, no second push`,
      ok2(pushReg.status) && ok2(sch.status) && ok2(opened.status) && ob.created === true && ob.frequency === freq && pushes === 1 && calcAudit === 1 && reviewEvt === 1 && ok2(again.status) && again.body?.created === false && again.body?.periodId === ob.periodId, short(numbers.mandate.paycheck.readyPush));
    // §14 / §20.3 a BRANCH-confined manager: the platform's BRANCH_MANAGER template (manager rights in ONE branch) assigned to a
    // second manager — she may review her branch's statements and change a split there, but the salon-wide steps (submit /
    // calculate / cancel) are refused
    const roles = await own.get('/pos/access/roles');
    const role = { status: roles.status, body: (roles.body ?? []).find((r) => r.key === 'BRANCH_MANAGER') ?? null };
    const templateKey = role.body?.key ?? null;
    const bmEmail = `bm.${tag}@pilot-day.test`;
    await step();
    const inv = await own.post('/pos/access/invitations', { email: bmEmail, fullName: 'Bea Branch', role: 'MANAGER', branchId: B, channel: 'email' });
    const acc = inv.body?.manualAcceptToken ? await pub.post('/public/website/invitations/accept', { token: inv.body.manualAcceptToken, password: STAFF_PW, fullName: 'Bea Branch' }) : { status: 0, body: null };
    const bmUser = (await q(`select id from users where tenant_id = $1 and email = $2`, [T, bmEmail]))[0]?.id ?? null;
    await step();
    const assign = bmUser && templateKey ? await own.put(`/pos/access/members/${bmUser}/role`, { templateKey, reason: 'Pilot: branch-confined manager' }) : { status: 0, body: null };
    const bm = session('branch-manager'); const bl = await tenantLogin(bm, bmEmail, STAFF_PW, B);
    const P4 = await own.post('/pos/payroll/periods', { label: `Pilot cancel week ${tag}`, periodStart: d(23), periodEnd: d(29) });
    const PID4 = P4.body?.id;
    const calcMgr = await mgr.post(`/pos/payroll/paychecks/periods/${PID4}/calculate`, {});
    const bmWeek = await bm.get(`/pos/payroll/paychecks/periods/${PID4}`);
    const bmSubmit = await bm.post(`/pos/payroll/paychecks/periods/${PID4}/submit`, { expectedVersion: bmWeek.body?.period?.version ?? null });
    const bmCalc = await bm.post(`/pos/payroll/paychecks/periods/${PID4}/calculate`, {});
    const bmStep = await bm.post('/auth/step-up', { password: STAFF_PW });
    const bmCancel = await bm.post(`/pos/payroll/paychecks/periods/${PID4}/cancel`, { reason: 'not mine to cancel' });
    numbers.mandate.paycheck.branchManager = { role: [role.status, templateKey], invite: inv.status, accept: acc.status, assign: assign.status, login: bl?.ok, week: [bmWeek.status, bmWeek.body?.period?.branchScope ?? null, (bmWeek.body?.statements ?? []).length], submit: [bmSubmit.status, bmSubmit.body?.code, bmSubmit.body?.details?.reason], calculate: [bmCalc.status, bmCalc.body?.code], stepUp: bmStep.status, cancel: [bmCancel.status, bmCancel.body?.code] };
    check('BRANCH-SCOPED MANAGER (§14 / §16.6 / §20.3): the BRANCH_MANAGER template (manager rights in one branch) is assigned to a second manager; she sees the period scoped to her branch (branchScope set) but her SUBMIT, CALCULATE and CANCEL are refused — 403 PERMISSION_DENIED reason branch_scoped — the salon\'s payroll is submitted by a salon-wide manager or the owner',
      ok2(role.status) && !!templateKey && ok2(inv.status) && ok2(acc.status) && ok2(assign.status) && bl?.ok && ok2(P4.status) && ok2(calcMgr.status) && bmWeek.status === 200 && bmWeek.body?.period?.branchScope === B
        && bmSubmit.status === 403 && bmSubmit.body?.code === 'PERMISSION_DENIED' && bmSubmit.body?.details?.reason === 'branch_scoped' && bmCalc.status === 403 && bmCancel.status === 403 && bmCancel.body?.code === 'PERMISSION_DENIED',
      short(numbers.mandate.paycheck.branchManager));
    // §3.4 the salon-wide manager cancels the week opened by mistake (step-up, a reason): its draft statements are voided, the
    // period is CANCELED, and the same days can be used again (a canceled period holds no days)
    const mgrStep = await mgr.post('/auth/step-up', { password: STAFF_PW });
    const noReason = await mgr.post(`/pos/payroll/paychecks/periods/${PID4}/cancel`, { reason: '' });
    const canceled = await mgr.post(`/pos/payroll/paychecks/periods/${PID4}/cancel`, { reason: 'Opened by mistake — the week is paid through the regular run', expectedVersion: calcMgr.body?.period?.version ?? null });
    const voided = PID4 ? (await q(`select count(*)::int n, count(*) filter (where status = 'voided')::int v from payroll_statements where tenant_id = $1 and period_id = $2`, [T, PID4]))[0] : { n: -1, v: -1 };
    const cancelEvt = PID4 ? (await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'payroll.period_canceled' and payload_json->>'periodId' = $2`, [T, PID4]))[0].n : -1;
    const reuse = await own.post('/pos/payroll/periods', { label: `Pilot cancel week again ${tag}`, periodStart: d(23), periodEnd: d(29) });
    const calcAfter = await mgr.post(`/pos/payroll/paychecks/periods/${PID4}/calculate`, {});
    if (reuse.body?.id) await mgr.post(`/pos/payroll/paychecks/periods/${reuse.body.id}/cancel`, { reason: 'pilot cleanup' });
    numbers.mandate.paycheck.cancel = { stepUp: mgrStep.status, noReason: [noReason.status, noReason.body?.code], canceled: [canceled.status, canceled.body?.period?.status, canceled.body?.period?.cancelReason], statements: voided, event: cancelEvt, reuse: reuse.status, calcAfter: [calcAfter.status, calcAfter.body?.code] };
    // the cancel week lies ahead (d(23)…d(29)) and has no earnings, so the calculation writes no statement to void: "every statement voided" holds
    // here vacuously (n = 0 is reported); voiding statements that exist is proved by payroll-paycheck-closeout.pgtest (harness fix, Oct 27 final pass)
    check('CANCELED PERIOD (§3.4): without a reason → 400; with the manager\'s fresh step-up and a reason the draft week is CANCELED — every draft statement it has is voided (kept; this future week has ' + voided.n + '), payroll.period_canceled through the outbox; it holds no days any more (the same week is created again, no PAYROLL_PERIOD_OVERLAP) and cannot be calculated (409 PAYROLL_PERIOD_LOCKED)',
      ok2(mgrStep.status) && noReason.status === 400 && ok2(canceled.status) && canceled.body?.period?.status === 'canceled' && voided.v === voided.n && cancelEvt === 1 && ok2(reuse.status) && calcAfter.status === 409 && calcAfter.body?.code === 'PAYROLL_PERIOD_LOCKED',
      short(numbers.mandate.paycheck.cancel));
    await step(); await own.post('/pos/payroll/paychecks/schedule', { frequency: 'weekly', autoPrepare: false });
  });

  // ── 10f. A PLATFORM ANNOUNCEMENT FOR ONE SALON + 10g. EACH SALON'S OWN TWILIO ACCOUNT ─────────────────────────────
  // a second salon (B) made the same way as this one, so isolation is proved between two real tenants
  let ownB = null, TB = null;
  await sub('10f second salon', async () => {
    const codeB = `PLB${tag}`;
    const ctB = await sa.post('/super-admin/tenants', { displayName: `Pilot Other Nails ${tag}`, legalName: `Pilot Other Nails ${tag} LLC`, tenantCode: codeB, ownerName: 'Bo Other', ownerEmail: `owner.b.${tag}@pilot-day.test`, ownerPhone: `609554${tag.slice(-4)}`, plan: 'Standard', state: 'NJ', city: 'Camden', initialCommissionPercent: 50 });
    TB = ctB.body?.tenant?.id ?? ctB.body?.tenant?.tenantId;
    const BB = (await q(`select id from branches where tenant_id = $1 order by created_at limit 1`, [TB]))[0]?.id;
    const PW_B = 'Pilot!OwnerB-' + randomUUID().slice(0, 8);
    const fsB = await ownerFirstSignIn(sa, TB, codeB, `owner.b.${tag}@pilot-day.test`, PW_B);
    if (!ok2(fsB.ch.status)) info(`owner B first sign-in: reset ${fsB.rp.status} ${short(fsB.rp.body)} temp-login ${fsB.tl.status} change ${fsB.ch.status} ${short(fsB.ch.body)}`);
    ownB = session('owner-b2');
    const l2 = await ownB.post('/auth/login', { portal: 'tenant', salonCode: codeB, identifier: `owner.b.${tag}@pilot-day.test`, password: PW_B });
    const s2 = await ownB.post('/auth/select-branch', { branchId: BB });
    check('a second salon (B) is onboarded the same way; its owner signs in to her own branch', ok2(ctB.status) && !!TB && ok2(l2.status) && ok2(s2.status), `create ${ctB.status} ${short(ctB.status >= 300 ? ctB.body : null)} login ${l2.status} select ${s2.status}`);
    // §66 (Oct 27 2026): salon B hires one technician, so phase 11's cross-tenant probe has a real foreign technician to aim at
    const tB = await ownB.post('/pos/technicians', { firstName: 'Bea', lastName: 'Other', email: `bea.${tag}@pilot-day.test`, phone: `609553${tag.slice(-4)}`, techAppEnabled: false, serviceIds: [] });
    if (!ok2(tB.status)) info(`salon B technician: ${tB.status} ${short(tB.body)}`);
  });
  await sub('10f platform announcement', async () => {
    const cr = await sa.post('/super-admin/communications/platform-announcements', { title: `Maintenance tonight ${tag}`, message: 'Card payments pause 11:00–11:15 PM for maintenance.', type: 'maintenance', priority: 'high', audience: 'selected_tenants', tenantIds: [T], dismissible: true, englishOnly: true, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
    const su = await sa.post('/auth/step-up', { password: SA_PASSWORD, code: await nextTotp() });
    const pb = await sa.post(`/super-admin/communications/platform-announcements/${cr.body?.id}/publish`, { expectedVersion: cr.body?.version, confirm: true, publishNow: true });
    const a = await own.get('/pos/platform-announcements/active');
    const b = ownB ? await ownB.get('/pos/platform-announcements/active') : { status: 0, body: null };
    const seen = (r) => (r.body?.announcements ?? []).some((x) => x.id === cr.body?.id);
    check('PLATFORM ANNOUNCEMENT: the Super Admin publishes a maintenance notice (fresh step-up) for THIS salon only → its POS shows it; salon B\'s POS does not',
      ok2(cr.status) && ok2(su.status) && ok2(pb.status) && a.status === 200 && seen(a) && b.status === 200 && !seen(b), `create ${cr.status} ${short(cr.status >= 300 ? cr.body : null)} publish ${pb.status} ${short(pb.status >= 300 ? pb.body : null)} A ${a.status} ${seen(a)} B ${b.status} ${seen(b)}`);
  });
  await sub('10g Twilio per salon', async () => {
    if (!TWILIO_LOG) { info('NOT_TESTED Twilio per-salon isolation: the API was not started with the Twilio loopback (PILOT_EXTERNAL_API)'); return; }
    const sidA = 'AC' + 'a'.repeat(28) + tag.slice(-4).padStart(4, '0'), sidB = 'AC' + 'b'.repeat(28) + tag.slice(-4).padStart(4, '0');
    const fromA = `+1609553${tag.slice(-4)}`, fromB = `+1856553${tag.slice(-4)}`;
    const cA = await sa.put(`/super-admin/tenants/${T}/messaging-credentials`, { accountSid: sidA, authToken: randomUUID().replace(/-/g, ''), fromNumber: fromA });
    const cB = await sa.put(`/super-admin/tenants/${TB}/messaging-credentials`, { accountSid: sidB, authToken: randomUUID().replace(/-/g, ''), fromNumber: fromB });
    const sA = await own.post('/pos/notifications/send', { channel: 'sms', to: '+16095550199', body: 'Your nails are ready — Pilot Day Nails' });
    const sB = ownB ? await ownB.post('/pos/notifications/send', { channel: 'sms', to: '+16095550198', body: 'Your nails are ready — Pilot Other Nails' }) : { status: 0 };
    const log = (await import('node:fs')).readFileSync(TWILIO_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.method === 'POST' && x.sid);
    const rowsA = await q(`select sender_route, sender_from, provider_id, status from notifications where tenant_id = $1 and channel = 'sms' and sender_route is not null order by created_at desc limit 1`, [T]);
    const rowsB = await q(`select sender_route, sender_from, provider_id, status from notifications where tenant_id = $1 and channel = 'sms' and sender_route is not null order by created_at desc limit 1`, [TB]);
    const mA = log.find((x) => x.sid === rowsA[0]?.provider_id), mB = log.find((x) => x.sid === rowsB[0]?.provider_id);
    numbers.mandate.twilio = { setA: cA.status, setB: cB.status, sendA: sA.status, sendB: sB.status, rowA: rowsA[0], rowB: rowsB[0], wireA: mA && { account: mA.accountSid === sidA, from: mA.from }, wireB: mB && { account: mB.accountSid === sidB, from: mB.from } };
    check('TWILIO PER SALON: each salon has its own Twilio account (Super Admin, token encrypted); salon A\'s text went out on A\'s account FROM A\'s number and salon B\'s on B\'s — never each other\'s; the ledger row records the route and the From (migration 678)',
      ok2(cA.status) && ok2(cB.status) && ok2(sA.status) && ok2(sB.status) && mA?.accountSid === sidA && mA?.from === fromA && mB?.accountSid === sidB && mB?.from === fromB
        && rowsA[0]?.sender_route === 'tenant_account' && rowsA[0]?.sender_from === fromA && rowsB[0]?.sender_route === 'tenant_account' && rowsB[0]?.sender_from === fromB,
      short(numbers.mandate.twilio));
  });

  if (STOP_AFTER <= 10) throw new Error('STOP_AFTER');

  // ══ 11. THE LARGE SALON: 200 technicians (mandate Oct 23 2026 §73–§105) — scripts/lib/pilot-large-salon.mjs ═══════
  phase('11 large salon');
  if (SKIP.has('11')) info('PILOT_SKIP=11: the large-salon phase was skipped in this run');
  else await sub('11 large salon', async () => {
    const L = await largeSalonPhase({ own, rec, pub, kiosk, session, tenantLogin, check, info, q, numbers, ctx, B, T, tag, TOMORROW, TODAY, week, STAFF_PW, TZ, extra, techDef: TECH_DEF, short, ok2, API, SALON_CODE });
    // M5 (Oct 24 2026): the rest of the 200-technician mandate on the same salon — lib/pilot-large-salon-m5.mjs
    if (SKIP.has('11m5')) info('PILOT_SKIP=11m5: the M5 continuation of the large-salon phase was skipped');
    else await largeSalonM5Phase({ own, rec, mgr, sa, pub, session, tenantLogin, check, info, q, ctx, B, T, tag, TOMORROW, TODAY, week, STAFF_PW, OWNER_PW, OWNER_EMAIL, TZ, extra, techDef: TECH_DEF, techSessions: tech, short, ok2, API, openLive, SCREENS, sleep, d, results }, L);
    // Oct 26 2026 (§48/§49/§76): lunch / break / time-off blocks for every technician × 7 days, availability honours them
    if (SKIP.has('11blocks')) info('PILOT_SKIP=11blocks: the blocked-time dataset of the large-salon phase was skipped');
    else await largeSalonBlocksPhase({ rec, check, info, q, T, B, d, ctx, short, ok2, numbers, tag });
    // Oct 26 2026 (§62/§69): the Owner App at 200 technicians — a paid day across the floor, then Team / Staff Performance,
    // by branch / service / payout method (week, month, YTD) and the payroll week against PostgreSQL; the screens at phone size
    if (SKIP.has('11owner')) info('PILOT_SKIP=11owner: the Owner App step of the large-salon phase was skipped');
    else await largeSalonOwnerPhase({ own, rec, check, info, q, T, B, short, ok2, numbers, tag, openLive, SCREENS, sleep });
  });
  if (STOP_AFTER <= 11) throw new Error('STOP_AFTER');

  // ══ 12. SECURE TAP TO PAY M6-5: three signing phones, live (scripts/lib/pilot-secure-tap-to-pay.mjs) ═══════════════
  phase('12 secure tap to pay');
  if (SKIP.has('12')) info('PILOT_SKIP=12: the Secure Tap to Pay phase was skipped in this run');
  else await sub('12 secure tap to pay', async () => {
    // Oct 26 2026 (Secure Tap internal gaps): + the CardPointe loopback (POS card unknown for §64, the annex merchant for §68),
    // the Super Admin's step-up (a second location + its merchant), the display credential (§77) — scripts/lib/pilot-secure-tap-to-pay.mjs
    await secureTapToPayPhase({ own, mgr, sa, rec, session, check, info, q, numbers, ctx, B, T, tag, STAFF_PW, OWNER_PW, OWNER_EMAIL, short, ok2, API, SALON_CODE, serve, LISA, MARY, ANNA, chCalls, chControl, sleep,
      CP_TOKENS, CARD, cpCalls, CP_HOST, TZ, saStepUp: async () => (await sa.post('/auth/step-up', { password: SA_PASSWORD, code: await nextTotp() })).status });
  });
  if (STOP_AFTER <= 12) throw new Error('STOP_AFTER');

  // ══ 13. ENGLISH + VIETNAMESE POS (Oct 26 2026 mandate) on the 200-technician salon — scripts/lib/pilot-vietnamese.mjs ═══
  phase('13 vietnamese pos');
  if (SKIP.has('13')) info('PILOT_SKIP=13: the Vietnamese POS phase was skipped in this run');
  else await sub('13 vietnamese pos', async () => {
    const vEnv = { own, rec, mgr, sa, pub, session, tenantLogin, check, info, q, numbers, ctx, B, T, tag, STAFF_PW, OWNER_PW, short, ok2, API, SCREENS, sleep, d,
      openLive, ensureBrowser, ensureApp, CP_TOKENS, shotsDir: SHOTS, saStepUp: async () => (await sa.post('/auth/step-up', { password: SA_PASSWORD, code: await nextTotp() })).status, adminPort: fsExists(APPS_DIR + 'admin-web/dist/index.html') ? screenApps['admin-web'] : null };
    await vietnamesePhase(vEnv);
    rec = vEnv.rec ?? rec;   // the receptionist's live session after phase 13's sign-out / sign-in (harness fix, Oct 27 final pass)
  });
  if (STOP_AFTER <= 13) throw new Error('STOP_AFTER');

  // ══ 14. RECOVERY FLOWS (Remaining Production §68, Oct 27 2026) — scripts/lib/pilot-recovery.mjs ═══════════════════
  phase('14 recovery flows');
  if (SKIP.has('14')) info('PILOT_SKIP=14: the recovery-flows phase was skipped in this run');
  else await sub('14 recovery flows', async () => {
    await recoveryPhase({ own, rec, pub, session, check, info, q, numbers, ctx, B, T, tag, SALON_CODE, short, ok2, serve, LISA, MARY, CP_TOKENS, cpCalls, cpControl, CARD, OWNER_PW, sleep });
  });
  if (STOP_AFTER <= 14) throw new Error('STOP_AFTER');
} catch (e) {
  if (String(e?.message) !== 'STOP_AFTER') check('the pilot ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  // M5 (Oct 24 2026): the API's structured log line for a 5xx is {"level":"error",…,"msg":"request.failed"} — lower case, so
  // the old pattern never saw one (a 500 on a schedule save slipped past it). Any error-level line now fails the day.
  // Expected error-level lines, named one by one: the development key ring's fallback notice (no MFA_ENC_KEY etc. in a
  // scratch run — a configuration notice, not a failure) and phase 10's deliberate "processor busy" card (503).
  const EXPECTED_API_ERROR = (l) => /"msg":"key\.fallback_in_use"/.test(l) || (/"status":503/.test(l) && /pay\/card/.test(l) && /card processor could not take this payment/.test(l));
  const apiErrors = errs.split('\n').filter((l) => /\bERROR\b|Unhandled|TypeError|ReferenceError|"level":"error"/.test(l) && !EXPECTED_API_ERROR(l));
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
