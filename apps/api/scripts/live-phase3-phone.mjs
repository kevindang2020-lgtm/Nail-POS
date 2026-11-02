#!/usr/bin/env node
// live-phase3-phone.mjs — BUILD_PLAN Phase 3 (customer_phone_number_management), proved on the real API and PostgreSQL.
//
//   1. A RECEPTIONIST changes a customer's number at the POS: start → the code goes out through the salon's own Twilio
//      Verify → verify → the new number is active and verified, the old one retired, the customer row readable (never a
//      mask), future appointments follow the number, the OLD number's booking verification is revoked, the events are
//      on the outbox, and the old number is told (masked).
//   2. The CUSTOMER changes their own number in the app: the password is required; with it, the code is sent for the
//      customer's own salon location, verified, and the number is theirs.
//   3. The customer then moves the number they SIGN IN with: refused without the password; with it, the identity moves,
//      the old number is warned, every session ends (the next call is 401).
//   4. Super Admin oversight counts it (numbers only — never a phone number) and the sweep needs a reason.
//
// The ONE fake is Twilio Verify itself: a local HTTP service on a loopback port that issues and checks codes exactly as
// Twilio does (TWILIO_VERIFY_BASE_URL — honoured only outside production and only for loopback). The API holds no
// code; this script reads the code from the fake, as a customer would read it from their phone.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase3-phone.mjs   (apps/api built). Never point it at production:
// it creates a proof branch, staff, a customer account, Twilio credentials for the proof branch, and removes them all.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID, randomInt, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const { encryptSecret } = require('../dist/common/provider-crypto.js');
const { phoneKey, maskPhone } = require('@aipowersalon/customers');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3051), API = `http://127.0.0.1:${PORT}`, VERIFY_PORT = Number(process.env.VERIFY_PORT_PROOF || 3093);
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t), headers: r.headers }; } catch { return { status: r.status, body: t, headers: r.headers }; } };

// ── the fake Twilio Verify ─────────────────────────────────────────────────────────────────────────────────────────
const codes = new Map(); const verifyCalls = [];
const ACCOUNT = 'AC' + randomUUID().replace(/-/g, '').slice(0, 32), TOKEN = 'tok-' + randomUUID(), SERVICE = 'VA' + randomUUID().replace(/-/g, '').slice(0, 32);
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const form = new URLSearchParams(raw);
    const authOk = req.headers.authorization === 'Basic ' + Buffer.from(`${ACCOUNT}:${TOKEN}`).toString('base64');
    verifyCalls.push({ path: req.url, authOk, to: form.get('To') });
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!authOk || !String(req.url).startsWith(`/v2/Services/${SERVICE}/`)) return send(401, { message: 'Authenticate' });
    if (req.url.endsWith('/Verifications')) { const code = String(randomInt(100000, 1000000)); codes.set(form.get('To'), code); return send(201, { sid: 'VE' + randomUUID().replace(/-/g, '').slice(0, 32), status: 'pending' }); }
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
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase3 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
const existingCreds = (await q(`select count(*)::int as n from tenant_messaging_credentials where tenant_id = $1`, [T]))[0].n;
if (existingCreds) { console.error('this salon already has Twilio credentials — the proof will not touch them; run it on a salon without'); process.exit(2); }

