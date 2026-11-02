#!/usr/bin/env node
// live-payroll-plans.mjs — Oct 14 build plan ("live-payroll-plans"): the four pay plans (§44) proved on the REAL API and
// PostgreSQL, rebuilt Oct 21 2026. Nothing is stubbed: the owner signs in, re-proves the password (step-up) and creates
// the plans through the same endpoint the Compensation screen calls; the front desk takes cash through the POS endpoint;
// the time clock's rows stand in for the punches (closed shifts with server timestamps, §39).
//   Four technicians, each one $100 Gel ticket (60% commission) and one 8-hour shift with a 30-minute break, in one period:
//     commission  → $60.00 commission, no hourly, no salary
//     hourly      → $20/h × 7.5 paid hours = $150.00 (the unpaid break is off the clock); NO commission (§44)
//     salary      → $500.00 for the whole period; NO commission
//     hybrid      → $60.00 commission + $20/h × 7.5 h = $150.00 hourly
//   One plan at a time: a second plan over the same dates is PAY_PLAN_CONFLICT at the DATABASE (exclusion constraint),
//   so a technician is never priced twice; an ARCHIVED plan is out of play (the salary technician's archived hourly plan
//   adds nothing, and its dates are free again); a plan body the engine cannot price (an hourly plan with no rate) is
//   refused with VALIDATION_FAILED; the receptionist cannot create a plan (compensation.manage), and the owner cannot
//   without a fresh step-up.
// Run:  DATABASE_URL=postgres://…/<scratch copy> node scripts/live-payroll-plans.mjs   (apps/api built). Never point it at
// production: it creates a proof branch, staff, technicians, shifts and tickets, and removes everything it made at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3073), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 300);
const code = (r) => r.body?.code ?? r.body?.error?.code ?? r.body?.details?.code ?? null;

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Pay Plans Proof%'`, [T])) {
  const ps = (await q(`select id from payroll_periods where branch_id = $1`, [r.id])).map((x) => x.id);
  if (ps.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [ps]);
  await q(`delete from technician_pay_plans where tenant_id = $1 and technician_id in (select id from technicians where branch_id = $2)`, [T, r.id]);
  await removeProofBranchTx(client, T, r.id);
}

const tag = String(Date.now()).slice(-6);
const B = randomUUID(), OWN = randomUUID(), REC = randomUUID(), CUST = randomUUID(), CAT = randomUUID(), SVC = randomUUID();
const TECH = { commission: randomUUID(), hourly: randomUUID(), salary: randomUUID(), hybrid: randomUUID() };
const PW = 'Plans!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `plans-${k}-${tag}@aipowersalon.test`;
const addUser = async (id, role, key, level, fn) => {
  await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$2,$3,$4,'Proof',$4 || ' Proof',$5,$6,'active',$7)`, [id, T, B, fn, email(key), hash, role]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$3,$4)`, [T, B, id, level]);
};
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$2,$3,'active','America/New_York','1 Pay Plan Way')`, [B, T, `Live Pay Plans Proof ${tag}`]);
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4)`, [CAT, T, B, `Pay Plans Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$2,$3,$4,'Plan Gel',45,10000,'active','percent',60)`, [SVC, T, B, CAT]);
await addUser(OWN, 'OWNER', 'owner', 'manager', 'Olga');
await addUser(REC, 'RECEPTION', 'rec', 'staff', 'Rae');
for (const [k, id] of Object.entries(TECH)) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'Proof',$4 || ' Proof','active')`, [id, T, B, k[0].toUpperCase() + k.slice(1)]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Pat','Proof','Pat Proof')`, [CUST, T, B]);
// yesterday in the salon's zone: one closed 09:00–17:00 shift (server instants) with a 12:00–12:30 break, per technician
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const today = new Date(); const d = (n) => ymd(new Date(today.getTime() + n * 86_400_000));
const DAY = d(-1);
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00-04:00`).toISOString();   // the proof runs in EDT/EST: the exact offset does not matter, only the 8-hour span
for (const id of Object.values(TECH)) {
  const sh = randomUUID();
  await q(`insert into technician_shifts (id, tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4,$5,$6,$7,'completed')`, [sh, T, B, id, DAY, at('09:00'), at('17:00')]);
  await q(`insert into technician_breaks (tenant_id, branch_id, technician_id, shift_id, kind, started_at, ended_at) values ($1,$2,$3,$4,'break',$5,$6)`, [T, B, id, sh, at('12:00'), at('12:30')]);
}
const tickets = {};
for (const [k, id] of Object.entries(TECH)) {
  const tk = randomUUID(); tickets[k] = tk;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,0, now())`, [tk, T, B, CUST, id]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'Plan Gel',10000,45,10000)`, [T, B, tk, SVC, id]);
}

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1', EVENT_PUBLISHER_ENABLED: 'true' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' });
let proc = null; let errs = '';
const periodIds = [];
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('owner'), email('rec')]]).catch(() => undefined);
  if (periodIds.length) await q(`delete from payroll_lines where period_id = any($1::uuid[])`, [periodIds]).catch(() => undefined);
  await q(`delete from technician_pay_plans where tenant_id = $1 and technician_id = any($2::uuid[])`, [T, Object.values(TECH)]).catch(() => undefined);
  await q(`delete from technician_breaks where tenant_id = $1 and technician_id = any($2::uuid[])`, [T, Object.values(TECH)]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select (select count(*)::int from branches where id = $1) + (select count(*)::int from technicians where id = any($2::uuid[])) + (select count(*)::int from technician_pay_plans where technician_id = any($2::uuid[])) + (select count(*)::int from payroll_periods where id = any($3::uuid[])) as n`, [B, Object.values(TECH), periodIds]))[0].n;
  check('the proof branch, staff, technicians, shifts, plans, tickets and periods are removed', a.removed && Number(left) === 0, (a.kept ?? []).join(', ') + ` left=${left}`);
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 6 * 60_000);

