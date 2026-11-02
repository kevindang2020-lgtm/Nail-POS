#!/usr/bin/env node
// live-phase5-deals.mjs — BUILD_PLAN Phase 5 (deals_engine), proved on the real API and PostgreSQL. Nothing is stubbed:
// staff, customers and a Super Admin sign in and call the same endpoints the apps call. The exit criteria:
//   • OVERSELL IS IMPOSSIBLE under concurrency on real Postgres — 12 customers book a deal capped at 3 at the same
//     moment: exactly 3 get it; 6 registers apply a deal capped at 2 at the same moment: exactly 2 get it.
//   • REFUND REVERSAL, live — a paid ticket's deal is redeemed at payment and reversed by the refund (the place comes
//     back, the count goes down); a refund of ONE service reverses only what that service carried.
// Also: catalog prices (a client price is ignored), whole-number percentages, guests browse deals (no login), a view is
// counted once per visitor, the customer app's cancel gives a booked place back, a receptionist applies deals (and
// still cannot type a manual discount), "why not" reasons, best deal, hashed single-use codes and the code-guessing
// limit, itemized discounts on the ticket, the Super Admin suspension (reason required; booked places given back),
// the phone receptionist's deals, the owner app's summary, the CSV export and the persisted audit.
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase5-deals.mjs   (apps/api built). Never point it at production:
// it creates a proof branch, staff, 13 customer accounts, a voice key and a Super Admin, and removes them all.
import { spawn } from 'node:child_process';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3055, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 220);

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase5 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID(), SA = randomUUID(), VKID = randomUUID(), CW = randomUUID();
const GEL = randomUUID(), PEDI = randomUUID();
const N = 12;
const techs = Array.from({ length: N + 1 }, () => randomUUID());
const custs = Array.from({ length: N + 1 }, (_, i) => ({ user: randomUUID(), customer: randomUUID(), ident: randomUUID(), email: `phase5-c${i}-${tag}@aipowersalon.test`, phone: `+1856570${String(i).padStart(2, '0')}${tag.slice(-2)}` }));
const PW = 'Phase5!' + randomUUID().slice(0, 10);
const OWN_EMAIL = `phase5-owner-${tag}@aipowersalon.test`, REC_EMAIL = `phase5-rec-${tag}@aipowersalon.test`, SA_EMAIL = `phase5-sa-${tag}@aipowersalon.test`;
const VOICE_KEY = 'vk_test_' + randomBytes(24).toString('base64url');
const LAT = 41.4567, LNG = -71.9876;   // the proof branch's map pin
const cat = (await q(`select category_id from services where tenant_id = $1 and status = 'active' and category_id is not null limit 1`, [T]))[0]?.category_id;
if (!cat) { console.error('the salon needs an active service (for its category)'); process.exit(2); }
const day = (() => { const d = new Date(Date.now() + 9 * 86_400_000); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const hash = await hashPassword(PW);

await q(`insert into branches (id, tenant_id, name, status, timezone, latitude, longitude, address) values ($1,$2,$3,'active','America/New_York',$4,$5,'5 Proof Way')`, [B, T, `Live Phase5 Proof ${tag}`, LAT, LNG]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Live P5 Gel',45,5000,'active'), ($5,$2,$3,$4,'Live P5 Pedi',45,3000,'active')`, [GEL, T, B, cat, PEDI]);
for (const [u, email, role, fn] of [[OWN, OWN_EMAIL, 'OWNER', 'Olga'], [REC, REC_EMAIL, 'RECEPTION', 'Rae']]) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Five',$4 || ' Five',$5,$6,'active',$7)`, [u, T, B, fn, email, hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, u, role === 'OWNER' ? 'manager' : 'staff']).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [T, B, u]).catch(() => undefined));
}
for (const [i, t] of techs.entries()) {
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tech',$4,'Tech ' || $4,'active')`, [t, T, B, `P5-${i}`]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t, GEL]);
}
for (const c of custs) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, password_hash, status, role) values ($1,$2,$3,'Cust','Five','Cust Five',$4,$5,$6,'active','CUSTOMER')`, [c.user, T, B, c.email, c.phone, hash]);
  await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at) values ($1,$2,$3,$4,'Cust','Five','Cust Five',$5,$5, now())`, [c.customer, T, B, c.user, c.phone]);
  await q(`insert into customer_identities (id, normalized_phone, email, full_name, password_hash, phone_verified_at) values ($1,$2,$3,'Cust Five',$4, now())`, [c.ident, c.phone, c.email, hash]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [c.ident, T, c.user, c.customer]);
}
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Walk','In','Walk In')`, [CW, T, B]);
await q(`insert into voice_integration_keys (id, tenant_id, branch_id, label, provider, prefix, secret_hash) values ($1,$2,$3,'Live Phase5 voice','retell',$4,$5)`, [VKID, T, B, VOICE_KEY.slice(0, 12), createHash('sha256').update(VOICE_KEY).digest('hex')]);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Five', 'Pat Five', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);