const tag = String(Date.now()).slice(-6);
const B = randomUUID(), C1 = randomUUID(), C2 = randomUUID(), REC = randomUUID(), CU = randomUUID(), SA = randomUUID(), IDENT = randomUUID(), TECH = randomUUID(), APPT = randomUUID();
const OLD1 = `+1856557${tag.slice(-4)}`, NEW1 = `+1856558${tag.slice(-4)}`;
const OLD2 = `+1856559${tag.slice(-4)}`, NEW2 = `+1856554${tag.slice(-4)}`;
const C3 = randomUUID(), TK3 = randomUUID(), DEV = randomUUID(), DEV_TOKEN = randomBytes(24).toString('base64url');
const OLD3 = `+1856553${tag.slice(-4)}`, NEW3 = `+1856552${String((Number(tag.slice(-4)) + 1) % 10000).padStart(4, '0')}`;
const REC_EMAIL = `phase3-rec-${tag}@aipowersalon.test`, REC_PW = 'Phase3!Rec-' + randomUUID().slice(0, 8);
const CU_EMAIL = `phase3-cust-${tag}@aipowersalon.test`, CU_PW = 'Phase3!Cust-' + randomUUID().slice(0, 8);
const SA_EMAIL = `phase3-sa-${tag}@aipowersalon.test`, SA_PW = 'Phase3!SA-' + randomUUID().slice(0, 8);
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active','America/New_York')`, [B, T, `Live Phase3 Proof ${tag}`]);
await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, auth_token_last4, verify_service_sid, status, branch_id, last_validated_at) values ($1,'twilio',$2,$3,$4,$5,'configured',$6, now())`,
  [T, ACCOUNT, encryptSecret(TOKEN), TOKEN.slice(-4), SERVICE, B]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,'Rae','Desk','Rae Desk',$4,$5,'active','RECEPTION')`, [REC, T, B, REC_EMAIL, await hashPassword(REC_PW)]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [T, B, REC]).catch(() => undefined);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Rita','Desk','Rita Desk',$4,$4)`, [C1, T, B, OLD1]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tess','Phase','Tess Phase','active')`, [TECH, T, B]);
await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, appt_date, start_time, end_time, duration_minutes, status)
  values ($1,$2,$3,$4,$5,'Rita Desk',$6,(now() + interval '3 days')::date,'10:00','11:00',60,'booked')`, [APPT, T, B, TECH, C1, OLD1]);