const signIn = async (key) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const l = await fetch(API + '/auth/login', { method: 'POST', headers: hdr(), body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }) }); keep(l);
  const s = await fetch(API + '/auth/select-branch', { method: 'POST', headers: hdr(), body: JSON.stringify({ branchId: B }) }); keep(s);
  return { ok: l.status === 200 && s.status === 200, detail: `${key}: login ${l.status} select ${s.status}`,
    call: (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body ? JSON.stringify(body) : undefined }).then((r) => { keep(r); return j(r); }) };
};

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 320 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');
  const own = await signIn('owner'), rec = await signIn('rec');
  check('the owner and the receptionist sign in at the proof branch', own.ok && rec.ok, [own.detail, rec.detail].join(' / '));

  // ── 1. the plans: who may, step-up, what the engine refuses ──────────────────────────────────────────────────────────
  const plan = (technicianId, payType, extra = {}) => ({ technicianId, payType, effectiveStart: d(-30), ...extra });
  const recPlan = await rec.call('POST', '/pos/payroll/pay-plans', plan(TECH.hourly, 'hourly', { hourlyRateCents: 2000 }));
  check('the receptionist cannot create a pay plan (compensation.manage)', recPlan.status === 403, `${recPlan.status}`);
  const noStep = await own.call('POST', '/pos/payroll/pay-plans', plan(TECH.hourly, 'hourly', { hourlyRateCents: 2000 }));
  check('the owner cannot without a fresh step-up (§72)', noStep.status === 403 && JSON.stringify(noStep.body).includes('STEP_UP_REQUIRED'), `${noStep.status} ${short(noStep.body)}`);
  const su = await own.call('POST', '/auth/step-up', { password: PW });
  check('the owner re-proves the password', ok2(su.status), `${su.status}`);
  const noRate = await own.call('POST', '/pos/payroll/pay-plans', plan(TECH.hourly, 'hourly'));
  check('an hourly plan without a rate is refused (VALIDATION_FAILED) — the engine never guesses a wage', noRate.status >= 400 && noRate.status < 500 && /rate|VALIDATION/i.test(JSON.stringify(noRate.body)), `${noRate.status} ${short(noRate.body)}`);
  const made = {};
  const mk = async (name, body) => { const r = await own.call('POST', '/pos/payroll/pay-plans', body); made[name] = r; return r; };
  await mk('hourly', plan(TECH.hourly, 'hourly', { branchId: B, hourlyRateCents: 2000, breaksPaid: false }));
  await mk('salary.oldHourly', plan(TECH.salary, 'hourly', { hourlyRateCents: 9900 }));                   // archived below: out of play
  await mk('hybrid', plan(TECH.hybrid, 'hybrid', { hourlyRateCents: 2000, breaksPaid: false }));
  check('the owner creates the plans through the API (hourly at the branch, an hourly to be archived, hybrid)', Object.values(made).every((r) => ok2(r.status) && r.body?.id), short(Object.fromEntries(Object.entries(made).map(([k, r]) => [k, r.status]))));
  const twice = await own.call('POST', '/pos/payroll/pay-plans', plan(TECH.hourly, 'salary', { salaryCentsPerPeriod: 99900 }));
  check('a second plan over the same dates is PAY_PLAN_CONFLICT (one plan at a time — the database\'s exclusion rule, never a second price)', twice.status === 409 && code(twice) === 'PAY_PLAN_CONFLICT', `${twice.status} ${short(twice.body)}`);
  const arch = await own.call('POST', `/pos/payroll/pay-plans/${made['salary.oldHourly'].body?.id}/archive`, {});
  await mk('salary', plan(TECH.salary, 'salary', { salaryCentsPerPeriod: 50000 }));
  const list = await own.call('GET', `/pos/payroll/pay-plans?technicianId=${TECH.salary}`);
  check('archiving a plan frees its dates: the salary plan now takes them; the list still shows the archived one (nothing is removed)',
    ok2(arch.status) && arch.body?.status === 'archived' && ok2(made.salary.status) && Array.isArray(list.body) && list.body.some((p) => p.id === made['salary.oldHourly'].body?.id && p.status === 'archived') && list.body.some((p) => p.id === made.salary.body?.id && p.status === 'active'),
    `${arch.status}/${made.salary.status} ${short(list.body?.map?.((p) => [p.payType, p.status]))}`);

  // ── 2. the sales: cash through the POS for each technician's ticket ──────────────────────────────────────────────────
  for (const [k, tk] of Object.entries(tickets)) {
    const r = await rec.call('POST', `/pos/checkout/tickets/${tk}/pay/cash`, { amountReceivedCents: 20000 }, { 'idempotency-key': 'live-plans-' + randomUUID() });
    check(`the front desk takes cash for the ${k} technician's $100 ticket (tax on top; change back)`, ok2(r.status), `${r.status} ${short(r.body)}`);
  }
  let snaps = []; for (let i = 0; i < 40; i++) { snaps = await q(`select technician_id, tech_service_earnings_cents from ticket_compensation_snapshots where ticket_id = any($1::uuid[])`, [Object.values(tickets)]); if (snaps.length >= 4) break; await sleep(250); }
  check('every payment wrote its compensation snapshot: 60% of $100 per technician', snaps.length === 4 && snaps.every((s) => Number(s.tech_service_earnings_cents) === 6000), short(snaps.map((s) => Number(s.tech_service_earnings_cents))));

  // ── 3. the period: build → each plan prices its own way ──────────────────────────────────────────────────────────────
  const cp = await own.call('POST', '/pos/payroll/periods', { label: `Plans ${tag}`, periodStart: d(-2), periodEnd: d(0) });
  const P = cp.body?.id; if (P) periodIds.push(P);
  check('the owner opens a pay period around yesterday', ok2(cp.status) && !!P, `${cp.status} ${short(cp.body)}`);
  const prep = await own.call('POST', `/pos/payroll/periods/${P}/prepare`, {});
  const line = (k) => prep.body?.lines?.find((l) => l.technicianId === TECH[k]) ?? {};
  const pick = (l) => ({ commission: Number(l.commissionCents ?? 0), hourly: Number(l.hourlyPayCents ?? 0), minutes: Number(l.workedMinutes ?? 0), salary: Number(l.salaryPayCents ?? 0) });
  const got = Object.fromEntries(Object.keys(TECH).map((k) => [k, pick(line(k))]));
  check('PREPARE builds a line for each of the four technicians', ok2(prep.status) && Object.keys(TECH).every((k) => line(k).technicianId), `${prep.status} ${short(prep.body?.validation)} ${short(got)}`);
  check('commission plan (no plan row = the default): $60.00 commission, no hourly, no salary', got.commission.commission === 6000 && got.commission.hourly === 0 && got.commission.salary === 0, short(got.commission));
  check('hourly plan at the branch: 480 worked minutes, 7.5 paid hours × $20 = $150.00, NO commission, no salary', got.hourly.hourly === 15000 && got.hourly.minutes === 480 && got.hourly.commission === 0 && got.hourly.salary === 0, short(got.hourly));
  check('salary plan: $500.00 for the period, NO commission; the archived hourly plan adds nothing', got.salary.salary === 50000 && got.salary.commission === 0 && got.salary.hourly === 0, short(got.salary));
  check('hybrid plan: $60.00 commission PLUS $150.00 hourly', got.hybrid.commission === 6000 && got.hybrid.hourly === 15000 && got.hybrid.salary === 0, short(got.hybrid));
  const net = Object.fromEntries(Object.keys(TECH).map((k) => [k, Number(line(k).payableCents ?? line(k).netCents ?? NaN)]));
  check('each line\'s payable is the sum of its parts: $60 / $150 / $500 / $210', net.commission === 6000 && net.hourly === 15000 && net.salary === 50000 && net.hybrid === 21000, short(net));

  const errLines = errs.split('\n').filter((l) => /"level":"(error|fatal)"|Unhandled|TypeError/.test(l));
  check('the API logged no errors', errLines.length === 0, errLines.slice(0, 2).join(' | ').slice(0, 400));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e));
} finally {
  clearTimeout(timer);
  await cleanup();
}
console.log(results.join('\n'));
console.log(`\n${results.filter((x) => x.startsWith('PASS')).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
