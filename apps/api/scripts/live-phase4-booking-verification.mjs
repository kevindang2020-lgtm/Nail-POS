#!/usr/bin/env node
// live-phase4-booking-verification.mjs — BUILD_PLAN Phase 4 (customer_booking_phone_verification), proved on the real
// API and PostgreSQL. The exit criterion: ALL THREE remote channels complete a verified booking.
//
//   0. The owner connects the salon's Verify Service: "Test Verify" really calls it and records the result; then the
//      salon turns verification on for every remote booking ("verify every booking").
//   1. CUSTOMER APP: a booking is refused (428) with a sealed booking session and a held slot → the code goes out through
//      the salon's own Verify Service → the right code → the SAME booking completes, labelled "verified"; the proof is
//      spent (the next booking asks again). Wrong codes lock the session and give the slot back.
//   2. PUBLIC LINK (signed, no login): refused with a sealed session → send/check on the link's own routes → the retry
//      with the same idempotency key books. A session sealed for another link is refused.
//   3. AI RECEPTIONIST (voice key): refused with collect_verification_code (DTMF) and the code ALREADY texted → the
//      keypad digits posted to the sealed callback URL (no key — as Twilio's <Gather> would) → the retry books.
//   4. MANAGER OVERRIDE: a guest who cannot receive texts — the owner approves that one booking with a reason; it books
//      labelled "staff_override"; the owner is alerted.
//   5. Twilio's signed status callback lands on the job queue once (a retry adds nothing) and stamps delivery.
//   6. The usage panel and Super Admin oversight count it — never a phone number.
//
// The ONE fake is Twilio Verify itself: a loopback HTTP service (TWILIO_VERIFY_BASE_URL — honoured only outside
// production and only for loopback) that issues, checks and describes exactly as Twilio does. This script reads codes
// from the fake, as a customer reads them from their phone.
//
//   2b. With CHROMIUM_PATH set: the REAL booking-public page in Chromium, served with its own generated CSP (the inline
//      script allowed by its sha256 only) — a guest picks a time, gets the code step, types the code, is booked.
//
// Run:  DATABASE_URL=postgres://… [CHROMIUM_PATH=/opt/pw-browsers/chromium] node scripts/live-phase4-booking-verification.mjs
//       (apps/api built). Never point it at
// production: it creates a proof branch, staff, a customer account, a voice key, Twilio credentials for the proof branch,
// and removes them all.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID, randomInt, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { encryptSecret } = require('../dist/common/provider-crypto.js');
const { signBookingContext } = require('../dist/ai-booking/ai-booking-signed-context.js');
const { phoneKey } = require('@aipowersalon/customers');
const { computeTwilioSignature } = require('@aipowersalon/notifications');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3052), API = `http://127.0.0.1:${PORT}`, VERIFY_PORT = Number(process.env.VERIFY_PORT_PROOF || 3094), PAGE_PORT = Number(process.env.PAGE_PORT_PROOF || 3096);
const SALON = process.env.SALON_CODE || 'PILOT01';
const LINK_SECRET = 'live-phase4-link-secret-' + randomBytes(8).toString('hex');
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;

