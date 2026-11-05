#!/usr/bin/env node
// live-local-day.mjs — Unit 9 (Oct 6 2026): the salon-facing "today" figures are the BRANCH's day, proved on the real API
// and PostgreSQL. Nothing is stubbed: the owner signs in, works in a proof branch, and reads the same endpoints the POS
// screens call.
//
// The proof branch's zone is chosen at run time so that its date differs from the UTC date RIGHT NOW (Pacific/Kiritimati,
// UTC+14, when it is already tomorrow there; Pacific/Pago_Pago, UTC−11, when it is still yesterday). Three paid, tipped
// tickets with cash payments and a technician's service line each:
//   EARLY   30 min after the branch's midnight — TODAY at the branch, but a different UTC date than now
//   BEFORE  30 min before the branch's midnight — YESTERDAY at the branch
//   RECENT  1 minute ago — today everywhere
// Every "today" figure must be EARLY + RECENT. The UTC day counted RECENT only (and, at other hours, BEFORE too).
// Run:  DATABASE_URL=postgres://… node scripts/live-local-day.mjs   (apps/api built). Never point it at production: it
// creates a proof branch and removes it, with everything in it, at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = 3041, API = `http://127.0.0.1:${API_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const info = (s) => results.push(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const money = (c) => '$' + (c / 100).toFixed(2);

// the branch's zone: one whose date differs from UTC's right now
const TZ_NAME = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((z) => ymd(z) !== ymd('UTC'));
const TODAY = ymd(TZ_NAME), UTC_TODAY = ymd('UTC');
// the branch's midnight as an instant: search the hour around it (whole-hour zones; no DST in either)
const midnight = (() => { const base = Date.parse(TODAY + 'T00:00:00Z'); for (let h = -15; h <= 15; h++) { const t = base - h * 3600_000; if (ymd(TZ_NAME, new Date(t)) === TODAY && ymd(TZ_NAME, new Date(t - 1)) !== TODAY) return t; } throw new Error('no midnight'); })();
const AT = { early: new Date(midnight + 30 * 60_000), before: new Date(midnight - 30 * 60_000), recent: new Date(Date.now() - 60_000) };
const AMOUNT = { early: 2000, before: 4000, recent: 1000 }, TIP = { early: 200, before: 400, recent: 100 };

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const salon = (await q(`select t.id as tenant_id from tenants t where t.tenant_code = $1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id;
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live Local Day Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
const B = randomUUID(), BRANCH_NAME = `Live Local Day Proof ${String(Date.now()).slice(-5)}`;
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active',$4)`, [B, T, BRANCH_NAME, TZ_NAME]);
const C = randomUUID(), TECH = randomUUID();
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Day','Localproof','Day Localproof')`, [C, T, B]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Mia','Localproof','Mia Localproof','active')`, [TECH, T, B]);
for (const k of ['early', 'before', 'recent']) {
  const at = AT[k].toISOString();
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, primary_technician_id, serving_started_at, service_done_at, ready_checkout_at, paid_at, tip_cents, subtotal_cents)
    values ($1,$2,$3,'paid',$4, $5::timestamptz - interval '30 minutes', $5, $5, $5, $6, $7) returning id`, [T, B, C, TECH, at, TIP[k], AMOUNT[k]]))[0].id;
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, created_at)
    values ($1,$2,$3,$4,'00000000-0000-0000-0000-000000000000','Gel Manicure',$5,30,$5,'completed',$6)`, [T, B, tk, TECH, AMOUNT[k], at]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',$4,$5,'approved',$6)`, [T, B, tk, AMOUNT[k], TIP[k], at]);
}
const WANT = { revenue: AMOUNT.early + AMOUNT.recent, tips: TIP.early + TIP.recent };

