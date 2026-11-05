#!/usr/bin/env node
// live-checkout-one-payment.mjs — Unit 11 (Oct 6 2026), proved on the real API and PostgreSQL. Nothing is stubbed: the
// owner signs in, works in a proof branch, and calls the same endpoints the POS screens call.
//   1. One payment at a time per ticket: while the customer display's card charge holds the ticket (the lock row the
//      display's charge writes — the card terminal itself cannot be driven from here), front-desk cash is refused with
//      PAYMENT_IN_PROGRESS and nothing is recorded; once it lets go, cash is taken once.
//   2. Hold Ticket / Resume: the ticket leaves the ready-for-payment queue with its tip untouched and comes back.
//   3. Move to Front Desk: the ticket moves to one of this location's registers and shows its name; another location's
//      register, a retired one, and a paid ticket are refused.
//   4. Card terminals are tied to registers: the register is picked from this location's registers, Devices shows its
//      name, another location's register is refused.
// Unit 12 (Oct 6 2026):
//   5. The API is started with TZ=America/New_York and runs in UTC anyway (it says so once, at start).
//   6. A gift card pays part of a ticket: the payment keeps the card's last four, the redemption's ledger row names the
//      ticket and the payment, and the refund preview says which card the money goes back to.
// Run:  DATABASE_URL=postgres://… node scripts/live-checkout-one-payment.mjs   (apps/api built). Never point it at
// production: it creates two proof branches and removes them, with everything in them, at the end.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { removeProofBranchTx } from './proof-cleanup.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
const API_PORT = Number(process.env.PORT_PROOF || 3043), API = `http://127.0.0.1:${API_PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01', EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com', PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new pg.Client({ connectionString: DB }); await client.connect();
const q = async (s, p = []) => (await client.query(s, p)).rows;
const salon = (await q(`select id from tenants where tenant_code = $1`, [SALON]))[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.id;
for (const r of await q(`select id from branches where tenant_id = $1 and name like 'Live One Payment Proof%'`, [T])) await removeProofBranchTx(client, T, r.id);
const B = randomUUID(), B2 = randomUUID(), tag = String(Date.now()).slice(-5);
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,$4,'active','UTC'), ($2,$3,$5,'active','UTC')`, [B, B2, T, `Live One Payment Proof ${tag}`, `Live One Payment Proof ${tag} (other)`]);
const FRONT = randomUUID(), BACK = randomUUID(), RETIRED = randomUUID(), ELSEWHERE = randomUUID();
await q(`insert into pos_stations (id, tenant_id, branch_id, name, retired_at) values ($1,$5,$6,'Front Desk',null), ($2,$5,$6,'Back Register',null), ($3,$5,$6,'Old Register',now()), ($4,$5,$7,'Other Front',null)`, [FRONT, BACK, RETIRED, ELSEWHERE, T, B, B2]);
const C = randomUUID(), TECH = randomUUID();
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Pay','Onceproof','Pay Onceproof')`, [C, T, B]);
await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Ivy','Onceproof','Ivy Onceproof','active')`, [TECH, T, B]);
const svc = (await q(`select id, name, price_cents from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 1`, [T]))[0];
if (!svc) { console.error('the salon needs an active service'); process.exit(2); }
const ticket = async (tipCents = 0) => {
  const id = randomUUID();
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, tip_cents, ready_checkout_at) values ($1,$2,$3,$4,'ready_for_payment',$5,$6, now())`, [id, T, B, C, TECH, tipCents]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,$7,30,$7)`, [T, B, id, svc.id, TECH, svc.name, Number(svc.price_cents)]);
  return id;
};
const PAY = await ticket(), HOLD = await ticket(700), MOVE = await ticket(), GIFT = await ticket();
const GIFT_CODE = 'LIVEPROOF-' + randomUUID().slice(0, 8).toUpperCase(), GIFT_CARD = randomUUID();
await q(`insert into gift_cards (id, tenant_id, branch_id, code, card_number_last4, initial_balance_cents, balance_cents, status) values ($1,$2,null,$3,'4321',1000,1000,'active')`, [GIFT_CARD, T, GIFT_CODE]);
const TERM = 'term_' + String(Date.now()).slice(-6);
await q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, paired_at) values ($1,$2,$3,'Proof Clover','paired',now())`, [TERM, T, B]);

const apiEnv = { ...process.env, TZ: 'America/New_York', REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' };
let apiProc = null, apiErr = '';
const up = async (url, tries = 160) => { for (let i = 0; i < tries; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* booting */ } await sleep(250); } return false; };
const j = async (r) => { const t = await r.text(); try { return { status: r.status, ok: r.ok, body: JSON.parse(t) }; } catch { return { status: r.status, ok: r.ok, body: t }; } };
const cleanup = async () => {
  try { apiProc?.kill('SIGTERM'); } catch { /* */ }
  await q(`delete from pos_payment_terminals where tenant_id = $1 and id = $2`, [T, TERM]).catch(() => undefined);
  await q(`delete from checkout_locks where tenant_id = $1 and ticket_id = any($2::uuid[])`, [T, [PAY, HOLD, MOVE, GIFT]]).catch(() => undefined);
  await q(`delete from gift_card_transactions where gift_card_id = $1`, [GIFT_CARD]).catch(() => undefined);
  const a = await removeProofBranchTx(client, T, B).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  await q(`delete from gift_cards where id = $1`, [GIFT_CARD]).catch(() => undefined);
  const b = await removeProofBranchTx(client, T, B2).catch((e) => ({ removed: false, kept: [String(e?.message || e)] }));
  const left = (await q(`select count(*)::int as n from branches where id = any($1::uuid[])`, [[B, B2]]))[0].n;
  check('the proof branches and everything in them are removed', a.removed && b.removed && left === 0, [...a.kept, ...b.kept].join(', '));
  await client.end();
};
const timer = setTimeout(async () => { console.error('timed out'); await cleanup().catch(() => undefined); process.exit(1); }, 4 * 60_000);

try {
  apiProc = spawn('node', ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env: apiEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  apiProc.stderr.on('data', (c) => { apiErr += c; });
  const booted = await up(API + '/health/ready');
  if (!check('API booted (health/ready)', booted, booted ? '' : apiErr.split('\n').filter(Boolean).slice(-3).join(' | '))) throw new Error('the API did not boot');
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  let cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const sel = await fetch(API + '/auth/select-branch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ branchId: B }) });
  const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c])); for (const c of (sel.headers.getSetCookie?.() ?? []).map((x) => x.split(';')[0])) jar.set(c.split('=')[0], c); cookie = [...jar.values()].join('; ');
  check('the owner signs in and works in the proof branch', login.ok && sel.ok, `login ${login.status}, select-branch ${sel.status}`);
  const call = async (method, path, body, extra = {}) => j(await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined }));
  const cash = (id) => call('POST', `/pos/checkout/tickets/${id}/pay/cash`, { amountReceivedCents: 100000 }, { 'idempotency-key': 'live-one-pay-' + randomUUID() });
  const payments = async (id) => (await q(`select count(*)::int as n from payments where tenant_id = $1 and ticket_id = $2 and status = 'approved'`, [T, id]))[0].n;
  const state = async () => (await call('GET', '/pos/checkout/state')).body;
  const items = (s) => s?.tickets?.items ?? s?.state?.tickets?.items ?? [];

  // ---- 1. one payment at a time per ticket ----
  await q(`insert into checkout_locks (tenant_id, branch_id, ticket_id, owner_user_id, session_id, source, expires_at) values ($1,$2,$3,gen_random_uuid(),$4,'display', now() + interval '4 minutes')`, [T, B, PAY, 'display-pay:' + randomUUID()]);
  const busy = await cash(PAY);
  check('while the display\'s card charge holds the ticket, front-desk cash is refused (409 PAYMENT_IN_PROGRESS)', busy.status === 409 && JSON.stringify(busy.body).includes('PAYMENT_IN_PROGRESS'), `${busy.status} ${JSON.stringify(busy.body).slice(0, 160)}`);
  check('… with words the front desk understands', /paying for this ticket by card on the terminal/i.test(JSON.stringify(busy.body)), '');
  check('… and nothing was recorded', (await payments(PAY)) === 0);
  await q(`delete from checkout_locks where tenant_id = $1 and ticket_id = $2`, [T, PAY]);
  const paid = await cash(PAY);
  check('once the display lets go, cash is taken', paid.ok, `${paid.status}`);
  check('exactly one payment on the ticket, and the front desk\'s own hold is released', (await payments(PAY)) === 1 && (await q(`select count(*)::int as n from checkout_locks where tenant_id = $1 and ticket_id = $2 and released_at is null`, [T, PAY]))[0].n === 0);
  const again = await cash(PAY);
  check('a second cash payment on the paid ticket is refused', !again.ok && (await payments(PAY)) === 1, String(again.status));

  // ---- 2. Hold Ticket / Resume ----
  const h = await call('POST', `/pos/checkout/tickets/${HOLD}/hold`);
  check('Hold Ticket works', h.ok && h.body?.status === 'on_hold', `${h.status} ${h.body?.status}`);
  const s1 = await state();
  const held = items(s1).find((t) => t.id === HOLD || t.ticketId === HOLD);
  check('the held ticket shows "on_hold" and keeps its tip', held?.status === 'on_hold' && (await q(`select tip_cents from tickets where id = $1`, [HOLD]))[0].tip_cents === 700, `${held?.status}`);
  const filtered = items((await call('GET', '/pos/checkout/state?status=on_hold')).body);
  check('the "On Hold" filter finds it', filtered.some((t) => (t.id ?? t.ticketId) === HOLD), `${filtered.length} row(s)`);
  const r = await call('POST', `/pos/checkout/tickets/${HOLD}/resume`);
  const back = items(await state()).find((t) => (t.id ?? t.ticketId) === HOLD);
  check('Resume puts it back in the checkout queue', r.ok && back?.status === 'ready_for_payment', `${r.status} ${back?.status}`);
  const hp = await call('POST', `/pos/checkout/tickets/${PAY}/hold`);
  check('a paid ticket cannot be held', !hp.ok, String(hp.status));

  // ---- 3. Move to Front Desk ----
  const mv = await call('POST', `/pos/checkout/tickets/${MOVE}/move`, { registerId: BACK });
  check('Move to a register of this location works and names it', mv.ok && mv.body?.station === 'Back Register', `${mv.status} ${mv.body?.station}`);
  const moved = (await q(`select checkout_register_id, station_label from tickets where id = $1`, [MOVE]))[0];
  check('the ticket now belongs to that register', moved.checkout_register_id === BACK && moved.station_label === 'Back Register');
  const ui = items(await state()).find((t) => (t.id ?? t.ticketId) === MOVE);
  check('the POS list shows the register\'s name', ui?.station === 'Back Register', `${ui?.station}`);
  for (const [what, reg] of [['another location\'s register', ELSEWHERE], ['a retired register', RETIRED], ['nonsense', 'nope']]) {
    const bad = await call('POST', `/pos/checkout/tickets/${MOVE}/move`, { registerId: reg });
    check(`Move to ${what} is refused`, !bad.ok && bad.status < 500, String(bad.status));
  }
  const mp = await call('POST', `/pos/checkout/tickets/${PAY}/move`, { registerId: FRONT });
  check('a paid ticket is not moved', !mp.ok && mp.status < 500, String(mp.status));

  // ---- 4. card terminals tied to registers ----
  const tr = await call('POST', `/pos/settings/payments-checkout/terminals/${TERM}/register`, { stationId: FRONT });
  check('the terminal is tied to a register of this location', tr.ok && tr.body?.registerName === 'Front Desk', `${tr.status} ${tr.body?.registerName}`);
  const ov = await call('GET', '/pos/devices/overview');
  const t = (ov.body?.terminals ?? ov.body?.state?.terminals ?? []).find((x) => x.id === TERM);
  check('Devices shows the register\'s name, not an id', t?.station === 'Front Desk', `${ov.status} ${t?.station}`);
  const tb = await call('POST', `/pos/settings/payments-checkout/terminals/${TERM}/register`, { stationId: ELSEWHERE });
  check('another location\'s register is refused, and nothing changes', !tb.ok && tb.status < 500 && (await q(`select station_id from pos_payment_terminals where tenant_id = $1 and id = $2`, [T, TERM]))[0].station_id === FRONT, String(tb.status));
  const tc = await call('POST', `/pos/settings/payments-checkout/terminals/${TERM}/register`, { stationId: null });
  check('the register can be cleared', tc.ok && (await q(`select station_id from pos_payment_terminals where tenant_id = $1 and id = $2`, [T, TERM]))[0].station_id === null, String(tc.status));

  // ---- 5. the process runs in UTC, whatever the host says ----
  check('started with TZ=America/New_York, the API says it runs in UTC', /\[clock\] TZ was "America\/New_York"; this process runs in UTC/.test(apiErr), '');

  // ---- 6. which gift card paid ----
  const gp = await call('POST', `/pos/checkout/tickets/${GIFT}/pay/gift-card`, { giftCardCode: GIFT_CODE }, { 'idempotency-key': 'live-gift-' + randomUUID() });
  const gpay = (await q(`select id, amount_cents, gift_card_last4 from payments where tenant_id = $1 and ticket_id = $2 and method = 'gift_card'`, [T, GIFT]))[0];
  check('a $10 gift card pays part of the ticket; the payment keeps its last four', gp.ok && gpay?.amount_cents === 1000 && gpay?.gift_card_last4 === '4321', `${gp.status} ${gpay?.gift_card_last4}`);
  const gled = (await q(`select ticket_id, payment_id from gift_card_transactions where gift_card_id = $1 and type = 'redeem'`, [GIFT_CARD]))[0];
  check('the redemption\'s ledger row names the ticket and the payment', gled?.ticket_id === GIFT && gled?.payment_id === gpay?.id);
  const rp = await call('GET', `/pos/checkout/tickets/${GIFT}/refund-preview?amountCents=500`);
  check('the refund preview says which card the money goes back to', rp.ok && rp.body?.allocations?.[0]?.giftCardLast4 === '4321' && !JSON.stringify(rp.body).includes(GIFT_CODE), `${rp.status} ${JSON.stringify(rp.body?.allocations)}`);

  const errs = apiErr.split('\n').filter((l) => /\bERROR\b|Unhandled|TypeError/.test(l));
  check('the API logged no errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  check('the proof ran to the end', false, String(e?.stack || e));
} finally {
  clearTimeout(timer);
  await cleanup();
}
console.log(results.join('\n'));
console.log(`\n${results.filter((x) => x.startsWith('PASS')).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
