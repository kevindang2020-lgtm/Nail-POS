#!/usr/bin/env node
// live-phase7-scheduling.mjs — BUILD_PLAN Phase 7 (ai_scheduling_optimizer), proved on the real API and PostgreSQL with
// REAL appointments made through the booking API. Nothing is stubbed: an owner, a receptionist, two customers and a Super
// Admin sign in and call the endpoints the apps call. The exit criterion: a recommendation is GENERATED (server-side gate
// + simulation), REVIEWED by staff, APPROVED by the customer in the customer app and APPLIED through the booking service
// — live. Around it:
//   • an infeasible target is refused (422, violations) and nothing is stored; the role matrix (front desk generates but
//     cannot accept / apply / configure / export); a stale version is a 409; apply before the customer approved is a 409;
//   • a second customer cannot see or answer the first customer's proposal; the original appointment is untouched until
//     the customer approves; a repeat apply does not apply twice; a schedule that moved underneath a recommendation is
//     refused as STALE (never overwritten); rollback puts the appointment back;
//   • settings are versioned (stale save 409), disabling the location stops generation; options + a booking hold;
//     a branch-day run writes gaps; calendar indicators, owner summary, usage and CSV export answer;
//   • events go through the outbox; the Super Admin sees counts, needs a support session for one salon's detail and
//     step-up for the platform switch (which then stops generation).
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase7-scheduling.mjs   (apps/api built). Never point it at
// production: it creates a proof branch, staff, two customers and a Super Admin, may add the AI package to the salon for
// the run, and removes everything it made (the platform switch row is restored exactly).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = 3057, API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t), text: t }; } catch { return { status: r.status, body: t, text: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 260);
const code = (b) => b?.code ?? b?.error?.code ?? b?.message?.code ?? null;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase7 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const STARTED = new Date();
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID(), SA = randomUUID(), GEL = randomUUID();
const techs = [randomUUID(), randomUUID()];
const custs = Array.from({ length: 2 }, (_, i) => ({ user: randomUUID(), customer: randomUUID(), ident: randomUUID(), email: `phase7-c${i}-${tag}@aipowersalon.test`, phone: `+1857571${String(i).padStart(2, '0')}${tag.slice(-2)}` }));
const PW = 'Phase7!' + randomUUID().slice(0, 10);
const OWN_EMAIL = `phase7-owner-${tag}@aipowersalon.test`, REC_EMAIL = `phase7-rec-${tag}@aipowersalon.test`, SA_EMAIL = `phase7-sa-${tag}@aipowersalon.test`;
const cat = (await q(`select category_id from services where tenant_id = $1 and status = 'active' and category_id is not null limit 1`, [T]))[0]?.category_id;
if (!cat) { console.error('the salon needs an active service (for its category)'); process.exit(2); }
const hash = await hashPassword(PW);
// a weekday three days out (UTC date string) — far enough for the lead time, inside the horizon
const DAY = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 3); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const PLATFORM_KEY = 'ai.scheduling_optimizer_disabled';
const platformBefore = (await q(`select * from platform_settings where setting_key = $1`, [PLATFORM_KEY]))[0] ?? null;
const hadPackage = (await q(`select 1 from tenant_ai_subscriptions where tenant_id = $1 and package_code = 'ai_scheduling_optimizer' and status in ('active','trialing')`, [T])).length > 0;
const SUB = randomUUID();
if (!hadPackage) await q(`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status) values ($1, $2, 'ai_scheduling_optimizer', 'active')`, [SUB, T]);
const tenantSettingsBefore = (await q(`select * from tenant_scheduling_ai_settings where tenant_id = $1 and level = 'tenant'`, [T]))[0] ?? null;