await q(`insert into booking_verified_phones (tenant_id, phone_hash, phone_mask, provider, customer_id, verified_at) values ($1,$2,$3,'twilio_verify',$4, now())`, [T, phoneKey(OLD1), maskPhone(OLD1), C1]);
const cuHash = await hashPassword(CU_PW);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, password_hash, status, role) values ($1,$2,$3,'Cleo','App','Cleo App',$4,$5,$6,'active','CUSTOMER')`, [CU, T, B, CU_EMAIL, OLD2, cuHash]);
await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at) values ($1,$2,$3,$4,'Cleo','App','Cleo App',$5,$5, now())`, [C2, T, B, CU, OLD2]);
await q(`insert into customer_identities (id, normalized_phone, email, full_name, password_hash, phone_verified_at) values ($1,$2,$3,'Cleo App',$4, now())`, [IDENT, OLD2, CU_EMAIL, cuHash]);
await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDENT, T, CU, C2]);
// the customer display: a paired device on the proof branch and a checkout for customer 3
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Dee','Display','Dee Display',$4,$4)`, [C3, T, B, OLD3]);
await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status, device_token_hash, created_at, last_seen_at) values ($1,$2,$3,'Live Phase3 Display','paired',$4, now(), now())`, [DEV, T, B, createHash('sha256').update(DEV_TOKEN).digest('hex')]);
await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5, now())`, [TK3, T, B, C3, TECH]);
const svc3 = (await q(`select id, name, price_cents from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 1`, [T]))[0];
if (!svc3) { console.error('the salon needs an active service'); process.exit(2); }
await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,30,$7)`, [T, B, TK3, svc3.id, TECH, svc3.name, Number(svc3.price_cents)]);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Platform', 'Pat Platform', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, await hashPassword(SA_PW)]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TWILIO_VERIFY_BASE_URL: `http://127.0.0.1:${VERIFY_PORT}` };
for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'PROCESS_ROLE']) delete env[k];
let proc = null; let errs = '';
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  const sessions = (await q(`select id from customer_phone_update_sessions where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, [C1, C2, C3]])).map((r) => String(r.id));
  await q(`delete from jobs where tenant_id = $1 and idempotency_key = any($2::text[])`, [T, sessions]).catch(() => undefined);
  await q(`delete from jobs where tenant_id = $1 and payload::text like any($2::text[])`, [T, sessions.map((s) => `%${s}%`)]).catch(() => undefined);
  await q(`delete from outbox_events where tenant_id = $1 and (aggregate_id::text = any($2::text[]) or payload_json::text like any($3::text[]))`, [T, [C1, C2, C3, ...sessions], [C1, C2, C3].map((c) => `%${c}%`)]).catch(() => undefined);
  const notes = (await q(`select id from notifications where tenant_id = $1 and to_address = any($2::text[])`, [T, [OLD1, NEW1, OLD2, NEW2, OLD3, NEW3]])).map((r) => String(r.id));
  await q(`delete from outbox_events where tenant_id = $1 and aggregate_id::text = any($2::text[])`, [T, notes]).catch(() => undefined);
  await q(`delete from notifications where id = any($1::uuid[])`, [notes]).catch(() => undefined);
  await q(`delete from owner_alerts where tenant_id = $1 and (branch_id = $2 or metadata::text like any($3::text[]))`, [T, B, [C1, C2, C3].map((c) => `%${c}%`)]).catch(() => undefined);
  await q(`delete from booking_verified_phones where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, [C1, C2, C3]]).catch(() => undefined);
  await q(`delete from customer_identity_links where id is not null and identity_id = $1`, [IDENT]).catch(() => undefined);
  await q(`delete from customer_identities where id = $1`, [IDENT]).catch(() => undefined);
  await q(`delete from tenant_messaging_credentials where tenant_id = $1 and branch_id = $2`, [T, B]).catch(() => undefined);
  for (const u of [REC, CU, SA]) {
    for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  }
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[REC_EMAIL, CU_EMAIL, SA_EMAIL]]).catch(() => undefined);
  await q(`delete from user_branch_access where user_id = $1`, [REC]).catch(() => undefined);
  await q(`update customers set user_id = null where id = $1`, [C2]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [[REC, CU, SA]]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[])) + (select count(*)::int from customers where id = any($3::uuid[])) + (select count(*)::int from customer_display_devices where id = $6)
      + (select count(*)::int from customer_identities where id = $4) + (select count(*)::int from tenant_messaging_credentials where tenant_id = $5) + (select count(*)::int from customer_phone_update_sessions where customer_id = any($3::uuid[])) as n`,
    [B, [REC, CU, SA], [C1, C2, C3], IDENT, T, DEV]))[0].n;
  check('the proof branch, staff, customers, account, identity, display, Twilio credentials and phone sessions are removed', a.removed && left === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
  await client.end();
  fake.close();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 5 * 60_000);

const login = async (body) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
};
const as = (cookie) => (method, path, body) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
const codeFor = (e164) => codes.get(e164);
const ok2 = (s) => s === 200 || s === 201;

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL (with the loopback Twilio Verify)', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // ── 1. the receptionist ──────────────────────────────────────────────────────────────────────────────────────────
  const rl = await login({ portal: 'tenant', salonCode: SALON, identifier: REC_EMAIL, password: REC_PW });
  check('a receptionist signs in to the POS', rl.status === 200 && !!rl.cookie, `status ${rl.status}`);
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: rl.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  // a cookie jar: the branch-selected session REPLACES the sign-in one (same cookie name), as a browser does
  const jar = new Map(); for (const c of [...rl.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  const rec = as([...jar.values()].join('; '));
  const me = await rec('GET', '/auth/me');
  check('the receptionist works at the proof branch', sel.status === 200 && JSON.stringify(me.body ?? {}).includes(B), `select ${sel.status}; me ${me.status} ${JSON.stringify(me.body).slice(0, 200)}`);
  const st0 = await rec('GET', `/pos/customers/${C1}/phone/status`);
  check('GET phone/status shows the readable number and its proof', st0.status === 200 && st0.body?.phone?.display && !st0.body.phone.display.includes('•') && st0.body.phone.verified === false, `status ${st0.status} ${JSON.stringify(st0.body?.phone ?? null)}`);
  const start = await rec('POST', `/pos/customers/${C1}/phone`, { phone: NEW1, expectedVersion: st0.body?.recordVersion, idempotencyKey: `proof-${tag}-1` });
  const sid1 = start.body?.sessionId;
  check('start saves the number as pending (unverified)', ok2(start.status) && !!sid1 && start.body.state === 'pending_phone_saved', `status ${start.status} ${JSON.stringify(start.body).slice(0, 200)}`);
  const replay = await rec('POST', `/pos/customers/${C1}/phone`, { phone: NEW1, expectedVersion: st0.body?.recordVersion, idempotencyKey: `proof-${tag}-1` });
  check('the same request replayed returns the same change (idempotent, not a 500)', ok2(replay.status) && replay.body?.sessionId === sid1, `status ${replay.status}`);
  const send1 = await rec('POST', `/pos/customers/${C1}/phone/${sid1}/send`, { phone: NEW1 });
  check('the code goes out through the SALON\'s Twilio Verify (its own credentials)', ok2(send1.status) && send1.body?.state === 'verification_sent' && !!codeFor(NEW1) && verifyCalls.some((c) => c.authOk && c.to === NEW1), `status ${send1.status} ${JSON.stringify(send1.body).slice(0, 160)}`);
  const wrong = await rec('POST', `/pos/customers/${C1}/phone/${sid1}/verify`, { phone: NEW1, code: codeFor(NEW1) === '000000' ? '111111' : '000000' });
  check('a wrong code is refused and nothing changes', ok2(wrong.status) && wrong.body?.activated === false && (await q(`select normalized_phone from customers where id = $1`, [C1]))[0].normalized_phone === OLD1, `status ${wrong.status} ${JSON.stringify(wrong.body).slice(0, 160)}`);
  const v1 = await rec('POST', `/pos/customers/${C1}/phone/${sid1}/verify`, { phone: NEW1, code: codeFor(NEW1) });
  check('the right code activates the new number', ok2(v1.status) && v1.body?.activated === true, `status ${v1.status} ${JSON.stringify(v1.body).slice(0, 200)}`);
  const row1 = (await q(`select normalized_phone, phone_display, phone_verified_at from customers where id = $1`, [C1]))[0];
  check('the customer row: new number, readable display (never a mask), verified', row1.normalized_phone === NEW1 && !String(row1.phone_display).includes('•') && /\d{3}.*\d{4}/.test(row1.phone_display) && row1.phone_verified_at != null, JSON.stringify(row1));
  const phones1 = await q(`select status from customer_phones where customer_id = $1 order by created_at`, [C1]);
  check('customer_phones: exactly one active (verified) number; the old one retired', phones1.filter((p) => p.status.startsWith('active')).length === 1 && phones1.some((p) => p.status === 'active_verified') && phones1.some((p) => ['replaced', 'inactive'].includes(p.status)), JSON.stringify(phones1));
  const appt = (await q(`select customer_phone from pos_tech_appointments where id = $1`, [APPT]))[0];
  check('the future appointment now carries the new number', appt?.customer_phone === NEW1, JSON.stringify(appt ?? null));
  const bvp = await q(`select revoked_at from booking_verified_phones where tenant_id = $1 and phone_hash = $2`, [T, phoneKey(OLD1)]);
  check('the OLD number\'s booking verification is revoked', bvp.length === 1 && bvp[0].revoked_at != null, JSON.stringify(bvp));
  const bvpNew = await q(`select revoked_at from booking_verified_phones where tenant_id = $1 and phone_hash = $2`, [T, phoneKey(NEW1)]);
  check('the NEW number counts as verified for booking (proved by this code)', bvpNew.length === 1 && bvpNew[0].revoked_at == null, JSON.stringify(bvpNew));
  let evs = [];
  for (let i = 0; i < 20; i++) { evs = (await q(`select event_type, payload_json::text as p from outbox_events where tenant_id = $1 and payload_json::text like $2`, [T, `%${C1}%`])); if (evs.some((e) => e.event_type === 'customer.phone_sync_completed')) break; await sleep(250); }
  const types = new Set(evs.map((e) => e.event_type));
  check('customer.phone_update_requested → verified → activated → sync_completed are on the outbox', ['customer.phone_update_requested', 'customer.phone_verified', 'customer.phone_activated', 'customer.phone_sync_completed'].every((t) => types.has(t)), [...types].join(', '));
  check('no event carries a full phone number', evs.every((e) => !e.p.includes(NEW1.slice(2)) && !e.p.includes(OLD1.slice(2))));
  let oldNote = null;
  for (let i = 0; i < 12 && !oldNote; i++) { oldNote = (await q(`select status, body from notifications where tenant_id = $1 and to_address = $2 order by created_at desc limit 1`, [T, OLD1]))[0] ?? null; if (!oldNote) await sleep(250); }
  if (!oldNote) console.error('old-number notice missing:', JSON.stringify({ prev: (await q(`select previous_phone_id, state from customer_phone_update_sessions where id = $1`, [sid1]))[0], phones: await q(`select id, status, normalized_phone from customer_phones where customer_id = $1`, [C1]), recent: await q(`select to_address, status, failure_reason from notifications where tenant_id = $1 and created_at > now() - interval '2 minutes'`, [T]) }));
  check('the OLD number is told, masked (simulated sender here — no salon SMS number configured)', oldNote?.status === 'simulated' && !oldNote.body.includes(NEW1.slice(2)) && oldNote.body.includes(NEW1.slice(-4)), JSON.stringify(oldNote ?? null).slice(0, 200));
  const st1 = await rec('GET', `/pos/customers/${C1}/phone/status`);
  check('status now: verified by SMS, no change open', st1.status === 200 && st1.body?.phone?.verified === true && st1.body.openChange === null, JSON.stringify(st1.body?.phone ?? null));
  const recApprove = await rec('POST', `/pos/customers/${C1}/phone/${sid1}/retry-sync`, {});
  check('a receptionist cannot use a manager action (retry-sync → 403)', recApprove.status === 403, `status ${recApprove.status}`);

  // ── 1b. the code typed on the CUSTOMER DISPLAY ───────────────────────────────────────────────────────────────────
  const dev = (method, path, body, token = DEV_TOKEN) => fetch(API + '/customer-display/device' + path, { method, headers: { 'x-device-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
  const sent3 = await rec('POST', `/pos/checkout/tickets/${TK3}/send-to-customer-display`);
  check('the receptionist sends customer 3\'s checkout to the display', ok2(sent3.status), `status ${sent3.status} ${JSON.stringify(sent3.body).slice(0, 160)}`);
  const st3 = await rec('GET', `/pos/customers/${C3}/phone/status`);
  const p3 = await rec('POST', `/pos/customers/${C3}/phone`, { phone: NEW3, expectedVersion: st3.body?.recordVersion });
  const sid3 = p3.body?.sessionId;
  const early = await rec('POST', `/pos/customers/${C3}/phone/${sid3}/to-display`, {});
  check('the pad cannot go up before a code was sent (refused: invalid_state)', (early.status === 400 || early.status === 409) && early.body?.code === 'invalid_state', `status ${early.status} ${early.body?.code}`);
  await rec('POST', `/pos/customers/${C3}/phone/${sid3}/send`, { phone: NEW3 });
  const td = await rec('POST', `/pos/customers/${C3}/phone/${sid3}/to-display`, {});
  check('staff put the code pad on the customer display', ok2(td.status) && td.body?.ok === true, `status ${td.status} ${JSON.stringify(td.body).slice(0, 160)}`);
  const cur = await dev('GET', '/current');
  check('the display state carries the pad with the MASKED number only', cur.status === 200 && cur.body?.phoneVerification?.maskedPhone?.endsWith(NEW3.slice(-4)) && !JSON.stringify(cur.body).includes(NEW3.slice(2)), `status ${cur.status} ${JSON.stringify(cur.body?.phoneVerification ?? null)}`);
  const badTok = await dev('POST', '/phone-code', { code: codeFor(NEW3) }, 'not-a-device');
  check('a request without the display\'s credential is refused', badTok.status === 401 || badTok.status === 403, `status ${badTok.status}`);
  const wrong3 = await dev('POST', '/phone-code', { code: codeFor(NEW3) === '000000' ? '111111' : '000000' });
  check('a wrong code on the display is refused; the number is unchanged', ok2(wrong3.status) && wrong3.body?.ok === false && (await q(`select normalized_phone from customers where id = $1`, [C3]))[0].normalized_phone === OLD3, `status ${wrong3.status} ${JSON.stringify(wrong3.body)}`);
  const right3 = await dev('POST', '/phone-code', { code: codeFor(NEW3) });
  check('the right code typed on the display activates the new number', ok2(right3.status) && right3.body?.ok === true && (await q(`select normalized_phone from customers where id = $1`, [C3]))[0].normalized_phone === NEW3, `status ${right3.status} ${JSON.stringify(right3.body)}`);
  const after3 = await dev('GET', '/current');
  check('the pad is gone from the display', after3.status === 200 && !after3.body?.phoneVerification, JSON.stringify(after3.body?.phoneVerification ?? null));

  // ── 2. the customer, in the app ──────────────────────────────────────────────────────────────────────────────────
  const cl = await login({ portal: 'customer', identifier: CU_EMAIL, password: CU_PW });
  check('the customer signs in to the app', cl.status === 200 && !!cl.cookie, `status ${cl.status}`);
  const cust = as(cl.cookie);
  const cs0 = await cust('GET', '/customer/profile/phone/status');
  check('the customer sees their own number MASKED only', cs0.status === 200 && cs0.body?.phone?.display === null && String(cs0.body?.phone?.masked).includes(OLD2.slice(-4)), `status ${cs0.status} ${JSON.stringify(cs0.body?.phone ?? null)}`);
  const noPw = await cust('POST', '/customer/profile/phone', { phone: NEW2 });
  check('without the password the change is refused (401 reauth_required)', noPw.status === 401 && noPw.body?.code === 'reauth_required', `status ${noPw.status} ${JSON.stringify(noPw.body).slice(0, 160)}`);
  const cstart = await cust('POST', '/customer/profile/phone', { phone: NEW2, currentPassword: CU_PW, idempotencyKey: `proof-${tag}-2` });
  const sid2 = cstart.body?.sessionId;
  check('with the password the change starts; the old number stays live', ok2(cstart.status) && !!sid2 && (await q(`select normalized_phone from customers where id = $1`, [C2]))[0].normalized_phone === OLD2, `status ${cstart.status} ${JSON.stringify(cstart.body).slice(0, 200)}`);
  const sb = (await q(`select branch_id from customer_phone_update_sessions where id = $1`, [sid2]))[0];
  check('the customer\'s change happens at their own salon location', sb?.branch_id === B, JSON.stringify(sb ?? null));
  const csend = await cust('POST', `/customer/profile/phone/${sid2}/send`, { phone: NEW2 });
  check('the code is sent to the new number', ok2(csend.status) && csend.body?.state === 'verification_sent' && !!codeFor(NEW2), `status ${csend.status} ${JSON.stringify(csend.body).slice(0, 200)}`);
  const cv = await cust('POST', `/customer/profile/phone/${sid2}/verify`, { phone: NEW2, code: codeFor(NEW2) });
  check('the customer verifies; the new number is theirs', ok2(cv.status) && cv.body?.activated === true && (await q(`select normalized_phone from customers where id = $1`, [C2]))[0].normalized_phone === NEW2, `status ${cv.status} ${JSON.stringify(cv.body).slice(0, 200)}`);

  // ── 3. the sign-in number ────────────────────────────────────────────────────────────────────────────────────────
  const lnBad = await cust('POST', '/customer/profile/phone/login-number', { phone: NEW2, currentPassword: 'not-my-password' });
  check('moving the sign-in number with a wrong password is refused (401)', lnBad.status === 401, `status ${lnBad.status}`);
  const lnOther = await cust('POST', '/customer/profile/phone/login-number', { phone: NEW1, currentPassword: CU_PW });
  check('a number this customer did NOT just prove cannot become their sign-in number (409 not_verified)', lnOther.status === 409 && lnOther.body?.code === 'not_verified', `status ${lnOther.status} ${JSON.stringify(lnOther.body).slice(0, 160)}`);
  const ln = await cust('POST', '/customer/profile/phone/login-number', { phone: NEW2, currentPassword: CU_PW });
  check('with the password and the proven number, the sign-in number moves', ok2(ln.status) && ln.body?.ok === true, `status ${ln.status} ${JSON.stringify(ln.body).slice(0, 160)}`);
  const ident = (await q(`select normalized_phone from customer_identities where id = $1`, [IDENT]))[0];
  check('the identity now signs in with the new number', ident?.normalized_phone === NEW2, JSON.stringify(ident ?? null));
  const warn = (await q(`select status, body from notifications where to_address = $1 order by created_at desc limit 1`, [OLD2]))[0];
  check('the OLD number is warned before the change (masked new number, in the salon\'s ledger)', !!warn && warn.status === 'simulated' && warn.body.includes(NEW2.slice(-4)) && !warn.body.includes(NEW2.slice(2)), JSON.stringify(warn ?? null).slice(0, 200));
  // Revocation reaches every API process within the session store's 15 s cache (the same bound as a password reset).
  let after = null;
  for (let i = 0; i < 20; i++) { after = await cust('GET', '/customer/profile/phone/status'); if (after.status === 401) break; await sleep(1000); }
  check('every session ended — calls are refused (401) within the 15 s revocation bound', after.status === 401, `status ${after.status}`);
  const rt = await q(`select count(*)::int as n from refresh_tokens where user_id = $1 and revoked_at is null`, [CU]);
  check('no refresh token of the account is left usable', rt[0].n === 0, JSON.stringify(rt[0]));

  // ── 4. Super Admin ───────────────────────────────────────────────────────────────────────────────────────────────
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: SA_PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const ov = await sa('GET', `/super-admin/customer-phone/oversight?hours=1&tenantId=${T}`);
  check('Super Admin oversight counts the two verified changes', ov.status === 200 && Number(ov.body?.verified) >= 2 && Number(ov.body?.updatesRequested) >= 2, `status ${ov.status} ${JSON.stringify(ov.body).slice(0, 220)}`);
  check('oversight returns no phone number anywhere', ov.status === 200 && ![NEW1, NEW2, OLD1, OLD2].some((p) => JSON.stringify(ov.body).includes(p.slice(2))));
  const byT = await sa('GET', '/super-admin/customer-phone/oversight/tenants?hours=1');
  check('per-salon oversight lists this salon', byT.status === 200 && Array.isArray(byT.body) && byT.body.some((r) => r.tenantId === T), `status ${byT.status}`);
  const sw0 = await sa('POST', '/super-admin/customer-phone/sweep', { reason: 'x' });
  check('the sweep without a reason is refused (400)', sw0.status === 400, `status ${sw0.status}`);
  const sw = await sa('POST', '/super-admin/customer-phone/sweep', { reason: 'Phase 3 live proof sweep' });
  check('the sweep with a reason runs and reports what it did', ok2(sw.status) && sw.body?.ok === true && typeof sw.body.expired === 'number', `status ${sw.status} ${JSON.stringify(sw.body)}`);
  const recSa = await rec('GET', '/super-admin/customer-phone/oversight');
  check('a receptionist cannot read platform oversight', recSa.status === 401 || recSa.status === 403, `status ${recSa.status}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.message || e));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  if (process.env.API_LOG) { const fs = await import('node:fs'); fs.writeFileSync(process.env.API_LOG, errs); }
  for (const r of results) console.log(r);
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