// ── the fake Twilio Verify ─────────────────────────────────────────────────────────────────────────────────────────
const codes = new Map(); const verifyCalls = [];
const ACCOUNT = 'AC' + randomUUID().replace(/-/g, '').slice(0, 32), TOKEN = 'tok-' + randomUUID(), SERVICE = 'VA' + randomUUID().replace(/-/g, '').slice(0, 32);
const sids = new Map();   // phone → VE sid
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const form = new URLSearchParams(raw);
    const authOk = req.headers.authorization === 'Basic ' + Buffer.from(`${ACCOUNT}:${TOKEN}`).toString('base64');
    verifyCalls.push({ method: req.method, path: req.url, authOk, to: form.get('To'), locale: form.get('Locale') });
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!authOk) return send(401, { message: 'Authenticate' });
    if (req.method === 'GET' && req.url === `/v2/Services/${SERVICE}`) return send(200, { sid: SERVICE, friendly_name: 'Live Phase4 Salon' });
    if (!String(req.url).startsWith(`/v2/Services/${SERVICE}/`)) return send(404, { message: 'not found' });
    if (req.url.endsWith('/Verifications')) { const code = String(randomInt(100000, 1000000)); codes.set(form.get('To'), code); const sid = 'VE' + randomUUID().replace(/-/g, '').slice(0, 32); sids.set(form.get('To'), sid); return send(201, { sid, status: 'pending' }); }
    if (req.url.endsWith('/VerificationCheck')) {
      const want = codes.get(form.get('To'));
      if (!want) return send(404, { message: 'not found' });
      if (want === form.get('Code')) { codes.delete(form.get('To')); return send(200, { status: 'approved', valid: true }); }
      return send(200, { status: 'pending', valid: false });
    }
    send(404, { message: 'no route' });
  });
});
await new Promise((r) => fake.listen(VERIFY_PORT, '127.0.0.1', r));

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase4 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), CU = randomUUID(), C1 = randomUUID(), IDENT = randomUUID(), TECH = randomUUID(), SA = randomUUID(), VKID = randomUUID();
const P_WEB = `+1856565${tag.slice(-4)}`, P_APP = `+1856561${tag.slice(-4)}`, P_PUB = `+1856562${tag.slice(-4)}`, P_VOICE = `+1856563${tag.slice(-4)}`, P_OVR = `+1856564${tag.slice(-4)}`;
const OWN_EMAIL = `phase4-owner-${tag}@aipowersalon.test`, OWN_PW = 'Phase4!Own-' + randomUUID().slice(0, 8);
const CU_EMAIL = `phase4-cust-${tag}@aipowersalon.test`, CU_PW = 'Phase4!Cust-' + randomUUID().slice(0, 8);
const SA_EMAIL = `phase4-sa-${tag}@aipowersalon.test`, SA_PW = 'Phase4!SA-' + randomUUID().slice(0, 8);
const VOICE_KEY = 'vk_test_' + randomBytes(24).toString('base64url');
const cat = (await q(`select category_id from services where tenant_id = $1 and status = 'active' limit 1`, [T]))[0]?.category_id;
if (!cat) { console.error('the salon needs an active service (for its category)'); process.exit(2); }
const SVC = randomUUID();
const svc = { id: SVC };
// a weekday ten days out, in the branch's own zone (store hours apply to the staff engine)
const day = (() => { const d = new Date(Date.now() + 10 * 86_400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active','America/New_York')`, [B, T, `Live Phase4 Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Live Phase4 Gel',45,4500,'active')`, [SVC, T, B, cat]);
await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, auth_token_last4, verify_service_sid, status, branch_id) values ($1,'twilio',$2,$3,$4,$5,'configured',$6)`,
  [T, ACCOUNT, encryptSecret(TOKEN), TOKEN.slice(-4), SERVICE, B]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Olive','Owner','Olive Owner',$4,$5,'active','OWNER')`, [OWN, T, B, OWN_EMAIL, await hashPassword(OWN_PW)]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'manager')`, [T, B, OWN]).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [T, B, OWN]).catch(() => undefined));
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tia','Four','Tia Four','active')`, [TECH, T, B]);
await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, TECH, SVC]);
const cuHash = await hashPassword(CU_PW);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, password_hash, status, role) values ($1,$2,$3,'Cara','App','Cara App',$4,$5,$6,'active','CUSTOMER')`, [CU, T, B, CU_EMAIL, P_APP, cuHash]);
await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at) values ($1,$2,$3,$4,'Cara','App','Cara App',$5,$5, now())`, [C1, T, B, CU, P_APP]);
await q(`insert into customer_identities (id, normalized_phone, email, full_name, password_hash, phone_verified_at) values ($1,$2,$3,'Cara App',$4, now())`, [IDENT, P_APP, CU_EMAIL, cuHash]);
await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDENT, T, CU, C1]);
await q(`insert into voice_integration_keys (id, tenant_id, branch_id, label, provider, prefix, secret_hash) values ($1,$2,$3,'Live Phase4 voice','retell',$4,$5)`, [VKID, T, B, VOICE_KEY.slice(0, 12), createHash('sha256').update(VOICE_KEY).digest('hex')]);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Platform', 'Pat Platform', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, await hashPassword(SA_PW)]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT),
  TWILIO_VERIFY_BASE_URL: `http://127.0.0.1:${VERIFY_PORT}`, AI_BOOKING_LINK_SECRET: LINK_SECRET, VOICE_WRITE_TOOLS_ENABLED: 'true', PUBLIC_API_BASE_URL: API, TRUST_PROXY_HOPS: '1' };