await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','7 Proof Way')`, [B, T, `Live Phase7 Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Live P7 Gel',60,5000,'active')`, [GEL, T, B, cat]);
for (const [u, email, role, fn] of [[OWN, OWN_EMAIL, 'OWNER', 'Olga'], [REC, REC_EMAIL, 'RECEPTION', 'Rae']]) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Seven',$4 || ' Seven',$5,$6,'active',$7)`, [u, T, B, fn, email, hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, u, role === 'OWNER' ? 'manager' : 'staff']).catch(() => q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'staff')`, [T, B, u]).catch(() => undefined));
}
for (const [i, t] of techs.entries()) {
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Tech',$4,'Tech ' || $4,'active', true)`, [t, T, B, `P7-${i}`]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true)`, [T, B, t, GEL]);
}
for (const c of custs) {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, password_hash, status, role) values ($1,$2,$3,'Cust','Seven','Cust Seven',$4,$5,$6,'active','CUSTOMER')`, [c.user, T, B, c.email, c.phone, hash]);
  await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at) values ($1,$2,$3,$4,'Cust','Seven','Cust Seven',$5,$5, now())`, [c.customer, T, B, c.user, c.phone]);
  await q(`insert into customer_identities (id, normalized_phone, email, full_name, password_hash, phone_verified_at) values ($1,$2,$3,'Cust Seven',$4, now())`, [c.ident, c.phone, c.email, hash]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [c.ident, T, c.user, c.customer]);
}
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Seven', 'Pat Seven', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_SUPER_ADMIN')`, [SA, SA_EMAIL, hash]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'AI_QUEUE_OPS_JOBS', 'AI_SCHEDULING_JOBS']) delete env[k];
env.AI_QUEUE_OPS_JOBS = 'off'; env.AI_SCHEDULING_JOBS = 'off';   // background scans would race the proof's own calls; jobs are proved by tests
let proc = null; let errs = '';
const allUsers = [OWN, REC, SA, ...custs.map((c) => c.user)];
let recIds = [];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await sleep(1200);
  recIds = (await q(`select id from schedule_optimization_recommendations where tenant_id = $1 and branch_id = $2`, [T, B])).map((r) => r.id);
  await q(`delete from schedule_change_applications where tenant_id = $1 and recommendation_id = any($2::uuid[])`, [T, recIds]).catch(() => undefined);
  await q(`delete from ai_usage_logs where tenant_id = $1 and package_code = 'ai_scheduling_optimizer' and created_at >= $2 and user_id = any($3::uuid[])`, [T, STARTED, allUsers]).catch(() => undefined);
  await q(`delete from support_access_sessions where admin_user_id = $1`, [SA]).catch(() => undefined);
  for (const c of custs) { await q(`delete from customer_identity_links where identity_id = $1`, [c.ident]).catch(() => undefined); await q(`delete from customer_identities where id = $1`, [c.ident]).catch(() => undefined); }
  for (const u of allUsers) for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [u]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[OWN_EMAIL, REC_EMAIL, SA_EMAIL, ...custs.map((c) => c.email)]]).catch(() => undefined);
  await q(`update customers set user_id = null where id = any($1::uuid[])`, [custs.map((c) => c.customer)]).catch(() => undefined);
  // platform switch row exactly as before
  if (platformBefore) {
    const cols = Object.keys(platformBefore).filter((k) => k !== 'setting_key');
    await q(`update platform_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where setting_key = $1`, [PLATFORM_KEY, ...cols.map((c) => (platformBefore[c] !== null && typeof platformBefore[c] === 'object' && !(platformBefore[c] instanceof Date) ? JSON.stringify(platformBefore[c]) : platformBefore[c]))]).catch((e) => check('platform switch restore', false, String(e?.message)));
  } else await q(`delete from platform_settings where setting_key = $1`, [PLATFORM_KEY]).catch(() => undefined);
  await q(`delete from outbox_events where branch_id is null and event_type like 'schedule.%' and created_at >= $1 and (tenant_id = $2 or tenant_id is null)`, [STARTED, T]).catch(() => undefined);
  if (!hadPackage) await q(`delete from tenant_ai_subscriptions where id = $1`, [SUB]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from users where id = any($1::uuid[])`, [allUsers]).catch(() => undefined);
  const platformAfter = (await q(`select * from platform_settings where setting_key = $1`, [PLATFORM_KEY]))[0] ?? null;
  const tenantAfter = (await q(`select * from tenant_scheduling_ai_settings where tenant_id = $1 and level = 'tenant'`, [T]))[0] ?? null;
  const restored = JSON.stringify(platformAfter) === JSON.stringify(platformBefore) && JSON.stringify(tenantAfter) === JSON.stringify(tenantSettingsBefore);
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = any($2::uuid[])) + (select count(*)::int from customers where id = any($3::uuid[]))
      + (select count(*)::int from pos_tech_appointments where branch_id = $1) + (select count(*)::int from schedule_optimization_recommendations where branch_id = $1)
      + (select count(*)::int from schedule_change_proposals where branch_id = $1) + (select count(*)::int from schedule_optimization_runs where branch_id = $1)
      + (select count(*)::int from schedule_change_applications where recommendation_id = any($6::uuid[]))
      + (select count(*)::int from customer_identities where id = any($4::uuid[])) + (select count(*)::int from tenant_ai_subscriptions where id = $5) as n`,
    [B, allUsers, custs.map((c) => c.customer), custs.map((c) => c.ident), SUB, recIds]))[0].n;
  check('the proof branch, staff, customers, appointments, recommendations, proposals, runs and the Super Admin are removed; the platform switch and salon settings are exactly as before', a.removed && left === 0 && restored, (a.kept ?? []).join(', ') + ` left=${left} restored=${restored}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 10 * 60_000);

const login = async (body, ip) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
};
const as = (cookie, extra = {}) => (method, path, body, hdr = {}) => fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra, ...hdr }, body: body ? JSON.stringify(body) : undefined }).then(j);
const staff = async (email) => {
  const l = await login({ portal: 'tenant', salonCode: SALON, identifier: email, password: PW });
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie: l.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(); for (const c of [...l.cookie.split('; '), ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])]) { const k = c.split('=')[0]; if (k) jar.set(k, c); }
  return { ok: l.status === 200 && sel.status === 200, detail: `login ${l.status} select ${sel.status}`, call: as([...jar.values()].join('; ')) };
};
const appt = async (id) => (await q(`select left(start_time, 5) as start, technician_id, version, status from pos_tech_appointments where id = $1`, [id]))[0];
const outboxN = async (type, id) => (await q(`select count(*)::int as n from outbox_events where tenant_id = $1 and event_type = $2 and (aggregate_id::text = $3 or payload_json->>'recommendationId' = $3)`, [T, type, id]))[0].n;
const P = '/pos/ai-scheduling-optimizer';

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  const own = await staff(OWN_EMAIL); const rec = await staff(REC_EMAIL);
  check('the owner and a receptionist sign in at the proof branch', own.ok && rec.ok, `${own.detail} / ${rec.detail}`);

  // ── 1. real appointments through the booking API: T0 has 10:00 (walk-in) and 14:00 (a customer) → a 3 h hole ──────
  const book = async (body) => { const r = await own.call('POST', '/pos/booking/appointments', { serviceIds: [GEL], date: DAY, source: 'walk_in', ...body }); return { r, id: r.body?.appointmentId ?? r.body?.id ?? r.body?.appointment?.id ?? null }; };
  const A2 = await book({ technicianId: techs[0], customerName: 'Walk In', startTime: '10:00' });
  const A1 = await book({ technicianId: techs[0], customerId: custs[0].customer, customerName: 'Cust Seven', customerPhone: custs[0].phone, startTime: '14:00', source: 'phone' });
  if (!check('two appointments are booked through the booking API', !!A1.id && !!A2.id, `${A1.r.status} ${short(A1.r.body)} / ${A2.r.status}`)) throw new Error('booking failed');
  const before1 = await appt(A1.id);

  // ── 2. settings: versioned, owner-only, stale save refused ──────────────────────────────────────────────────────
  const recPut = await rec.call('PUT', `${P}/settings`, { level: 'branch', expectedVersion: 0, enabled: true });
  const s1 = await own.call('PUT', `${P}/settings`, { level: 'branch', expectedVersion: 0, enabled: true, config: { recommendationTtlMin: 60 } });
  const stale = await own.call('PUT', `${P}/settings`, { level: 'branch', expectedVersion: 0, enabled: true });
  const vers = await own.call('GET', `${P}/settings/versions`);
  check('settings: the front desk cannot configure (403); the owner saves version 1; a stale save is a 409; the version history lists it',
    recPut.status === 403 && ok2(s1.status) && s1.body?.branch?.version === 1 && stale.status === 409 && Array.isArray(vers.body) && vers.body.length >= 1,
    `${recPut.status} ${s1.status} v${s1.body?.branch?.version} ${stale.status} ${short(vers.body)?.slice(0, 80)}`);

  // ── 3. generate: server-side gate + simulation; infeasible refused; reception may generate ───────────────────────
  const bad = await rec.call('POST', `${P}/recommendations/generate`, { appointmentId: A1.id, target: { startTime: '06:00', technicianId: techs[0] } });
  const nBad = (await q(`select count(*)::int as n from schedule_optimization_recommendations where branch_id = $1`, [B]))[0].n;
  check('an infeasible target (06:00, before opening) is refused 422 with the violations, and nothing is stored',
    bad.status === 422 && JSON.stringify(bad.body).includes('OUTSIDE_HOURS') && nBad === 0, `${bad.status} ${short(bad.body)} stored=${nBad}`);
  const gen = await rec.call('POST', `${P}/recommendations/generate`, { appointmentId: A1.id, target: { startTime: '11:30', technicianId: techs[0] } });
  const R1 = gen.body?.recommendation;
  check('the receptionist generates a recommendation: review_required, hard constraints checked, simulated on the server, touches a confirmed customer appointment → needs the customer',
    ok2(gen.status) && R1?.status === 'review_required' && R1?.hardConstraintsChecked === true && R1?.simulation?.improved === true && R1?.touchesConfirmedAppointment === true && R1?.requiresCustomerApproval === true && R1?.currentState?.startTime === '14:00' && R1?.proposedState?.startTime === '11:30',
    `${gen.status} ${short({ s: R1?.status, sim: R1?.simulation?.deltas, t: R1?.touchesConfirmedAppointment, cur: R1?.currentState?.startTime, to: R1?.proposedState?.startTime, e: code(gen.body) })}`);
  if (!R1) throw new Error('no recommendation');
  check('the explanation is stored with its source (template when no AI words are available)', typeof R1.explanation === 'string' && R1.explanation.length > 0 && ['llm', 'template'].includes(R1.explanationSource), `${R1.explanationSource}: ${String(R1.explanation).slice(0, 60)}`);

  // ── 4. review: role matrix, optimistic version, customer approval gate ─────────────────────────────────────────
  const recAcc = await rec.call('POST', `${P}/recommendations/${R1.id}/accept`, { expectedVersion: R1.version });
  const staleAcc = await own.call('POST', `${P}/recommendations/${R1.id}/accept`, { expectedVersion: R1.version + 5 });
  const acc = await own.call('POST', `${P}/recommendations/${R1.id}/accept`, { expectedVersion: R1.version, reason: 'fills the morning hole' });
  const R1a = acc.body?.recommendation;
  check('the front desk cannot accept (403); a stale version is a 409; the owner accepts → customer_approval_required with a live proposal',
    recAcc.status === 403 && staleAcc.status === 409 && ok2(acc.status) && R1a?.status === 'customer_approval_required' && !!R1a?.proposal && ['proposed', 'customer_notified'].includes(R1a.proposal.status),
    `${recAcc.status} ${staleAcc.status} ${acc.status} ${R1a?.status} ${short(R1a?.proposal)}`);
  const early = await own.call('POST', `${P}/recommendations/${R1.id}/apply`, { expectedVersion: R1a?.version });
  const still = await appt(A1.id);
  check('apply before the customer answers is refused (409) and the original appointment is untouched', early.status === 409 && still.start === '14:00' && still.version === before1.version, `${early.status} ${code(early.body)} ${still.start} v${still.version}`);
  const decisions = (await q(`select action from schedule_recommendation_decisions where tenant_id = $1 and recommendation_id = $2`, [T, R1.id])).map((r) => r.action);
  check('the decision trail records the review start and the accept', decisions.length >= 2 && decisions.some((a) => /accept/.test(a)), decisions.join(','));

  // ── 5. the customer approves in the customer app ───────────────────────────────────────────────────────────────
  const cl = await login({ portal: 'customer', identifier: custs[0].email, password: PW }, '10.67.0.1');
  const cust = as(cl.cookie, { 'x-forwarded-for': '10.67.0.1' });
  const list = await cust('GET', '/customer/schedule-proposals');
  const prop = (list.body?.items ?? []).find((p) => p.appointmentId === A1.id);
  check('the customer sees the proposal in the customer app: original 14:00, proposed 11:30', cl.status === 200 && list.status === 200 && !!prop && prop.original?.startTime === '14:00' && prop.proposed?.startTime === '11:30', `${cl.status} ${list.status} ${short(prop)}`);
  const cl2 = await login({ portal: 'customer', identifier: custs[1].email, password: PW }, '10.67.0.2');
  const cust2 = as(cl2.cookie, { 'x-forwarded-for': '10.67.0.2' });
  const list2 = await cust2('GET', '/customer/schedule-proposals');
  const steal = prop ? await cust2('POST', `/customer/schedule-proposals/${prop.id}/approve`, { expectedVersion: prop.version }) : { status: 0 };
  check('another customer neither sees nor can answer it', (list2.body?.items ?? []).every((p) => p.appointmentId !== A1.id) && !ok2(steal.status) && steal.status < 500, `${list2.status} n=${(list2.body?.items ?? []).length} ${steal.status}`);
  const appr = prop ? await cust('POST', `/customer/schedule-proposals/${prop.id}/approve`, { expectedVersion: prop.version }) : { status: 0 };
  const afterAppr = await own.call('GET', `${P}/recommendations/${R1.id}`);
  check('the customer approves → the recommendation is customer_approved (the appointment still at 14:00 until applied)',
    ok2(appr.status) && afterAppr.body?.recommendation?.status === 'customer_approved' && (await appt(A1.id)).start === '14:00', `${appr.status} ${short(appr.body)?.slice(0, 120)} ${afterAppr.body?.recommendation?.status}`);

  // ── 6. apply through the booking service ──────────────────────────────────────────────────────────────────────
  const R1b = afterAppr.body?.recommendation;
  const recApply = await rec.call('POST', `${P}/recommendations/${R1.id}/apply`, { expectedVersion: R1b?.version });
  const ap = await own.call('POST', `${P}/recommendations/${R1.id}/apply`, { expectedVersion: R1b?.version });
  const moved = await appt(A1.id);
  check('the front desk cannot apply (403); the owner applies → applied, and the appointment really moved to 11:30 through the booking service (its version advanced)',
    recApply.status === 403 && ok2(ap.status) && ap.body?.application?.status === 'applied' && ap.body?.recommendation?.status === 'applied' && moved.start === '11:30' && moved.version > before1.version,
    `${recApply.status} ${ap.status} ${short(ap.body?.application)} ${moved.start} v${before1.version}->${moved.version}`);
  const again = await own.call('POST', `${P}/recommendations/${R1.id}/apply`, { expectedVersion: R1b?.version });
  const nApps = (await q(`select count(*)::int as n from schedule_change_applications where tenant_id = $1 and recommendation_id = $2 and status = 'applied'`, [T, R1.id]))[0].n;
  check('a repeat apply does not apply twice (the recorded result is replayed or it is refused; one applied row; appointment unchanged)', again.status < 500 && nApps === 1 && (await appt(A1.id)).version === moved.version, `${again.status} rows=${nApps}`);
  const propRow = (await q(`select status from schedule_change_proposals where tenant_id = $1 and recommendation_id = $2`, [T, R1.id]))[0];
  check('the proposal is marked applied', propRow?.status === 'applied', propRow?.status);

  // ── 7. a schedule that moved underneath a recommendation is refused as STALE, never overwritten ───────────────
  const gen2 = await own.call('POST', `${P}/recommendations/generate`, { appointmentId: A2.id, target: { startTime: '09:00', technicianId: techs[0] } });
  const R2 = gen2.body?.recommendation;
  const acc2 = R2 ? await own.call('POST', `${P}/recommendations/${R2.id}/accept`, { expectedVersion: R2.version }) : { status: 0, body: {} };
  const v2 = (await appt(A2.id)).version;
  const mv = await own.call('POST', `/pos/booking/appointments/${A2.id}/reschedule`, { startTime: '16:00', date: DAY, technicianId: techs[0], expectedVersion: v2, notifyCustomer: false });
  const stApply = R2 ? await own.call('POST', `${P}/recommendations/${R2.id}/apply`, { expectedVersion: acc2.body?.recommendation?.version }) : { status: 0, body: {} };
  const a2 = await appt(A2.id);
  check('a walk-in\'s move (no customer to ask) needs no customer approval: accepted directly', ok2(gen2.status) && R2?.requiresCustomerApproval === false && acc2.body?.recommendation?.status === 'accepted', `${gen2.status} ${short({ e: code(gen2.body), ty: R2?.type, rq: R2?.requiresCustomerApproval, st: acc2.body?.recommendation?.status })}`);
  check('after the appointment was moved by hand, apply is refused 409 STALE_SCHEDULE and the hand-made move stands', ok2(mv.status) && stApply.status === 409 && code(stApply.body) === 'STALE_SCHEDULE' && a2.start === '16:00' && a2.technician_id === techs[0], `${mv.status} ${short(mv.body)?.slice(0, 80)} ${stApply.status} ${code(stApply.body)} ${short(stApply.body)?.slice(0, 120)} ${a2.start}`);

  // ── 8. rollback puts the applied appointment back ─────────────────────────────────────────────────────────────
  const cur = await own.call('GET', `${P}/recommendations/${R1.id}`);
  const rb = await own.call('POST', `${P}/recommendations/${R1.id}/rollback`, { expectedVersion: cur.body?.recommendation?.version });
  const back = await appt(A1.id);
  check('rollback returns the appointment to 14:00 through the booking service; the recommendation is rolled_back', ok2(rb.status) && rb.body?.recommendation?.status === 'rolled_back' && back.start === '14:00', `${rb.status} ${short(rb.body)?.slice(0, 120)} ${back.start}`);

  // ── 9. events through the outbox ──────────────────────────────────────────────────────────────────────────────
  const evs = {};
  for (const t of ['schedule.recommendation_generated', 'schedule.recommendation_decided', 'schedule.customer_approval_requested', 'schedule.customer_decided', 'schedule.change_applied', 'schedule.change_failed', 'schedule.change_rolled_back']) evs[t] = await outboxN(t, t === 'schedule.change_failed' ? R2?.id : R1.id);
  check('every step wrote its schedule.* domain event to the outbox (generated, decided, approval requested, customer decided, applied, stale→failed, rolled back)', Object.values(evs).every((n) => n >= 1), short(evs));

  // ── 10. options + a booking hold; a branch-day run; calendar; owner; usage; export ─────────────────────────────
  const opt = await rec.call('POST', `${P}/options`, { date: DAY, serviceIds: [GEL], preferredTime: '15:00', limit: 3, hold: { channel: 'pos' } });
  const holdRow = opt.body?.hold ? (await q(`select status, technician_id from booking_holds where id = $1`, [opt.body.hold.holdId]))[0] : null;
  check('options: ranked, full payload, and the top option is held in booking_holds', ok2(opt.status) && (opt.body?.options?.length ?? 0) >= 1 && !!opt.body.options[0].technicianId && !!opt.body.options[0].endTime && !!holdRow, `${opt.status} n=${opt.body?.options?.length} ${short(opt.body?.options?.[0])?.slice(0, 120)} hold=${short(holdRow)}`);
  if (opt.body?.hold) { const rel = await rec.call('POST', `${P}/holds/${opt.body.hold.holdId}/release`, {}); check('the hold is released', ok2(rel.status) && !!(await q(`select released_at from booking_holds where id = $1`, [opt.body.hold.holdId]))[0]?.released_at, `${rel.status}`); }
  const run = await own.call('POST', `${P}/runs`, { scope: 'branch_day', date: DAY, idempotencyKey: `p7-${tag}` });
  const runAgain = await own.call('POST', `${P}/runs`, { scope: 'branch_day', date: DAY, idempotencyKey: `p7-${tag}` });
  const gaps = run.body?.run ? (await q(`select count(*)::int as n from schedule_gaps where tenant_id = $1 and run_id = $2`, [T, run.body.run.id]))[0].n : 0;
  check('a branch-day run completes, writes its gaps and metrics; the same idempotency key returns the same run', ok2(run.status) && run.body?.run?.status === 'completed' && gaps >= 1 && run.body?.run?.metrics && runAgain.body?.run?.id === run.body?.run?.id, `${run.status} ${short(run.body?.run)?.slice(0, 160)} gaps=${gaps} again=${runAgain.body?.run?.id === run.body?.run?.id}`);
  const cal = await rec.call('GET', `${P}/calendar?date=${DAY}`);
  const os = await own.call('GET', '/owner/ai-scheduling/summary?days=7');
  const us = await own.call('GET', `${P}/usage?from=${STARTED.toISOString().slice(0, 10)}&to=${DAY}`);
  check('calendar indicators, the owner summary and usage answer', cal.status === 200 && Array.isArray(cal.body?.gaps) && os.status === 200 && (os.body?.branches ?? []).some((b) => b.branchId === B) && us.status === 200 && (us.body?.runs ?? 0) >= 1, `${cal.status} ${os.status} ${us.status} ${short(us.body)}`);
  const exO = await own.call('GET', `${P}/export?kind=recommendations&from=${STARTED.toISOString().slice(0, 10)}&to=${DAY}`);
  const exR = await rec.call('GET', `${P}/export?kind=recommendations&from=${STARTED.toISOString().slice(0, 10)}&to=${DAY}`);
  check('the CSV export lists the recommendations; the front desk cannot export (403)', exO.status === 200 && exO.text.includes(R1.id) && exR.status === 403, `${exO.status} ${exO.text.slice(0, 60)} rec ${exR.status}`);

  // ── 11. disabling the location stops generation ───────────────────────────────────────────────────────────────
  const s2 = await own.call('PUT', `${P}/settings`, { level: 'branch', expectedVersion: 1, enabled: false });
  const off = await own.call('POST', `${P}/recommendations/generate`, { appointmentId: A2.id });
  const s3 = await own.call('PUT', `${P}/settings`, { level: 'branch', expectedVersion: 2, enabled: true });
  check('disabling the location refuses generation (403 MODULE_DISABLED); enabling it again is version 3', ok2(s2.status) && off.status === 403 && code(off.body) === 'MODULE_DISABLED' && s3.body?.branch?.version === 3, `${s2.status} ${off.status} ${code(off.body)} v${s3.body?.branch?.version}`);

  // ── 12. Super Admin ───────────────────────────────────────────────────────────────────────────────────────────
  const sl = await login({ portal: 'super-admin', identifier: SA_EMAIL, password: PW, mfaCode: '123456' });
  const sa = as(sl.cookie);
  const ov = await sa('GET', '/super-admin/ai-scheduling-optimizer/overview');
  check('the Super Admin overview counts the salon\'s activity (the rolled-back recommendation, the applied split manual vs automated)', sl.status === 200 && ov.status === 200 && (ov.body?.recommendations?.rolled_back ?? 0) >= 1 && typeof ov.body?.applied?.manual === 'number' && typeof ov.body?.applied?.automated === 'number', `${sl.status} ${ov.status} ${short(ov.body?.recommendations)} ${short(ov.body?.applied)}`);
  const det0 = await sa('GET', `/super-admin/ai-scheduling-optimizer/tenants/${T}`);
  await q(`update sessions set last_step_up_at = now() where user_id = $1 and revoked_at is null`, [SA]);
  const sup = await sa('POST', `/super-admin/tenants/${T}/support-access`, { reason: 'Live proof: scheduling optimizer review', source: 'ai_scheduling_oversight' });
  const det1 = await sa('GET', `/super-admin/ai-scheduling-optimizer/tenants/${T}`);
  check('one salon\'s detail needs an active support session (refused without, answered with)', !ok2(det0.status) && det0.status < 500 && ok2(sup.status) && det1.status === 200 && det1.body?.tenantId === T, `${det0.status} ${code(det0.body)} support ${sup.status} ${short(sup.body)?.slice(0, 80)} ${det1.status}`);
  await q(`update sessions set last_step_up_at = null where user_id = $1 and revoked_at is null`, [SA]);
  const noStep = await sa('PUT', '/super-admin/ai-scheduling-optimizer/platform-switch', { killed: true, reason: 'Live proof: platform pause of the optimizer' });
  await q(`update sessions set last_step_up_at = now() where user_id = $1 and revoked_at is null`, [SA]);
  const kill = await sa('PUT', '/super-admin/ai-scheduling-optimizer/platform-switch', { killed: true, reason: 'Live proof: platform pause of the optimizer' });
  await sleep(16_000);   // the engine caches the platform switch for 15 s
  const killedGen = await own.call('POST', `${P}/recommendations/generate`, { appointmentId: A2.id });
  const view = await own.call('GET', `${P}/settings`);
  const unkill = await sa('PUT', '/super-admin/ai-scheduling-optimizer/platform-switch', { killed: false, reason: 'Live proof: platform pause finished' });
  check('the platform switch needs step-up; once on, the salon sees platformKilled and generation is refused; it is switched back off',
    !ok2(noStep.status) && noStep.status < 500 && ok2(kill.status) && view.body?.effective?.platformKilled === true && killedGen.status === 403 && ok2(unkill.status),
    `${noStep.status} ${kill.status} gen ${killedGen.status} ${code(killedGen.body)} view ${view.body?.effective?.platformKilled} un ${unkill.status}`);
  const audits = (await q(`select count(*)::int as n from audit_events where tenant_id = $1 and module = 'ai_scheduling_optimizer' and created_at >= $2`, [T, STARTED]))[0].n;
  check('the optimizer\'s actions are audited (audit_events: generate, accept, customer decision, apply, rollback, settings, run)', audits >= 8, `audit rows ${audits}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
