#!/usr/bin/env node
// live-multibranch.mjs — Oct 14 build plan ("live-multibranch", §140 branch price / duration / availability, §121 branch
// confinement), proved on the REAL API and PostgreSQL, rebuilt Oct 21 2026. Nothing is stubbed: staff sign in and call the
// same endpoints the POS screens call. Two proof locations of one salon — Main and Cherry Hill — each with its OWN row for
// "Gel Manicure" ($45 / 45 min at Main, $55 / 60 min at Cherry Hill) and its own technician:
//   1. a manager granted Main only cannot enter Cherry Hill (select-branch refused); the owner, granted both, can
//   2. the services list at each location shows THAT location's price and duration
//   3. a Cherry Hill booking naming Main's service row is refused; with its own row it is booked at $55 / 60 min
//   4. Main's technician cannot be booked at Cherry Hill
//   5. the booking board and the checkout queue at Main never show Cherry Hill's appointment or ticket
// Run:  DATABASE_URL=postgres://…/<scratch copy> node scripts/live-multibranch.mjs   (apps/api built). Never point it at
// production: it creates two proof branches and removes them, with everything in them, at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { hashPassword } = require('@aipowersalon/auth');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const PORT = Number(process.env.PORT_PROOF || 3075), API = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t }; } };
const ok2 = (s) => s === 200 || s === 201;
const short = (x) => JSON.stringify(x ?? null).slice(0, 300);

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const T = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0]?.id;
if (!T) { console.error(`salon ${SALON} not found`); process.exit(2); }
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Multibranch Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);