const apiEnv = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' };
let apiProc = null, apiErr = '';
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const j = async (r) => { const t = await r.text(); try { return { status: r.status, ok: r.ok, body: JSON.parse(t) }; } catch { return { status: r.status, ok: r.ok, body: t }; } };
const cleanup = async () => {
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  const gone = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select count(*)::int as n from branches where id = $1`, [B]))[0].n;
  check('the proof branch and everything in it is removed', gone.removed && left === 0, gone.kept.length ? `kept: ${gone.kept.join(', ')}` : '');
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 4 * 60_000);

try {
  info(`proof branch "${BRANCH_NAME}" in ${TZ_NAME}: today there is ${TODAY}, in UTC ${UTC_TODAY}`);
  info(`EARLY ${AT.early.toISOString()} (${money(AMOUNT.early)}), BEFORE ${AT.before.toISOString()} (${money(AMOUNT.before)}), RECENT ${AT.recent.toISOString()} (${money(AMOUNT.recent)})`);
  apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  const booted = await up(API + '/health/ready');
  if (!check('API booted (health/ready)', booted, booted ? '' : apiErr.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  let cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c])); for (const c of (sel.headers.getSetCookie?.() ?? []).map((x) => x.split(';')[0])) jar.set(c.split('=')[0], c); cookie = [...jar.values()].join('; ');
  check('the owner signs in and works in the proof branch', login.ok && sel.ok, `login ${login.status}, select-branch ${sel.status}`);
  const get = async (path) => j(await fetch(API + path, { headers: { cookie } }));

  const ov = await get('/pos/overview/state');
  check('POS Overview: the business date is the branch\'s', ov.body?.context?.businessDate === TODAY && ov.body?.context?.timezone === TZ_NAME, `${ov.status} ${ov.body?.context?.businessDate} ${ov.body?.context?.timezone}`);
  check('POS Overview: today\'s revenue is EARLY + RECENT', ov.body?.kpis?.todayRevenue?.amountCents === WANT.revenue, `${money(ov.body?.kpis?.todayRevenue?.amountCents ?? -1)} (want ${money(WANT.revenue)})`);
  const trend = Object.fromEntries((ov.body?.analytics?.revenueTrend ?? []).map((p) => [p.date, p.revenueCents]));
  check('POS Overview: the revenue trend files BEFORE under yesterday, as YYYY-MM-DD', trend[TODAY] === WANT.revenue && Object.values(trend).includes(AMOUNT.before), JSON.stringify(trend));

  const db = await get('/pos/dashboard/state');
  const dk = db.body?.kpis ?? db.body?.state?.kpis;
  check('POS Dashboard: today\'s revenue is EARLY + RECENT', dk?.todayRevenueCents === WANT.revenue, `${db.status} ${money(dk?.todayRevenueCents ?? -1)}`);

  const co = await get('/pos/checkout/state');
  const ck = co.body?.kpisFull ?? co.body?.state?.kpisFull;
  check('POS Checkout: tips today and paid tickets today are EARLY + RECENT', ck?.tipsTodayCents === WANT.tips && ck?.paidTicketsToday === 2, `${co.status} tips ${money(ck?.tipsTodayCents ?? -1)}, paid ${ck?.paidTicketsToday}`);

  const sd = await get('/pos/service-done/state');
  const sk = sd.body?.kpis ?? sd.body?.state?.kpis;
  check('POS Service Done: tips captured today are EARLY + RECENT', sk?.tipsCapturedCents === WANT.tips, `${sd.status} ${money(sk?.tipsCapturedCents ?? -1)}`);

  const te = await get('/pos/technicians/state');
  const tkf = te.body?.kpisFull ?? te.body?.state?.kpisFull;
  check('POS Technicians: today\'s sales are EARLY + RECENT', tkf?.todaySalesCents === WANT.revenue, `${te.status} ${money(tkf?.todaySalesCents ?? -1)}`);

  const cd = await get('/pos/cash-drawer');
  const cdb = cd.body?.drawer ?? cd.body;
  check('Cash drawer: opens on the branch\'s business date', cdb?.businessDate === TODAY, `${cd.status} ${cdb?.businessDate}`);
  const cashKeys = Object.entries(cdb ?? {}).filter(([k, v]) => typeof v === 'number' && /sales|cash/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
  check('Cash drawer: the register cash is EARLY + RECENT', Object.entries(cdb ?? {}).some(([k, v]) => /cashSales|salesCents|registerCash/i.test(k) && v === WANT.revenue), cashKeys);

  const errs = apiErr.split('\n').filter((l) => /\bERROR\b|Unhandled|TypeError/.test(l));
  check('the API logged no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e));
} finally {
  clearTimeout(timer);
  await cleanup();
}
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