const tickets = [];
const ticket = async (customerId = CW) => {
  const id = randomUUID(); tickets.push(id);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,0, now())`, [id, T, B, customerId, techs[0]]);
  const lines = [];
  for (const [sid, name, cents] of [[GEL, 'Live P5 Gel', 5000], [PEDI, 'Live P5 Pedi', 3000]]) {
    const r = await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,45,$7) returning id`, [T, B, id, sid, techs[0], name, cents]);
    lines.push(r[0].id);
  }
  return { id, gelLine: lines[0], pediLine: lines[1] };
};

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'DEALS_LIFECYCLE_ENABLED']) delete env[k];
let proc = null; let errs = '';
const dealIds = [];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  const ids = dealIds.length ? dealIds : ['00000000-0000-0000-0000-000000000000'];
  const allUsers = [OWN, REC, SA, ...custs.map((c) => c.user)];
  await q(`delete from deal_redemptions where tenant_id = $1 and deal_id = any($2::uuid[])`, [T, ids]).catch(() => undefined);
  for (const t of ['deal_redemption_holds', 'deal_coupon_codes', 'deal_coupon_batches', 'deal_versions', 'deal_daily_stats', 'deal_analytics_events', 'deal_services', 'deal_saves', 'deal_approvals'])
    await q(`delete from ${t} where tenant_id = $1 and deal_id = any($2::uuid[])`, [T, ids]).catch(() => undefined);
  await q(`delete from deal_code_lookup_failures where tenant_id = $1 and actor_key = any($2::text[])`, [T, allUsers.map((u) => `user:${u}`)]).catch(() => undefined);
  await q(`delete from outbox_events where tenant_id = $1 and (aggregate_id::text = any($2::text[]) or aggregate_id::text = any($3::text[]))`, [T, ids, tickets]).catch(() => undefined);
  await q(`delete from deals where tenant_id = $1 and id = any($2::uuid[])`, [T, ids]).catch(() => undefined);
  for (const c of custs) { await q(`delete from customer_identity_links where identity_id = $1`, [c.ident]).catch(() => undefined); await q(`delete from customer_identities where id = $1`, [c.ident]).catch(() => undefined); }
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[OWN_EMAIL, REC_EMAIL, SA_EMAIL, ...custs.map((c) => c.email)]]).catch(() => undefined);
  await q(`delete from user_branch_access where user_id = any($1::uuid[])`, [[OWN, REC]]).catch(() => undefined);
  await q(`update customers set user_id = null where id = any($1::uuid[])`, [custs.map((c) => c.customer)]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[])) + (select count(*)::int from customers where id = any($3::uuid[]))
      + (select count(*)::int from deals where id = any($4::uuid[])) + (select count(*)::int from deal_redemption_holds where deal_id = any($4::uuid[])) + (select count(*)::int from deal_redemptions where deal_id = any($4::uuid[]))
      + (select count(*)::int from deal_coupon_codes where deal_id = any($4::uuid[])) + (select count(*)::int from tickets where id = any($5::uuid[])) + (select count(*)::int from voice_integration_keys where id = $6)
      + (select count(*)::int from customer_identities where id = any($7::uuid[])) as n`,
    [B, allUsers, [...custs.map((c) => c.customer), CW], ids, tickets.length ? tickets : ['00000000-0000-0000-0000-000000000000'], VKID, custs.map((c) => c.ident)]))[0].n;
  check('the proof branch, staff, 13 customer accounts, deals, places, uses, codes, tickets and the voice key are removed', a.removed && left === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 12 * 60_000);

const login = async (body, ip) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
};
const staff = async (email) => {
  const l = await login({ portal: 'tenant', salonCode: SALON, identifier: email, password: PW });
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: l.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(); for (const c of [...l.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as([...jar.values()].join('; ')) };
};
const as = (cookie, extra = {}) => (method, path, body, hdr = {}) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra, ...hdr }, body: body ? JSON.stringify(body) : undefined }).then(j);
const guest = (method, path, body, ip = '10.77.0.1') => fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: body ? JSON.stringify(body) : undefined }).then(j);
const dealRow = async (id) => (await q(`select status, redemption_count, suspended_at, suspended_reason, original_price_cents, final_price_cents from deals where id = $1`, [id]))[0];
const uses = async (id) => (await q(`select status, count(*)::int as n from deal_redemptions where deal_id = $1 group by status`, [id])).reduce((m, r) => ({ ...m, [r.status]: r.n }), {});
const places = async (id) => (await q(`select status, count(*)::int as n from deal_redemption_holds where deal_id = $1 group by status`, [id])).reduce((m, r) => ({ ...m, [r.status]: r.n }), {});
const events = async (type, aggregateIds) => (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = $2 and (payload_json->>'dealId' = any($3::text[]) or aggregate_id::text = any($3::text[]))`, [T, type, aggregateIds]))[0].n;
const waitFor = async (fn, ms = 20_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(300); } return false; };

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // ── 1. the owner builds deals from the catalog ─────────────────────────────────────────────────────────────────
  const own = await staff(OWN_EMAIL);
  check('the owner signs in and works at the proof branch', own.ok, own.detail);
  const live = async (body) => {
    const c = await own.call('POST', '/pos/deals', { branchId: B, ...body });
    if (!ok2(c.status)) return c;
    dealIds.push(c.body.id);
    await own.call('POST', `/pos/deals/${c.body.id}/submit`); await own.call('POST', `/pos/deals/${c.body.id}/approve`, { reason: 'live proof' });
    const p = await own.call('POST', `/pos/deals/${c.body.id}/publish`);
    return { status: p.status, body: { ...c.body, ...p.body } };
  };
  const bad = await own.call('POST', '/pos/deals', { branchId: B, title: 'Odd', discountType: 'percent', discountPercent: 12.5, serviceIds: [GEL] });
  check('bug 21: a fractional percentage is a 400 with the reason (it used to be a 500)', bad.status === 400 && /whole number/i.test(short(bad.body)), `${bad.status} ${short(bad.body)}`);
  const CAPPED = await live({ title: 'Live P5 Gel 20% (3 only)', discountType: 'percent', discountPercent: 20, serviceIds: [GEL], maxRedemptions: 3, originalPriceCents: 1 });
  const capped = await dealRow(CAPPED.body?.id);
  check('bug 8: the deal is priced from the CATALOG ($50 → $40) — the client\'s price (1¢) is ignored; it is live', ok2(CAPPED.status) && CAPPED.body.status === 'active' && Number(capped?.original_price_cents) === 5000 && Number(capped?.final_price_cents) === 4000, `${CAPPED.status} ${short(capped)}`);
  const MEMBERS = await live({ title: 'Live P5 Members Pedi', discountType: 'percent', discountPercent: 30, serviceIds: [PEDI], memberOnly: true });
  const WALKIN = await live({ title: 'Live P5 $5 off', discountType: 'fixed', discountCents: 500, maxRedemptions: 10 });
  const RUSH = await live({ title: 'Live P5 Register rush (2 only)', discountType: 'fixed', discountCents: 700, maxRedemptions: 2 });
  const PHONE = await live({ title: 'Live P5 Phone special', discountType: 'percent', discountPercent: 10, serviceIds: [PEDI], channels: ['ai_receptionist'] });
  const COUPON = await live({ kind: 'coupon', title: 'Live P5 $10 coupon', discountType: 'fixed', discountCents: 1000 });
  check('five more deals and a coupon are live (members-only, $5 off, a register rush capped at 2, a phone special, a $10 coupon)',
    [MEMBERS, WALKIN, RUSH, PHONE, COUPON].every((d) => ok2(d.status) && d.body?.status === 'active'), [MEMBERS, WALKIN, RUSH, PHONE, COUPON].map((d) => `${d.status}/${d.body?.status}`).join(' '));
  const gen = await own.call('POST', `/pos/deals/${COUPON.body.id}/coupons/generate`, { quantity: 2, singleUse: true, prefix: 'LIVE' });
  const codes = gen.body?.codes ?? [];
  const stored = await q(`select code_hash, code_hint from deal_coupon_codes where deal_id = $1`, [COUPON.body.id]);
  check('single-use codes come back ONCE; only their hash and last four are stored', ok2(gen.status) && codes.length === 2 && stored.length === 2 && stored.every((s) => !codes.includes(s.code_hash) && /^[0-9a-f]{64}$/.test(s.code_hash)) && codes.every((c) => stored.some((s) => c.endsWith(s.code_hint))),
    `${gen.status} ${codes.length} codes, ${stored.length} stored`);
  const listed = await own.call('GET', `/pos/deals/${COUPON.body.id}/coupons`);
  check('… and the list shows only the last four', listed.status === 200 && !codes.some((c) => JSON.stringify(listed.body).includes(c)), `${listed.status}`);

  // ── 2. a guest browses (bug 20), a view is counted once (bug 15) ────────────────────────────────────────────────
  const near = await guest('GET', `/customer/deals/nearby?lat=${LAT}&lng=${LNG}&radiusMiles=5`);
  const nearIds = (Array.isArray(near.body) ? near.body : near.body?.items ?? []).map((d) => d.id ?? d.dealId);
  check('bug 20: a GUEST (no session) sees the live deals near them — the phone-only special is not in the app feed', near.status === 200 && nearIds.includes(CAPPED.body.id) && !nearIds.includes(PHONE.body.id), `${near.status} ${nearIds.length} deals`);
  const v1 = await guest('GET', `/customer/deals/public/${CAPPED.body.id}`); const v2 = await guest('GET', `/customer/deals/public/${CAPPED.body.id}`);
  await sleep(300);
  const views = (await q(`select count(*)::int as n from deal_analytics_events where deal_id = $1 and event_type = 'view'`, [CAPPED.body.id]))[0].n;
  check('bug 15: the deal page opens for a guest and counts as ONE view (a refresh is not a view)', v1.status === 200 && v2.status === 200 && v1.body?.terms !== undefined && views === 1, `${v1.status}/${v2.status} views=${views}`);
  const est = await guest('POST', `/customer/deals/public/${CAPPED.body.id}/estimate`, { serviceIds: [GEL, PEDI] });
  check('a guest\'s estimate prices the deal on the catalog: $80 → $70 (20% of the gel only)', ok2(est.status) && est.body?.subtotalCents === 8000 && est.body?.discountCents === 1000, `${est.status} ${short(est.body)}`);
  const saved = await guest('GET', '/customer/deals/saved');
  check('saved deals still need a session (401)', saved.status === 401, `${saved.status}`);

  // ── 3. OVERSELL under concurrency — 12 customers, a deal capped at 3 (bug 1) ────────────────────────────────────
  const sessions = [];
  for (const [i, c] of custs.entries()) { const l = await login({ portal: 'customer', identifier: c.email, password: PW }, `10.88.0.${i + 1}`); sessions.push(as(l.cookie, { 'x-forwarded-for': `10.88.0.${i + 1}` })); }
  const booking = (i) => sessions[i]('POST', '/customer/booking', { serviceId: GEL, technicianId: techs[i], date: day, startTime: '10:00', salonId: B, dealId: CAPPED.body.id });
  const race = await Promise.all(Array.from({ length: N }, (_, i) => booking(i)));
  const won = race.map((r, i) => ({ r, i })).filter((x) => ok2(x.r.status));
  const lost = race.filter((r) => r.status === 409);
  const held = await places(CAPPED.body.id);
  const appts = (await q(`select count(*)::int as n from pos_tech_appointments where branch_id = $1 and status = 'booked'`, [B]))[0].n;
  check('OVERSELL IMPOSSIBLE: 12 customers book a deal capped at 3 at the same moment — exactly 3 get it, 9 hear "sold out"',
    won.length === 3 && lost.length === 9 && lost.every((r) => /sold out/i.test(short(r.body))) && (held.consumed ?? 0) + (held.held ?? 0) === 3 && appts === 3,
    `won ${won.length} lost ${lost.length} places ${short(held)} appointments ${appts} statuses ${race.map((r) => r.status).join(',')}`);

  // ── 4. the customer app's cancel gives the place back (bug 12) ─────────────────────────────────────────────────
  const first = won[0];
  const cancel = await sessions[first.i]('POST', `/customer/appointments/${first.r.body.appointmentId}/cancel`);
  const released = await waitFor(async () => (await q(`select status from deal_redemption_holds where appointment_id = $1`, [first.r.body.appointmentId]))[0]?.status === 'released');
  const cev = await q(`select publish_status, attempt_count, last_error_code from outbox_events where tenant_id = $1 and event_type = 'appointment.canceled' and aggregate_id::text = $2`, [T, first.r.body.appointmentId]);
  check('bug 12: a customer cancels in the app → appointment.canceled → the deal\'s place is given back', ok2(cancel.status) && released, `${cancel.status} released=${released} event=${short(cev)} body=${short(cancel.body)}`);
  const loser = race.findIndex((r) => r.status === 409);
  const again = await booking(loser);
  check('… and a customer who was told "sold out" can now book it', ok2(again.status), `${again.status} ${short(again.body)}`);

  // ── 5. the register: a RECEPTIONIST applies deals (bug 2), with reasons, best deal, codes ───────────────────────
  const rec = await staff(REC_EMAIL);
  check('the receptionist signs in at the proof branch', rec.ok, rec.detail);
  const t1 = await ticket();
  const panel = await rec.call('GET', `/pos/checkout/tickets/${t1.id}/offers`);
  const why = (id) => panel.body?.notEligible?.find((o) => o.dealId === id)?.reasons?.map((r) => r.code) ?? [];
  check('the panel lists what this customer can use, with its value HERE, and WHY NOT for the rest (sold out; members only)',
    panel.status === 200 && panel.body?.eligible?.some((o) => o.dealId === WALKIN.body.id && o.estimatedCents === 500) && why(CAPPED.body.id).includes('sold_out') && why(MEMBERS.body.id).some((c) => /member/.test(c)),
    `${panel.status} eligible=${(panel.body?.eligible ?? []).map((o) => o.title + ':' + o.estimatedCents).join('|')} why=${short(panel.body?.notEligible?.map((o) => [o.title, o.reasons?.map((r) => r.code)]))}`);
  check('… and "best deal" names the best combination under the salon\'s stacking policy', panel.body?.best?.better === true && panel.body.best.savingsCents >= 700, short(panel.body?.best));
  const applied = await rec.call('POST', `/pos/checkout/tickets/${t1.id}/offers`, { dealId: WALKIN.body.id });
  check('bug 2: the RECEPTIONIST applies a deal (it was a 403 the POS swallowed)', ok2(applied.status), `${applied.status} ${short(applied.body)}`);
  const manual = await rec.call('POST', `/pos/checkout/tickets/${t1.id}/apply-discount`, { discountCents: 500, reason: 'try' });
  check('… while a MANUAL discount is still a manager\'s decision (403)', manual.status === 403, `${manual.status}`);
  const detail1 = await rec.call('GET', `/pos/checkout/tickets/${t1.id}`);
  const items = detail1.body?.discounts ?? detail1.body?.ticket?.discounts ?? [];
  check('bug 14: the ticket itemizes its discounts — "Deal: Live P5 $5 off" $5.00, not a lump "DISCOUNT"', detail1.status === 200 && items.some((d) => d.category === 'deal' && d.amountCents === 500 && /Live P5 \$5 off/.test(d.label)), `${detail1.status} ${short(items)}`);

  // ── 6. OVERSELL at the registers — 6 tickets, a deal capped at 2, all at once ───────────────────────────────────
  const six = []; for (let i = 0; i < 6; i++) six.push(await ticket());
  const rush = await Promise.all(six.map((t) => rec.call('POST', `/pos/checkout/tickets/${t.id}/offers`, { dealId: RUSH.body.id })));
  const rushOk = rush.filter((r) => ok2(r.status)).length;
  const rushUses = await uses(RUSH.body.id);
  check('OVERSELL IMPOSSIBLE at the register: 6 tickets apply a deal capped at 2 at the same moment — exactly 2 carry it',
    rushOk === 2 && rush.filter((r) => r.status === 409).length === 4 && (rushUses.applied ?? 0) === 2, `ok ${rushOk} statuses ${rush.map((r) => r.status).join(',')} uses ${short(rushUses)}`);

  // ── 7. coupon codes: single use, guessing limited ───────────────────────────────────────────────────────────────
  const t8 = await ticket(), t9 = await ticket();
  const c1 = await rec.call('POST', `/pos/checkout/tickets/${t8.id}/offers`, { code: codes[0].toLowerCase() });
  const c2 = await rec.call('POST', `/pos/checkout/tickets/${t9.id}/offers`, { code: codes[0] });
  check('a single-use code works once (any case) — the second ticket is refused: already used', ok2(c1.status) && c2.status === 409 && /already been used/i.test(short(c2.body)), `${c1.status} ${c2.status} ${short(c2.body)}`);
  let last = null; for (let i = 0; i < 9; i++) last = await rec.call('POST', `/pos/checkout/tickets/${t9.id}/offers`, { code: `NOPE-${i}-${tag}` });
  check('guessing codes is limited: after 8 misses the register is told to wait (429 DEAL_CODE_LOOKUP_LIMITED)', last.status === 429 && JSON.stringify(last.body).includes('DEAL_CODE_LOOKUP_LIMITED'), `${last.status} ${short(last.body)}`);

  // ── 8. PAY → redeemed (bug 4); REFUND → reversed, live ─────────────────────────────────────────────────────────
  const beforeRedeemed = await events('deal.redeemed', [WALKIN.body.id]);
  const pay = await rec.call('POST', `/pos/checkout/tickets/${t1.id}/pay/cash`, { amountReceivedCents: 100000 }, { 'idempotency-key': 'live-p5-' + randomUUID() });
  const paid = await uses(WALKIN.body.id);
  const wRow = await dealRow(WALKIN.body.id);
  check('bug 4: the deal is REDEEMED when the ticket is paid (not when it was put on) — the count moves then, one deal.redeemed',
    ok2(pay.status) && (paid.redeemed ?? 0) === 1 && Number(wRow.redemption_count) === 1 && (await waitFor(async () => (await events('deal.redeemed', [WALKIN.body.id])) === beforeRedeemed + 1, 5000)),
    `${pay.status} uses ${short(paid)} count ${wRow?.redemption_count}`);
  const pv = await own.call('GET', `/pos/checkout/tickets/${t1.id}/refund-preview?amountCents=1`);
  const whole = pv.body?.refundableCents;
  const paidRow = (await q(`select amount_cents, tip_cents from payments where tenant_id = $1 and ticket_id = $2 and status = 'approved'`, [T, t1.id]))[0];
  // refunds are a step-up action since the Security deep scan (1b115fb8, Oct 23 2026): the owner confirms her password first
  // (this proof predates that; the M7 regression saw its four refund checks answer 403 until it stepped up)
  const refundSu = await own.call('POST', '/auth/step-up', { password: PW });
  check('the owner steps up before refunding (refunds need a fresh step-up)', ok2(refundSu.status), String(refundSu.status));
  const refund = await own.call('POST', `/pos/checkout/tickets/${t1.id}/refund`, { reason: 'live proof — customer unhappy', amountCents: whole }, { 'idempotency-key': 'live-p5-r-' + randomUUID() });
  const after = await uses(WALKIN.body.id);
  const wAfter = await dealRow(WALKIN.body.id);
  const hold1 = (await q(`select h.status from deal_redemptions r join deal_redemption_holds h on h.id = r.hold_id where r.deal_id = $1 and r.ticket_id = $2`, [WALKIN.body.id, t1.id]))[0]?.status;
  check('REFUND REVERSAL, live: a full refund reverses the deal — the use is "reversed", its place is released, the count goes back to 0',
    ok2(refund.status) && refund.body?.refundedCents === whole && whole === Number(paidRow?.amount_cents) && (after.reversed ?? 0) === 1 && hold1 === 'released' && Number(wAfter.redemption_count) === 0,
    `${refund.status} refunded ${refund.body?.refundedCents} of ${whole} (paid ${short(paidRow)}) uses ${short(after)} place ${hold1} count ${wAfter?.redemption_count}`);
  check('… and deal.redemption_reversed is on the outbox', await waitFor(async () => (await events('deal.redemption_reversed', [WALKIN.body.id])) >= 1, 5000));

  // a refund of ONE service: only what that service carried comes back
  const payC = await rec.call('POST', `/pos/checkout/tickets/${t8.id}/pay/cash`, { amountReceivedCents: 100000 }, { 'idempotency-key': 'live-p5-' + randomUUID() });
  const alloc = (await q(`select line_allocations, amount_discounted_cents from deal_redemptions where deal_id = $1 and ticket_id = $2`, [COUPON.body.id, t8.id]))[0];
  const gelShare = (alloc?.line_allocations ?? []).find((l) => l.lineId === t8.gelLine)?.cents ?? null;
  const pv8 = await own.call('GET', `/pos/checkout/tickets/${t8.id}/refund-preview?amountCents=1`);
  const gelPaid = pv8.body?.lines?.find((l) => l.serviceLineId === t8.gelLine);
  const partial = await own.call('POST', `/pos/checkout/tickets/${t8.id}/refund`, { reason: 'live proof — redo the gel', serviceLineIds: [t8.gelLine] }, { 'idempotency-key': 'live-p5-r-' + randomUUID() });
  const cRow = (await q(`select status, reversed_cents from deal_redemptions where deal_id = $1 and ticket_id = $2`, [COUPON.body.id, t8.id]))[0];
  const rate = gelPaid ? gelPaid.taxCents / Math.max(1, gelPaid.netCents) : 0;
  check('a refund of the GEL only gives back what the gel was PAID — $50 minus its share of the coupon, plus the tax on that — and reverses only that share',
    ok2(payC.status) && ok2(partial.status) && gelShare != null && gelPaid?.netCents === 5000 - gelShare && gelPaid.taxCents === Math.round(gelPaid.netCents * rate) && partial.body?.refundedCents === gelPaid.paidCents
      && cRow?.status === 'partially_reversed' && Number(cRow?.reversed_cents) === gelShare,
    `pay ${payC.status} refund ${partial.status} ${partial.body?.refundedCents} gel ${short(gelPaid)} share ${gelShare} use ${short(cRow)}`);

  // ── 9. Super Admin suspends a deal (bug 17) ───────────────────────────────────────────────────────────────────
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const noReason = await sa('POST', `/super-admin/deals/${CAPPED.body.id}/suspend`, { reason: 'bad' });
  check('a suspension needs a real reason (400)', sl.status === 200 && noReason.status === 400, `login ${sl.status} ${noReason.status}`);
  const bookedBefore = (await places(CAPPED.body.id)).consumed ?? 0;
  const sus = await sa('POST', `/super-admin/deals/${CAPPED.body.id}/suspend`, { reason: 'Live proof: advertised terms under review' });
  const cRowS = await dealRow(CAPPED.body.id);
  const auditS = (await q(`select count(*)::int as n from audit_logs where tenant_id = $1 and entity_id::text = $2 and action_type like '%suspend%'`, [T, CAPPED.body.id]).catch(() => [{ n: -1 }]))[0].n;
  check('bug 17: the suspension stops the deal everywhere — the booked places are given back, the reason is kept, it is audited',
    ok2(sus.status) && sus.body?.releasedPlaces === bookedBefore && bookedBefore === 3 && cRowS?.suspended_at && cRowS.suspended_reason === 'Live proof: advertised terms under review' && ((await places(CAPPED.body.id)).consumed ?? 0) === 0 && auditS >= 1,
    `${sus.status} ${short(sus.body)} booked ${bookedBefore} audit ${auditS}`);
  const posList = await own.call('GET', '/pos/deals');
  check('… and the salon sees why on its deals list', posList.status === 200 && posList.body.some((d) => d.id === CAPPED.body.id && d.suspendedReason === 'Live proof: advertised terms under review'), `${posList.status}`);
  const overview = await sa('GET', '/super-admin/deals?suspended=true');
  check('… and Super Admin oversight lists it under "suspended"', overview.status === 200 && overview.body.some((d) => d.id === CAPPED.body.id && d.salonName), `${overview.status}`);

  // ── 10. the phone receptionist, the owner app, the export, the audit ───────────────────────────────────────────
  const vt = await fetch(API + '/voice/tool', { method: 'POST', headers: { 'x-voice-key': VOICE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'get_deals', args: {}, call_id: 'live-p5' }) }).then(j);
  const vTitles = (vt.body?.data ?? vt.body?.result ?? []).map?.((d) => d.title) ?? [];
  check('the phone receptionist hears the live deals offered on the phone — the phone special; never a suspended or a full one', ok2(vt.status) && vt.body?.success === true && vTitles.includes('Live P5 Phone special') && !vTitles.includes('Live P5 Gel 20% (3 only)') && !vTitles.includes('Live P5 Register rush (2 only)'), `${vt.status} ${short(vTitles)} ${short(vt.body)}`);
  const os = await own.call('GET', '/owner/deals/summary');
  check('the owner app summary shows what deals gave away, net of refunds', os.status === 200 && typeof os.body?.dashboard?.totals?.netDiscountCents === 'number' && os.body?.switches?.running === true, `${os.status} ${short(os.body?.dashboard?.totals)}`);
  const ex = await own.call('GET', '/pos/deals/export?days=7');
  const exRow = String(ex.body?.csv ?? '').split('\n').find((l) => l.includes(t1.id));
  check('the CSV export lists the reversed use with what it took off and gave back', ex.status === 200 && /,reversed,5\.00,5\.00,0\.00,/.test(exRow ?? ''), `${ex.status} ${exRow}`);
  const auditRows = (await q(`select count(*)::int as n from audit_logs where tenant_id = $1 and entity_id::text = $2`, [T, t1.id]).catch(() => [{ n: -1 }]))[0].n;
  check('bug 13: checkout\'s audit (apply, pay, refund) is in audit_logs, not a process-memory array', auditRows >= 2, `rows ${auditRows}`);

  // ── 11. load: many registers and many guests at once ────────────────────────────────────────────────────────────
  const p95 = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]; };
  const LOAD = await live({ title: 'Live P5 Load (40 only)', discountType: 'fixed', discountCents: 300, maxRedemptions: 40 });
  const many = []; for (let i = 0; i < 120; i++) many.push(await ticket());
  const t0 = Date.now(); const lat = [];
  const loadRes = await Promise.all(many.map(async (t) => { const s0 = Date.now(); const r = await rec.call('POST', `/pos/checkout/tickets/${t.id}/offers`, { dealId: LOAD.body.id }); lat.push(Date.now() - s0); return r; }));
  const loadOk = loadRes.filter((r) => ok2(r.status)).length; const load5xx = loadRes.filter((r) => r.status >= 500).length;
  const loadPlaces = await places(LOAD.body.id);
  check(`LOAD: 120 registers apply a deal capped at 40 at once — exactly 40 carry it, no 5xx (p95 ${p95(lat)} ms, all done in ${Date.now() - t0} ms)`,
    loadOk === 40 && load5xx === 0 && Object.values(loadPlaces).reduce((a, b) => a + b, 0) === 40, `ok ${loadOk} 5xx ${load5xx} places ${short(loadPlaces)}`);
  const glat = []; const g0 = Date.now();
  const feeds = await Promise.all(Array.from({ length: 300 }, async (_, i) => { const s0 = Date.now(); const r = await guest('GET', `/customer/deals/nearby?lat=${LAT}&lng=${LNG}&radiusMiles=10`, undefined, `10.99.${Math.floor(i / 250)}.${(i % 250) + 1}`); glat.push(Date.now() - s0); return r; }));
  check(`LOAD: 300 guests open the deals feed at once from 300 addresses — all answered (p95 ${p95(glat)} ms, all done in ${Date.now() - g0} ms)`, feeds.every((r) => r.status === 200), `statuses ${[...new Set(feeds.map((r) => r.status))].join(',')}`);
  const burst = await Promise.all(Array.from({ length: 70 }, () => guest('GET', `/customer/deals/nearby?lat=${LAT}&lng=${LNG}`, undefined, '10.98.0.1')));
  check('… while ONE address hammering it is cut off past 60 a minute (429)', burst.filter((r) => r.status === 429).length >= 10 && burst.filter((r) => r.status === 200).length <= 60, `200s ${burst.filter((r) => r.status === 200).length} 429s ${burst.filter((r) => r.status === 429).length}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