const tag = String(Date.now()).slice(-6);
const MAIN = randomUUID(), CH = randomUUID(), OWN = randomUUID(), MGR = randomUUID(), CUST = randomUUID(), CAT = randomUUID();
const GEL_MAIN = randomUUID(), GEL_CH = randomUUID(), TINA = randomUUID(), TOM = randomUUID();
const PW = 'Branch!' + randomUUID().slice(0, 10);
const hash = await hashPassword(PW);
const email = (k) => `mb-${k}-${tag}@aipowersalon.test`;
await q(`insert into branches (id, tenant_id, name, status, timezone, address) values ($1,$3,$4,'active','America/New_York','1 Main St'), ($2,$3,$5,'active','America/New_York','2 Cherry Hill Rd')`, [MAIN, CH, T, `Live Multibranch Proof Main ${tag}`, `Live Multibranch Proof Cherry Hill ${tag}`]);
await q(`insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values ($1,$3,$4,'Olga','Proof','Olga Proof',$5,$7,'active','OWNER'), ($2,$3,$4,'Max','Proof','Max Proof',$6,$7,'active','MANAGER')`, [OWN, MGR, T, MAIN, email('owner'), email('mgr'), hash]);
await q(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) values ($1,$2,$4,'owner'), ($1,$3,$4,'owner'), ($1,$2,$5,'manager')`, [T, MAIN, CH, OWN, MGR]);   // the manager: Main only
await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,$4)`, [CAT, T, MAIN, `Multibranch Proof ${tag}`]);
await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$3,$4,$6,'Gel Manicure',45,4500,'active'), ($2,$3,$5,$6,'Gel Manicure',60,5500,'active')`, [GEL_MAIN, GEL_CH, T, MAIN, CH, CAT]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$3,$4,'Tina','Proof','Tina Proof','active'), ($2,$3,$5,'Tom','Proof','Tom Proof','active')`, [TINA, TOM, T, MAIN, CH]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Pat','Proof','Pat Proof')`, [CUST, T, MAIN]);
// each technician is approved for her own location's row (the skills gate is a hard rule — never overridable)
await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values ($1,$2,$3,$4,true), ($1,$5,$6,$7,true)`, [T, MAIN, TINA, GEL_MAIN, CH, TOM, GEL_CH]);
const CH_TICKET = randomUUID();
await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,0, now())`, [CH_TICKET, T, CH, CUST, TOM]);
await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,'Gel Manicure',5500,60,5500)`, [T, CH, CH_TICKET, GEL_CH, TOM]);

const env = { ...process.env, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), TRUST_PROXY_HOPS: '1' };
for (const k of ['PROCESS_ROLE', 'CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY']) delete env[k];
Object.assign(env, { AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', COMPENSATION_RECOVERY: 'off' });
let proc = null; let errs = '';
const cleanup = async () => {
  try { proc?.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from login_attempts where identifier = any($1::text[])`, [[email('owner'), email('mgr')]]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, CH).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const b = await removeProofBranchTx(client, T, MAIN).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select count(*)::int as n from branches where id = any($1::uuid[])`, [[MAIN, CH]]))[0].n;
  check('both proof branches and everything in them are removed', a.removed && b.removed && left === 0, [...(a.kept ?? []), ...(b.kept ?? [])].join(', '));
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 5 * 60_000);

const session = (key) => {
  const jar = new Map(); const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); } };
  const hdr = (extra = {}) => ({ 'content-type': 'application/json', cookie: [...jar.values()].join('; '), ...extra });
  const call = (method, path, body, extra = {}) => fetch(API + path, { method, headers: hdr(extra), body: body ? JSON.stringify(body) : undefined }).then((r) => { keep(r); return j(r); });
  return { call, login: () => call('POST', '/auth/login', { portal: 'tenant', salonCode: SALON, identifier: email(key), password: PW }), at: (branchId) => call('POST', '/auth/select-branch', { branchId }) };
};
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DAY = ymd(new Date(Date.now() + 3 * 86_400_000));
const svcOf = (body) => (Array.isArray(body) ? body : body?.items ?? body?.services ?? body?.state?.services ?? []);
const apptIds = (body) => JSON.stringify(body ?? null);

try {
  proc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (c) => { errs += c; });
  let up = false; for (let i = 0; i < 320 && !up; i++) { try { up = (await fetch(API + '/health')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  if (!check('the API booted against PostgreSQL', up, errs.split('\n').filter(Boolean).slice(-2).join(' | '))) throw new Error('the API did not boot');

  // ── 1. confinement ──────────────────────────────────────────────────────────────────────────────────────────────────
  const mgr = session('mgr'); const ml = await mgr.login(); const mMain = await mgr.at(MAIN); const mCh = await mgr.at(CH);
  check('a manager granted Main only: enters Main, is refused Cherry Hill (§121)', ok2(ml.status) && ok2(mMain.status) && mCh.status >= 400 && mCh.status < 500, `login ${ml.status} main ${mMain.status} cherry ${mCh.status} ${short(mCh.body)}`);
  const own = session('owner'); const ol = await own.login(); const oMain = await own.at(MAIN);
  check('the owner, granted both, enters Main', ok2(ol.status) && ok2(oMain.status), `${ol.status}/${oMain.status}`);

  // ── 2. each location's own price and duration ───────────────────────────────────────────────────────────────────────
  const sMain = await own.call('GET', '/pos/services');
  const gelMain = svcOf(sMain.body).find((s) => (s.id ?? s.serviceId) === GEL_MAIN), gelChAtMain = svcOf(sMain.body).find((s) => (s.id ?? s.serviceId) === GEL_CH);
  const oCh = await own.at(CH);
  const sCh = await own.call('GET', '/pos/services');
  const gelCh = svcOf(sCh.body).find((s) => (s.id ?? s.serviceId) === GEL_CH), gelMainAtCh = svcOf(sCh.body).find((s) => (s.id ?? s.serviceId) === GEL_MAIN);
  const price = (s) => Number(s?.priceCents ?? s?.price_cents ?? NaN), dur = (s) => Number(s?.durationMinutes ?? s?.duration_minutes ?? NaN);
  check('Main lists Gel Manicure at $45 / 45 min and not Cherry Hill\'s row', ok2(sMain.status) && price(gelMain) === 4500 && dur(gelMain) === 45 && !gelChAtMain, `${sMain.status} ${short({ main: gelMain && [price(gelMain), dur(gelMain)], other: !!gelChAtMain })}`);
  check('Cherry Hill lists Gel Manicure at $55 / 60 min and not Main\'s row', ok2(oCh.status) && ok2(sCh.status) && price(gelCh) === 5500 && dur(gelCh) === 60 && !gelMainAtCh, `${sCh.status} ${short({ ch: gelCh && [price(gelCh), dur(gelCh)], other: !!gelMainAtCh })}`);

  // ── 3 + 4. booking at Cherry Hill ───────────────────────────────────────────────────────────────────────────────────
  const book = (body) => own.call('POST', '/pos/booking/appointments', { customerId: CUST, customerName: 'Pat Proof', date: DAY, source: 'walk_in', ...body }, { 'idempotency-key': 'live-mb-' + randomUUID() });
  const wrongRow = await book({ technicianId: TOM, serviceIds: [GEL_MAIN], startTime: '11:00' });
  check('a Cherry Hill booking naming Main\'s service row is refused', wrongRow.status >= 400 && wrongRow.status < 500, `${wrongRow.status} ${short(wrongRow.body)}`);
  const wrongTech = await book({ technicianId: TINA, serviceIds: [GEL_CH], startTime: '11:00' });
  check('Main\'s technician cannot be booked at Cherry Hill', wrongTech.status >= 400 && wrongTech.status < 500, `${wrongTech.status} ${short(wrongTech.body)}`);
  const good = await book({ technicianId: TOM, serviceIds: [GEL_CH], startTime: '11:00' });
  const apptId = good.body?.appointmentId ?? good.body?.id ?? good.body?.appointment?.id ?? null;
  const row = apptId ? (await q(`select branch_id, technician_id, duration_minutes, services from pos_tech_appointments where id = $1`, [apptId]))[0] : null;
  const line = row ? (Array.isArray(row.services) ? row.services : JSON.parse(String(row.services)))[0] : null;
  check('with its own row the booking is made at Cherry Hill: Tom, $55, 60 minutes', ok2(good.status) && row?.branch_id === CH && row?.technician_id === TOM && Number(row?.duration_minutes) === 60 && Number(line?.priceCents ?? line?.price_cents) === 5500,
    `${good.status} ${!ok2(good.status) ? short(good.body) : ''} ${short({ branch: row?.branch_id === CH ? 'CH' : row?.branch_id, tech: row?.technician_id === TOM ? 'Tom' : row?.technician_id, dur: row?.duration_minutes, line })}`);

  // ── 5. the other location never sees it ─────────────────────────────────────────────────────────────────────────────
  const chBoard = await own.call('GET', `/pos/booking/appointments?date=${DAY}`);
  const chQueue = await own.call('GET', '/pos/checkout/state');
  await own.at(MAIN);
  const mainBoard = await own.call('GET', `/pos/booking/appointments?date=${DAY}`);
  const mainQueue = await own.call('GET', '/pos/checkout/state');
  check('the booking board: Cherry Hill shows the appointment, Main does not', ok2(chBoard.status) && ok2(mainBoard.status) && apptIds(chBoard.body).includes(apptId) && !apptIds(mainBoard.body).includes(apptId), `${chBoard.status}/${mainBoard.status}`);
  check('the checkout queue: Cherry Hill shows its ticket, Main does not', ok2(chQueue.status) && ok2(mainQueue.status) && apptIds(chQueue.body).includes(CH_TICKET) && !apptIds(mainQueue.body).includes(CH_TICKET), `${chQueue.status}/${mainQueue.status}`);

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
