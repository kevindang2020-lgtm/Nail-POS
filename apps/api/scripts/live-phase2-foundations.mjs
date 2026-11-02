#!/usr/bin/env node
// live-phase2-foundations.mjs — Phase 2 of BUILD_PLAN_2026-10-06, proved on the real API (TWO processes) and PostgreSQL.
//
//   1. Schedulers are single-owner across processes (migration 518): two API processes run every background scheduler;
//      each scheduler's runs stay within one per interval for the whole fleet, and the second process records skips.
//   2. The ONE job queue (migration 519) is drained by both processes' workers, each job exactly once: a Super Admin
//      self-test enqueues 20 jobs through the API; all succeed with attempts = 1, processed by both processes.
//   3. The Super Admin jobs API: stats, list (payload keys only), a retry without a reason is refused, a salon owner is
//      refused.
//   4. The tenant messenger: an SMS receipt goes out as the SALON's text — a notifications row and
//      communication.sms_sent in the outbox, with neither the number nor the text in the event.
//   5. Customer activation codes are texted (before Phase 2 every request answered 503: the send used an empty tenant).
//
// Run:  DATABASE_URL=postgres://… node scripts/live-phase2-foundations.mjs   (apps/api built, mock SMS — no TWILIO_*).
// Never point it at production: it creates a proof branch, customer, ticket and Super Admin user and removes them.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORTS = [3048, 3049], API = PORTS.map((p) => `http://127.0.0.1:${p}`);
const SALON = process.env.SALON_CODE || 'PILOT01', OWNER = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', OWNER_PW = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Phase2 Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
const tag = String(Date.now()).slice(-6);
const B = randomUUID(), C = randomUUID(), TECH = randomUUID(), TICKET = randomUUID();
const PHONE = `+1856555${tag.slice(-4)}`, ACT_PHONE = `+1856556${tag.slice(-4)}`;
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active','UTC')`, [B, T, `Live Phase2 Proof ${tag}`]);
// BUILD_PLAN Phase 9 (explicit branch grants CONFINE): grant the seeded owner the proof branch as a manager would (removed
// with the branch by the proof cleanup) — without it select-branch answers 404 (Oct 22 2026, tooling/ci/live-proofs.sh).
{ const oid = (await q(`select id from users where tenant_id = $1 and lower(email) = lower($2) limit 1`, [T, OWNER]))[0]?.id;
  if (!oid) { console.error(`owner ${OWNER} not found in salon ${SALON}`); process.exit(2); }
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,'owner') on conflict do nothing`, [T, B, oid]); }
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display) values ($1,$2,$3,'Rita','Receipt','Rita Receipt',$4)`, [C, T, B, PHONE]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Tess','Phase','Tess Phase','active')`, [TECH, T, B]);
const svc = (await q(`select id, name, price_cents from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 1`, [T]))[0];
if (!svc) { console.error('the salon needs an active service'); process.exit(2); }
await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5, now())`, [TICKET, T, B, C, TECH]);
await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,30,$7)`, [T, B, TICKET, svc.id, TECH, svc.name, Number(svc.price_cents)]);
const SA = randomUUID(), SA_EMAIL = `phase2-proof-${tag}@aipowersalon.test`, SA_PW = 'Phase2!Proof-' + randomUUID().slice(0, 8);
await q(`insert into users (id, tenant_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled, platform_role) values ($1, null, 'Pat', 'Platform', 'Pat Platform', $2, $3, 'active', 'SUPER_ADMIN', false, 'PLATFORM_OPERATIONS')`, [SA, SA_EMAIL, await hashPassword(SA_PW)]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', JOBS_IDLE_POLL_MS: '200' };
for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'JOBS_WORKER', 'PROCESS_ROLE', 'WORKER_JOB_CLASSES']) delete env[k];
const procs = []; const errs = ['', ''];
const up = async (url, tries = 200) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const cleanup = async () => {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* */ } }
  await sleep(1500);
  const notes = (await q(`select id from notifications where tenant_id = $1 and to_address = $2`, [T, PHONE])).map((r) => String(r.id));
  await q(`delete from outbox_events where tenant_id = $1 and aggregate_id::text = any($2::text[])`, [T, notes]).catch(() => undefined);
  await q(`delete from notifications where id = any($1::uuid[])`, [notes]).catch(() => undefined);
  await q(`delete from customer_phone_verifications where normalized_phone = $1`, [ACT_PHONE]).catch(() => undefined);
  await q(`delete from jobs where job_type = 'jobs.self_test' and created_by = $1`, [SA]).catch(() => undefined);
  for (const t of ['refresh_tokens', 'sessions', 'auth_events', 'auth_devices']) await q(`delete from ${t} where user_id = $1`, [SA]).catch(() => undefined);
  await q(`delete from login_attempts where identifier = $1`, [SA_EMAIL]).catch(() => undefined);
  await q(`delete from users where id = $1`, [SA]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from users where id = $2) + (select count(*)::int from jobs where created_by = $2::text) as n`, [B, SA]))[0].n;
  check('the proof branch, customer, ticket, notifications, jobs and Super Admin user are removed', a.removed && left === 0, a.kept?.join(', ') ?? '');
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 5 * 60_000);

const snapshot = async () => Object.fromEntries((await q(`select name, runs, skipped, every_ms from scheduler_runs`)).map((r) => [r.name, { runs: Number(r.runs), skipped: Number(r.skipped), everyMs: r.every_ms == null ? null : Number(r.every_ms) }]));

try {
  const s0 = await snapshot();
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    const p = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: { ...env, PORT: String(PORTS[i]), HOSTNAME: `phase2-proof-${i}` }, stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (c) => { errs[i] += c; });
    procs.push(p);
  }
  const booted = await Promise.all(API.map((a) => up(a + '/health/ready')));
  if (!check('two API processes booted against the same database', booted.every(Boolean), errs.map((e) => e.split('\n').filter(Boolean).slice(-2).join(' | ')).join(' || '))) throw new Error('the API did not boot');

  // ── 2/3: Super Admin + the job queue ──────────────────────────────────────────────────────────────────────────────
  const native = { 'content-type': 'application/json', 'x-client-type': 'native' };
  const saLogin = await j(await fetch(API[0] + '/auth/login', { method: 'POST', headers: native, body: JSON.stringify({ portal: 'super-admin', identifier: SA_EMAIL, password: SA_PW, mfaCode: '123456' }) }));
  const saTok = saLogin.body?.accessToken ?? saLogin.body?.token;
  check('a Super Admin signs in', saLogin.status === 200 && !!saTok, `status ${saLogin.status}`);
  const sa = (method, path, body) => fetch(API[0] + path, { method, headers: { ...native, authorization: `Bearer ${saTok}` }, body: body ? JSON.stringify(body) : undefined }).then(j);

  const stats = await sa('GET', '/super-admin/jobs/stats');
  check('GET /super-admin/jobs/stats lists the six job classes and the self-test handler', stats.status === 200 && stats.body?.classes?.length === 6 && stats.body?.handlers?.includes('jobs.self_test'), `status ${stats.status}`);
  const st = await sa('POST', '/super-admin/jobs/self-test', { count: 20, holdMs: 300 });
  const ids = st.body?.ids ?? [];
  check('POST /super-admin/jobs/self-test queues 20 jobs', st.status === 201 || st.status === 200 ? ids.length === 20 : false, `status ${st.status} ${JSON.stringify(st.body).slice(0, 200)}`);
  let done = [];
  for (let i = 0; i < 80; i++) {
    done = await q(`select id, status, attempts, result->>'processedBy' as by from jobs where id = any($1::uuid[])`, [ids]);
    if (done.length === 20 && done.every((r) => r.status === 'succeeded')) break;
    await sleep(250);
  }
  const by = new Set(done.map((r) => r.by));
  check('all 20 jobs succeeded, each exactly once (attempts = 1)', done.length === 20 && done.every((r) => r.status === 'succeeded' && Number(r.attempts) === 1), JSON.stringify(done.reduce((m, r) => ({ ...m, [r.status + '/' + r.attempts]: (m[r.status + '/' + r.attempts] ?? 0) + 1 }), {})));
  check('both processes\' workers took jobs (one queue, two workers, SKIP LOCKED)', by.size === 2, [...by].join(', '));
  const list = await sa('GET', '/super-admin/jobs?status=succeeded&jobClass=standard&limit=5');
  check('GET /super-admin/jobs lists jobs with payload KEYS only, never values', list.status === 200 && Array.isArray(list.body?.items) && list.body.items.every((x) => Array.isArray(x.payloadKeys) && !('payload' in x)), `status ${list.status}`);
  const noReason = await sa('POST', `/super-admin/jobs/${ids[0]}/retry`, { reason: 'x' });
  check('a retry without a real reason is refused (400)', noReason.status === 400, `status ${noReason.status}`);

  // ── 4: the tenant messenger (owner, cookie session) ───────────────────────────────────────────────────────────────
  const login = await fetch(API[1] + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: OWNER, password: OWNER_PW }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('the salon owner signs in', login.status === 200 && !!cookie, `status ${login.status}`);
  const sel = await fetch(API[1] + '/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const cookie2 = [cookie, ...(sel.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])].join('; ');
  const owner = (method, path, body) => fetch(API[1] + path, { method, headers: { cookie: cookie2, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(j);
  const denied = await owner('GET', '/super-admin/jobs/stats');
  check('a salon owner cannot read the platform job queue', denied.status === 401 || denied.status === 403, `status ${denied.status}`);
  const rc = await owner('POST', `/pos/checkout/tickets/${TICKET}/receipt/sms`);
  check('POST receipt/sms answers as the salon\'s text (simulated: no SMS provider configured here)', rc.status === 200 || rc.status === 201 ? rc.body?.delivery === 'simulated' && rc.body?.configured === true : false, `status ${rc.status} ${JSON.stringify(rc.body).slice(0, 160)}`);
  const note = (await q(`select id, status, customer_id from notifications where tenant_id = $1 and to_address = $2 order by created_at desc limit 1`, [T, PHONE]))[0];
  check('the receipt is in the salon\'s notification ledger', note?.status === 'simulated' && note?.customer_id === C, JSON.stringify(note ?? null));
  const ev = note ? (await q(`select event_type, payload_json from outbox_events where tenant_id = $1 and aggregate_id = $2`, [T, String(note.id)]))[0] : null;
  check('communication.sms_sent was written with it (purpose receipt)', ev?.event_type === 'communication.sms_sent' && ev?.payload_json?.purpose === 'receipt' && ev?.payload_json?.simulated === true, JSON.stringify(ev ?? null).slice(0, 200));
  check('the event carries neither the phone number nor the text', !!ev && !JSON.stringify(ev.payload_json).includes(PHONE.slice(2)) && !/receipt total/i.test(JSON.stringify(ev.payload_json)));

  // ── 5: customer activation codes are texted ───────────────────────────────────────────────────────────────────────
  const act = await fetch(API[1] + '/customer/auth/activation/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: ACT_PHONE, deviceId: 'phase2-proof-' + tag }) }).then(j);
  check('a customer activation code is sent (was 503 sms_unavailable before Phase 2)', act.status === 200 && act.body?.ok === true, `status ${act.status} ${JSON.stringify(act.body).slice(0, 120)}`);
  const stored = (await q(`select count(*)::int as n from customer_phone_verifications where normalized_phone = $1`, [ACT_PHONE]))[0].n;
  check('…and only its hash is stored', stored === 1);

  // ── 1: schedulers single-owner across the two processes ───────────────────────────────────────────────────────────
  // 80 s: every scheduler whose interval is a minute or less fires in BOTH processes at least once.
  const wait = Math.max(0, 80_000 - (Date.now() - t0)); await sleep(wait);
  const s1 = await snapshot(); const windowMs = Date.now() - t0;
  const rows = Object.entries(s1).map(([name, v]) => ({ name, dRuns: v.runs - (s0[name]?.runs ?? 0), dSkipped: v.skipped - (s0[name]?.skipped ?? 0), everyMs: v.everyMs }));
  const ran = rows.filter((r) => r.dRuns > 0);
  const over = rows.filter((r) => r.everyMs && r.dRuns > Math.floor(windowMs / (0.8 * r.everyMs)) + 1);
  const skippedTotal = rows.reduce((s, r) => s + r.dSkipped, 0);
  check('the schedulers ran while both processes were up', ran.length >= 3, `${ran.length} schedulers ran in ${Math.round(windowMs / 1000)} s: ${ran.map((r) => `${r.name} (every ${r.everyMs / 1000} s) runs ${r.dRuns} skipped ${r.dSkipped}`).join('; ')}`);
  check('no scheduler ran more than once per interval across the fleet', over.length === 0, over.map((r) => `${r.name}: ${r.dRuns} runs, every ${r.everyMs} ms`).join('; '));
  check('the second process skipped ticks the first had already run', skippedTotal >= 1, `${skippedTotal} skips across ${rows.filter((r) => r.dSkipped > 0).length} schedulers`);
  // Each tick fires in both processes; one runs it, the other is refused. A scheduler whose interval fits twice in the
  // window must therefore show at least one skip for its runs (one per process would show none).
  const paired = ran.filter((r) => r.everyMs && r.everyMs * 2 <= windowMs);
  check('every scheduler that ticked in both processes ran once and was skipped by the other', paired.length > 0 && paired.every((r) => r.dSkipped >= 1), paired.map((r) => `${r.name}: ran ${r.dRuns}, skipped ${r.dSkipped}`).join('; '));
  const leases = (await q(`select count(*)::int as n from scheduler_runs where lease_owner is not null and lease_until < now()`))[0].n;
  check('no lapsed lease is left behind', leases === 0, `${leases}`);
} catch (e) {
  check('the proof ran to the end', false, String(e?.message || e));
} finally {
  clearTimeout(timer);
  await cleanup().catch((e) => check('cleanup', false, String(e?.message || e)));
  for (const r of results) console.log(r);
  console.log(failed ? `${failed} FAILED of ${results.length}` : `ALL ${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