for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
let proc = null; let errs = '';
const sessionIds = async () => (await q(`select id::text from booking_verification_sessions where tenant_id = $1 and branch_id = $2`, [T, B])).map((r) => r.id);
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  const ids = await sessionIds().catch(() => []);
  const sidList = [...sids.values()];
  await q(`delete from jobs where tenant_id = $1 and (idempotency_key like any($2::text[]) or payload::text like any($3::text[]))`, [T, sidList.map((s) => `${s}:%`), ids.map((s) => `%${s}%`)]).catch(() => undefined);
  await q(`delete from outbox_events where tenant_id = $1 and (aggregate_id::text = any($2::text[]) or payload_json::text like any($3::text[]))`, [T, ids, ids.map((s) => `%${s}%`)]).catch(() => undefined);
  await q(`delete from booking_verified_phones where tenant_id = $1 and phone_hash = any($2::text[])`, [T, [P_APP, P_PUB, P_VOICE, P_OVR, P_WEB].map(phoneKey)]).catch(() => undefined);
  await q(`delete from owner_alerts where tenant_id = $1 and category = 'booking_verification' and metadata::text like any($2::text[])`, [T, ids.map((s) => `%${s}%`)]).catch(() => undefined);
  await q(`delete from ai_receptionist_control where tenant_id = $1 and branch_id = $2`, [T, B]).catch(() => undefined);
  await q(`delete from customer_identity_links where identity_id = $1`, [IDENT]).catch(() => undefined);
  await q(`delete from customer_identities where id = $1`, [IDENT]).catch(() => undefined);
  for (const u of [OWN, CU, SA]) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[OWN_EMAIL, CU_EMAIL, SA_EMAIL]]).catch(() => undefined);
  await q(`delete from user_branch_access where user_id = $1`, [OWN]).catch(() => undefined);
  await q(`update customers set user_id = null where id = $1`, [C1]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [[OWN, CU, SA]]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[])) + (select count(*)::int from customers where id = $3)
      + (select count(*)::int from customer_identities where id = $4) + (select count(*)::int from voice_integration_keys where id = $5) + (select count(*)::int from booking_verification_sessions where branch_id = $1)
      + (select count(*)::int from tenant_messaging_credentials where branch_id = $1) + (select count(*)::int from booking_holds where branch_id = $1) + (select count(*)::int from pos_tech_appointments where branch_id = $1) as n`,
    [B, [OWN, CU, SA], C1, IDENT, VKID]))[0].n;
  check('the proof branch, staff, customer, account, voice key, Twilio credentials, verifications, holds and appointments are removed', a.removed && left === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
  await client.end();
  fake.close();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 6 * 60_000);

const login = async (body) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
};
const as = (cookie, extra = {}) => (method, path, body) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined }).then(j);
const pub = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);
const voice = (method, path, body, idem) => fetch(API + path, { method, headers: { 'x-voice-key': VOICE_KEY, 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(j);
const codeFor = (e164) => codes.get(e164);
const wrong = (e164) => (codeFor(e164) === '000000' ? '111111' : '000000');
const sessionRow = async (bookingSessionHash) => (await q(`select * from booking_verification_sessions where tenant_id = $1 and branch_id = $2 and phone_hash = $3 order by created_at desc limit 1`, [T, B, phoneKey(bookingSessionHash)]))[0];
const appt = async (id) => (await q(`select id, status, phone_verification, phone_verification_session_id, start_time, source from pos_tech_appointments where id::text = $1`, [String(id)]))[0];

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL (with the loopback Twilio Verify)', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // ── 0. the owner connects Verify and turns it on ────────────────────────────────────────────────────────────────
  const ol = await login({ portal: 'tenant', salonCode: SALON, identifier: OWN_EMAIL, password: OWN_PW });
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: ol.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(); for (const c of [...ol.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  const own = as([...jar.values()].join('; '));
  check('the owner signs in and works at the proof branch', ol.status === 200 && sel.status === 200, `login ${ol.status} select ${sel.status}`);
  const before = await own('GET', `/tenant/messaging/credentials/branches/${B}`);
  check('the branch\'s Verify Service shows, untested (no secret returned)', before.status === 200 && before.body?.verifyServiceSid === SERVICE && !before.body?.lastValidatedAt && !JSON.stringify(before.body).includes(TOKEN), `status ${before.status} ${JSON.stringify(before.body).slice(0, 200)}`);
  const enableEarly = await own('PATCH', `/pos/settings/booking-phone-verification/branches/${B}`, { enabled: true });
  check('verification cannot be turned on before Verify is tested (409)', enableEarly.status === 409, `status ${enableEarly.status} ${JSON.stringify(enableEarly.body).slice(0, 160)}`);
  const tv = await own('POST', `/tenant/messaging/credentials/branches/${B}/test-verify`);
  const credRow = (await q(`select last_validated_at, last_validation_error from tenant_messaging_credentials where tenant_id = $1 and branch_id = $2`, [T, B]))[0];
  check('"Test Verify" really fetches the Verify Service with the salon\'s credentials and records it', ok2(tv.status) && tv.body?.ok === true && credRow?.last_validated_at && !credRow.last_validation_error && verifyCalls.some((c) => c.method === 'GET' && c.authOk), `status ${tv.status} ${JSON.stringify(tv.body).slice(0, 160)} ${JSON.stringify(credRow)}`);
  const en = await own('PATCH', `/pos/settings/booking-phone-verification/branches/${B}`, { enabled: true, verifyEveryBooking: true, channels: { online: true, customerApp: true, aiReceptionist: true } });
  check('verification is ON for every remote booking at the branch ("verify every booking")', ok2(en.status) && en.body?.enabled === true && en.body?.verifyEveryBooking === true, `status ${en.status} ${JSON.stringify(en.body).slice(0, 200)}`);
  const kiosk = await own('PATCH', `/pos/settings/booking-phone-verification/branches/${B}`, { channels: { kiosk: true } });
  check('the in-salon switches are refused (front desk / walk-in / kiosk make no remote bookings)', kiosk.status === 400, `status ${kiosk.status}`);

  // ── 1. the CUSTOMER APP ──────────────────────────────────────────────────────────────────────────────────────────
  const cl = await login({ portal: 'customer', identifier: CU_EMAIL, password: CU_PW });
  const cust = as(cl.cookie, { 'x-device-id': `proof-device-${tag}`, 'accept-language': 'es-US' });
  check('the customer signs in to the app', cl.status === 200 && !!cl.cookie, `status ${cl.status}`);
  const bookBody = { serviceId: svc.id, technicianId: TECH, date: day, startTime: '10:00', salonId: B };
  const r1 = await cust('POST', '/customer/booking', bookBody);
  check('the booking is REFUSED until the phone is proven (428) — a sealed session, the masked number, the hold\'s end', r1.status === 428 && String(r1.body?.bookingSessionId ?? '').startsWith('bs~') && String(r1.body?.maskedPhone).endsWith(P_APP.slice(-4)) && !!r1.body?.holdExpiresAt && !JSON.stringify(r1.body).includes(P_APP.slice(2)), `status ${r1.status} ${JSON.stringify(r1.body).slice(0, 220)}`);
  const hold1 = (await q(`select released_at, converted_appointment_id, technician_id from booking_holds where branch_id = $1 order by created_at desc limit 1`, [B]))[0];
  check('the slot is HELD for this booking while the customer verifies', hold1 && !hold1.released_at && hold1.technician_id === TECH, JSON.stringify(hold1 ?? null));
  const avail = await cust('GET', `/customer/booking/availability?serviceId=${svc.id}&technicianId=${TECH}&date=${day}&salonId=${B}`);
  const slot1000 = (avail.body?.slots ?? []).find((x) => x.startTime === '10:00');
  check('another look at the day does not offer the held 10:00 (held = taken)', avail.status === 200 && slot1000?.available === false, `status ${avail.status} ${JSON.stringify(slot1000 ?? null)}`);
  const s1 = await cust('POST', '/customer/booking/verification/send', { bookingSessionId: r1.body?.bookingSessionId });
  check('the code goes out through the SALON\'s Verify Service, to the customer\'s OWN number, in their language', ok2(s1.status) && s1.body?.status === 'code_sent' && !!codeFor(P_APP) && verifyCalls.some((c) => c.to === P_APP && c.authOk && c.locale === 'es'), `status ${s1.status} ${JSON.stringify(s1.body).slice(0, 160)}`);
  const w1 = await cust('POST', '/customer/booking/verification/check', { bookingSessionId: r1.body?.bookingSessionId, code: wrong(P_APP) });
  check('a wrong code is refused (400), the booking still does not exist', w1.status === 400 && (await q(`select count(*)::int as n from pos_tech_appointments where branch_id = $1`, [B]))[0].n === 0, `status ${w1.status}`);
  const c1 = await cust('POST', '/customer/booking/verification/check', { bookingSessionId: s1.body?.bookingSessionId ?? r1.body?.bookingSessionId, code: codeFor(P_APP) });
  check('the right code proves the phone', ok2(c1.status) && c1.body?.status === 'phone_verified', `status ${c1.status} ${JSON.stringify(c1.body)}`);
  const b1 = await cust('POST', '/customer/booking', { ...bookBody, bookingSessionId: r1.body?.bookingSessionId });
  const a1 = b1.body?.appointmentId ? await appt(b1.body.appointmentId) : null;
  check('CUSTOMER APP: the same booking now completes', ok2(b1.status) && !!a1, `status ${b1.status} ${JSON.stringify(b1.body).slice(0, 200)}`);
  check('the appointment says how its phone was proven ("verified"), tied to the verification', a1?.phone_verification === 'verified' && !!a1?.phone_verification_session_id, JSON.stringify(a1 ?? null));
  const sess1 = (await q(`select status, consumed_appointment_id::text as c from booking_verification_sessions where id = $1`, [a1?.phone_verification_session_id]))[0];
  const holdAfter = (await q(`select converted_appointment_id::text as c from booking_holds where branch_id = $1 and technician_id = $2 order by created_at limit 1`, [B, TECH]))[0];
  check('the proof is spent on THIS appointment, and the hold became it', sess1?.status === 'verified' && sess1?.c === a1?.id && holdAfter?.c === a1?.id, JSON.stringify({ sess1, holdAfter }));
  const again = await cust('POST', '/customer/booking', { ...bookBody, startTime: '13:00', bookingSessionId: r1.body?.bookingSessionId });
  check('"every booking": the next booking asks for a new code — a spent proof books nothing', again.status === 428, `status ${again.status}`);
  // lock: five wrong codes on that new session
  await cust('POST', '/customer/booking/verification/send', { bookingSessionId: again.body?.bookingSessionId });
  let last = null; for (let i = 0; i < 5; i++) last = await cust('POST', '/customer/booking/verification/check', { bookingSessionId: again.body?.bookingSessionId, code: wrong(P_APP) });
  const lockedRow = (await q(`select s.status, h.released_at from booking_verification_sessions s left join booking_holds h on h.id = s.booking_hold_id where s.branch_id = $1 and s.status = 'locked' order by s.created_at desc limit 1`, [B]))[0];
  check('five wrong codes LOCK the session (429) and give the 13:00 slot back', last?.status === 429 && lockedRow?.status === 'locked' && !!lockedRow?.released_at, `status ${last?.status} ${JSON.stringify(lockedRow ?? null)}`);
  const afterLock = await cust('POST', '/customer/booking/verification/check', { bookingSessionId: again.body?.bookingSessionId, code: codeFor(P_APP) ?? '123456' });
  check('a locked session stays locked — even the right code proves nothing', afterLock.status === 429, `status ${afterLock.status}`);

  // ── 2. the PUBLIC LINK ───────────────────────────────────────────────────────────────────────────────────────────
  const JTI = randomUUID();
  const link = signBookingContext({ tenantId: T, branchId: B, source: 'ONLINE_BOOKING' }, { secret: LINK_SECRET, jti: JTI, ttlSeconds: 3600 });
  // as the page does: the time and the first free technician come from the link's availability search
  const pubBody = { token: link, customerName: 'Gwen Guest', customerPhone: P_PUB, serviceIds: [svc.id], technicianId: TECH, date: day, startTime: '11:00', confirm: true, idempotencyKey: `pub-${tag}`, deviceId: `web-${tag}` };
  const p1 = await pub('/api/ai-booking/v1/public/appointments', pubBody);
  check('PUBLIC LINK: the guest\'s booking is refused with a sealed session for THIS link (not a 500, not "internal error")', ok2(p1.status) && p1.body?.ok === false && p1.body?.errorCode === 'PHONE_VERIFICATION_REQUIRED' && String(p1.body?.bookingSessionId).startsWith('bs~') && String(p1.body?.maskedPhone).endsWith(P_PUB.slice(-4)), `status ${p1.status} ${JSON.stringify(p1.body).slice(0, 220)}`);
  const otherLink = signBookingContext({ tenantId: T, branchId: B, source: 'ONLINE_BOOKING' }, { secret: LINK_SECRET, jti: randomUUID(), ttlSeconds: 3600 });
  const cross = await pub('/api/ai-booking/v1/public/verification/send', { token: otherLink, bookingSessionId: p1.body?.bookingSessionId, customerPhone: P_PUB });
  check('the session cannot be used from ANOTHER link (400, nothing sent)', cross.status === 400 && !codeFor(P_PUB), `status ${cross.status}`);
  const ps = await pub('/api/ai-booking/v1/public/verification/send', { token: link, bookingSessionId: p1.body?.bookingSessionId, customerPhone: P_PUB, deviceId: `web-${tag}` });
  check('the code goes out on the salon\'s Verify Service', ok2(ps.status) && ps.body?.status === 'code_sent' && !!codeFor(P_PUB), `status ${ps.status} ${JSON.stringify(ps.body).slice(0, 160)}`);
  const pc = await pub('/api/ai-booking/v1/public/verification/check', { token: link, bookingSessionId: p1.body?.bookingSessionId, customerPhone: P_PUB, code: codeFor(P_PUB) });
  check('the guest\'s code proves the phone', ok2(pc.status) && pc.body?.status === 'phone_verified', `status ${pc.status} ${JSON.stringify(pc.body)}`);
  const p2 = await pub('/api/ai-booking/v1/public/appointments', { ...pubBody, bookingSessionId: p1.body?.bookingSessionId });
  const a2 = p2.body?.appointmentId ? await appt(p2.body.appointmentId) : null;
  check('PUBLIC LINK: the retry with the SAME idempotency key books (the refusal was not remembered as the outcome)', ok2(p2.status) && p2.body?.ok === true && !!a2, `status ${p2.status} ${JSON.stringify(p2.body).slice(0, 200)}`);
  check('the guest\'s appointment is labelled "verified"', a2?.phone_verification === 'verified', JSON.stringify(a2 ?? null));
  const p3 = await pub('/api/ai-booking/v1/public/appointments', { ...pubBody, startTime: '14:00', idempotencyKey: `pub-${tag}-2`, bookingSessionId: p1.body?.bookingSessionId });
  check('the same proof cannot book a SECOND appointment', p3.body?.errorCode === 'PHONE_VERIFICATION_REQUIRED', `status ${p3.status} ${JSON.stringify(p3.body).slice(0, 160)}`);

  // ── 2b. the booking-public PAGE, in a real browser, under its own CSP ───────────────────────────────────────────
  if (process.env.CHROMIUM_PATH) {
    const { chromium } = require('playwright');
    const root = new URL('../../booking-public/', import.meta.url).pathname;
    const csp = /Content-Security-Policy: (.+)/.exec(readFileSync(root + 'public/_headers', 'utf8'))[1];
    // the page and the API on ONE origin (as deployed behind the same host): the static page with its CSP header, the
    // API proxied — so connect-src 'self' and the script hash are what is really tested
    const page = createServer((req, res) => {
      if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/book')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp }); return res.end(readFileSync(root + 'index.html')); }
      // one proxy hop in front of the API (TRUST_PROXY_HOPS=1, as deployed): the guest's own address rides X-Forwarded-For
      const up = { method: req.method, headers: { ...req.headers, host: `127.0.0.1:${PORT}`, 'x-forwarded-for': '198.51.100.77' } };
      const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => {
        try {
          const r = await fetch(API + req.url, { ...up, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
          res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) { res.writeHead(502); res.end(String(e)); }
      });
    });
    await new Promise((r) => page.listen(PAGE_PORT, '127.0.0.1', r));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    try {
      const webLink = signBookingContext({ tenantId: T, branchId: B, source: 'ONLINE_BOOKING' }, { secret: LINK_SECRET, jti: randomUUID(), ttlSeconds: 3600 });
      const ctxB = await browser.newContext({ viewport: { width: 420, height: 900 } });
      const p = await ctxB.newPage();
      const errorsB = []; p.on('pageerror', (e) => errorsB.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errorsB.push(m.text()); });
      await p.goto(`http://127.0.0.1:${PAGE_PORT}/?t=${encodeURIComponent(webLink)}&s=${T}`);
      await p.locator('#scrPick').waitFor({ state: 'visible', timeout: 20000 });
      check('the booking page RUNS under its own CSP (the inline script is allowed by its hash; no violation)', !errorsB.some((e) => /Content Security Policy|Refused to/i.test(e)), errorsB.join(' | ').slice(0, 200));
      await p.selectOption('#selService', SVC);
      await p.fill('#selDate', day);
      await p.click('#loadTimes');
      await p.locator('#slotGrid .slot[data-t="09:00"]').waitFor({ timeout: 20000 });
      await p.click('#slotGrid .slot[data-t="09:00"]');
      await p.fill('#fName', 'Willa'); await p.fill('#lName', 'Web'); await p.fill('#phone', P_WEB);
      await p.click('#doBook');
      await p.locator('#scrCode').waitFor({ state: 'visible', timeout: 20000 });
      await p.waitForFunction(() => /texted a 6-digit code/.test(document.querySelector('#codeSent')?.textContent ?? ''), null, { timeout: 15000 });
      const sentText = await p.textContent('#codeSent'); const holdText = await p.textContent('#holdNote');
      check('PUBLIC PAGE: "Confirm booking" opens the code step — masked number, the time held — and the code was sent', String(sentText).includes(P_WEB.slice(-4)) && !String(sentText).includes(P_WEB.slice(2)) && /holding this time/.test(String(holdText)) && !!codeFor(P_WEB), `${sentText} | ${holdText}`);
      await p.fill('#code', wrong(P_WEB)); await p.dispatchEvent('#code', 'input');
      await p.waitForFunction(() => (document.querySelector('#codeMsg')?.textContent ?? '').length > 0, null, { timeout: 15000 });
      check('a wrong code on the page shows the server\'s message and books nothing', /incorrect/i.test(String(await p.textContent('#codeMsg'))) && await p.locator('#scrCode').isVisible(), String(await p.textContent('#codeMsg')));
      await p.fill('#code', codeFor(P_WEB)); await p.dispatchEvent('#code', 'input');
      await p.locator('#scrDone').waitFor({ state: 'visible', timeout: 20000 });
      const webAppt = (await q(`select phone_verification, start_time, source from pos_tech_appointments where branch_id = $1 and customer_phone = $2`, [B, P_WEB]))[0];
      check('PUBLIC PAGE: typing the right code books it — "You\'re booked!", the appointment labelled "verified"', webAppt?.phone_verification === 'verified' && String(webAppt.start_time).startsWith('09:00'), JSON.stringify(webAppt ?? null));
      if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/public-booked.png` }).catch(() => undefined);
    } catch (e) {
      const pg0 = (await browser.contexts()[0]?.pages())?.[0];
      const diag = pg0 ? await pg0.evaluate(() => ({ screens: ['scrPick', 'scrWho', 'scrCode', 'scrDone', 'scrBad'].filter((id) => !document.getElementById(id)?.classList.contains('hide')), bad: document.getElementById('badMsg')?.textContent, pick: document.getElementById('pickMsg')?.textContent, who: document.getElementById('whoMsg')?.textContent, code: document.getElementById('codeMsg')?.textContent, sent: document.getElementById('codeSent')?.textContent, captcha: document.getElementById('captchaBox')?.textContent, slots: [...document.querySelectorAll('#slotGrid .slot')].map((x) => x.getAttribute('data-t')).slice(0, 30) })).catch((x) => String(x)) : null;
      check('the public page journey', false, `${String(e?.message ?? e).slice(0, 160)} :: ${JSON.stringify(diag)}`);
    } finally { await browser.close().catch(() => undefined); page.close(); }
  }

  // ── 3. the AI RECEPTIONIST ───────────────────────────────────────────────────────────────────────────────────────
  // AI Receptionist guide (Oct 31 2026): the AI books only where the salon ARMED booking actions (else handoff-only, 503).
  // Arming has its own gates (package, agent, key, business setup — receptionist-center tests); this proof is about the
  // phone code, so the salon's armed state is recorded here as the owner's arm action would leave it.
  await q(`insert into ai_receptionist_control (tenant_id, branch_id, booking_armed, booking_armed_at, booking_armed_by, booking_arm_reason)
    values ($1, $2, true, now(), $3, 'phase-4 proof') on conflict (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set booking_armed = true`, [T, B, OWN]);
  const vBody = { serviceId: svc.id, technicianId: TECH, date: day, startTime: '12:00', customerName: 'Vic Voice', customerPhone: P_VOICE, callerConfirmed: true };
  const v1 = await voice('POST', '/api/ai-receptionist/v1/appointments', vBody, `voice-${tag}`);
  check('AI RECEPTIONIST: reachable with the voice key (not a 401 "No session") and refused with collect_verification_code (DTMF)', ok2(v1.status) && v1.body?.action === 'collect_verification_code' && v1.body?.input === 'dtmf' && !!v1.body?.dtmfUrl && String(v1.body?.bookingSessionId).startsWith('bs~'), `status ${v1.status} ${JSON.stringify(v1.body).slice(0, 260)}`);
  check('the code was ALREADY texted to the number on the booking (the caller is on the line)', v1.body?.codeSent === true && !!codeFor(P_VOICE), JSON.stringify({ codeSent: v1.body?.codeSent }));
  check('nothing on the instruction carries the full number', !JSON.stringify(v1.body ?? {}).includes(P_VOICE.slice(2)));
  const tw = await fetch(String(v1.body?.twimlUrl ?? API)).then((r) => r.text());
  check('the TwiML gathers the code on the KEYPAD only, posting back to the sealed callback', tw.includes('input="dtmf"') && !tw.includes('speech') && tw.includes('format=twiml'), tw.slice(0, 160));
  const badDigits = await fetch(String(v1.body?.dtmfUrl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `Digits=${wrong(P_VOICE)}&To=%2B18565559999` }).then(j);
  check('wrong keypad digits are refused (and never echoed)', badDigits.body?.ok === false && !JSON.stringify(badDigits.body).includes(wrong(P_VOICE)), JSON.stringify(badDigits.body));
  const dtmf = await fetch(String(v1.body?.dtmfUrl), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `Digits=${codeFor(P_VOICE)}&To=%2B18565559999&CallSid=CA${tag}` }).then(j);
  check('the keypad digits posted to the callback WITHOUT a voice key (as Twilio\'s <Gather> does) prove the phone — the number comes from the sealed callback, not `To`', ok2(dtmf.status) && dtmf.body?.ok === true && dtmf.body?.status === 'phone_verified' && dtmf.body?.entered === '[6 digits entered]', `status ${dtmf.status} ${JSON.stringify(dtmf.body)}`);
  const forged = await fetch(`${API}/api/ai-receptionist/v1/verification/dtmf?vc=vc.forged.token.x`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'Digits=123456' }).then(j);
  check('a forged callback token is refused', forged.body?.ok === false && forged.body?.status === 'code_expired', JSON.stringify(forged.body));
  const v2 = await voice('POST', '/api/ai-receptionist/v1/appointments', { ...vBody, bookingSessionId: v1.body?.bookingSessionId }, `voice-${tag}`);
  const a3 = v2.body?.data?.appointment?.id ? await appt(v2.body.data.appointment.id) : null;
  check('AI RECEPTIONIST: the retry with the SAME Idempotency-Key books', ok2(v2.status) && v2.body?.success === true && !!a3, `status ${v2.status} ${JSON.stringify(v2.body).slice(0, 220)}`);
  check('the voice appointment is labelled "verified" and sourced as AI', a3?.phone_verification === 'verified' && a3?.source === 'ai', JSON.stringify(a3 ?? null));
  const vNoKey = await fetch(API + '/api/ai-receptionist/v1/services').then(j);
  check('without the voice key the gateway refuses (401)', vNoKey.status === 401, `status ${vNoKey.status}`);

  // ── 4. the MANAGER OVERRIDE ──────────────────────────────────────────────────────────────────────────────────────
  const oBody = { ...pubBody, customerName: 'Opal Override', customerPhone: P_OVR, startTime: '15:00', idempotencyKey: `pub-${tag}-ovr` };
  const o1 = await pub('/api/ai-booking/v1/public/appointments', oBody);
  check('a guest who cannot receive texts is refused like anyone', o1.body?.errorCode === 'PHONE_VERIFICATION_REQUIRED', JSON.stringify(o1.body).slice(0, 160));
  const pend = await own('GET', '/pos/booking/verification-override/pending');
  const row = (pend.body?.items ?? []).find((x) => String(x.maskedPhone).endsWith(P_OVR.slice(-4)));
  check('the owner sees the booking waiting for a code (masked number only)', pend.status === 200 && !!row && !JSON.stringify(pend.body).includes(P_OVR.slice(2)), `status ${pend.status} ${JSON.stringify(pend.body).slice(0, 200)}`);
  const ovShort = await own('POST', '/pos/booking/verification-override', { verificationId: row?.id, reason: 'ok', contactMethod: 'in_person' });
  check('the override needs a real reason (400)', ovShort.status === 400, `status ${ovShort.status}`);
  const ov = await own('POST', '/pos/booking/verification-override', { verificationId: row?.id, reason: 'Guest is at the front desk with photo ID', contactMethod: 'in_person' });
  check('the owner approves THAT ONE booking', ok2(ov.status) && ov.body?.ok === true, `status ${ov.status} ${JSON.stringify(ov.body)}`);
  const o2 = await pub('/api/ai-booking/v1/public/appointments', { ...oBody, bookingSessionId: o1.body?.bookingSessionId });
  const a4 = o2.body?.appointmentId ? await appt(o2.body.appointmentId) : null;
  check('the guest\'s retry books — labelled "staff_override", never "verified"', o2.body?.ok === true && a4?.phone_verification === 'staff_override', `${JSON.stringify(o2.body).slice(0, 160)} ${JSON.stringify(a4 ?? null)}`);
  const trust = (await q(`select count(*)::int as n from booking_verified_phones where tenant_id = $1 and phone_hash = $2`, [T, phoneKey(P_OVR)]))[0].n;
  check('the override granted NO trust for the number (the next booking asks again)', trust === 0, `rows ${trust}`);
  let alert = null; for (let i = 0; i < 10 && !alert; i++) { alert = (await q(`select severity, audience, body from owner_alerts where tenant_id = $1 and category = 'booking_verification' and metadata->>'sessionId' = $2`, [T, row?.id]))[0] ?? null; if (!alert) await sleep(200); }
  check('the owner is alerted (masked number, the reason)', alert?.audience === 'owner' && String(alert.body).includes(P_OVR.slice(-4)) && !String(alert.body).includes(P_OVR.slice(2)) && String(alert.body).includes('photo ID'), JSON.stringify(alert ?? null).slice(0, 200));

  // ── 5. Twilio's status callback ──────────────────────────────────────────────────────────────────────────────────
  const veSid = sids.get(P_PUB);
  const params = { VerificationSid: veSid, VerificationStatus: 'delivered' };
  const url = `https://127.0.0.1:${PORT}/webhooks/twilio/booking-verification/status`;
  const postStatus = (sig) => fetch(API + '/webhooks/twilio/booking-verification/status', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params).toString() });
  const wh1 = await postStatus(computeTwilioSignature(TOKEN, url, params)); await postStatus(computeTwilioSignature(TOKEN, url, params)); await postStatus(computeTwilioSignature('not-the-token', url, { ...params, VerificationStatus: 'failed' }));
  const jobs = await q(`select status, idempotency_key from jobs where tenant_id = $1 and idempotency_key like $2`, [T, `${veSid}:%`]);
  check('a signed status callback is queued ONCE (a retry adds nothing; a forged one adds nothing) and answered 204', wh1.status === 204 && jobs.length === 1 && jobs[0].idempotency_key === `${veSid}:delivered`, JSON.stringify(jobs));
  let delivered = null; for (let i = 0; i < 40 && !delivered; i++) { delivered = (await q(`select delivered_at from booking_verification_sessions where provider_verification_sid = $1`, [veSid]))[0]?.delivered_at ?? null; if (!delivered) await sleep(500); }
  check('the job worker applies it: the delivery is stamped on the verification', !!delivered, `job ${JSON.stringify(await q(`select status, last_error from jobs where tenant_id = $1 and idempotency_key like $2`, [T, `${veSid}:%`]))}`);

  // ── 6. the usage panel and Super Admin oversight ─────────────────────────────────────────────────────────────────
  const use = await own('GET', '/pos/settings/booking-phone-verification/usage?days=30');
  check('the salon\'s usage panel counts it: verified, approved without a code, locked, completed — no full number', use.status === 200 && use.body?.totals?.verified >= 3 && use.body?.totals?.overridden >= 1 && use.body?.totals?.locked >= 1 && use.body?.totals?.bookingsCompleted >= 4 && ![P_APP, P_PUB, P_VOICE, P_OVR].some((p) => JSON.stringify(use.body).includes(p.slice(2))), `status ${use.status} ${JSON.stringify(use.body?.totals ?? null)}`);
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: SA_PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const health = await sa('GET', '/super-admin/booking-verification/health?hours=1');
  const tenants = await sa('GET', '/super-admin/booking-verification/tenants?limit=500');
  check('Super Admin oversight counts it (numbers only) and lists the salon', sl.status === 200 && health.status === 200 && health.body?.overridden >= 1 && health.body?.locked >= 1 && tenants.status === 200 && Array.isArray(tenants.body) && tenants.body.some((t) => t.tenantId === T) && ![P_APP, P_PUB, P_VOICE, P_OVR].some((p) => JSON.stringify(health.body).includes(p.slice(2))), `login ${sl.status} health ${health.status} ${JSON.stringify(health.body)} tenants ${tenants.status}`);
  const modNoStep = await sa('POST', '/super-admin/booking-verification/module', { enabled: false, reason: 'live proof — must be refused without step-up' });
  check('switching the module off needs step-up (refused here, nothing changed)', modNoStep.status === 401 || modNoStep.status === 403 || modNoStep.status === 428, `status ${modNoStep.status} ${JSON.stringify(modNoStep.body).slice(0, 160)}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).slice(0, 400));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e)));
  if (process.env.SHOW_API_ERRORS) console.error(errs.split('\n').filter((l) => /"level":"(error|warn)"|Error|error/.test(l)).slice(-40).join('\n'));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} PASS${failed ? ` — ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
}
