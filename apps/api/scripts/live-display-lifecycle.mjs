#!/usr/bin/env node
// live-display-lifecycle.mjs — 23-inch dual-screen spec §29, §36–§37, §43–§46, §100: a LIVE proof against the real API
// and real PostgreSQL. It seeds one paired display + one ticket in an existing salon, boots dist/main.js, and checks:
//   1. an IDLE display's stream hears the POS "Send to Display" (session_started) — and how fast
//   2. a POS change to the ticket (a tip) reaches the display (checkout_updated) — and how fast
//   3. a checkout that is not paid cannot be released
//   4. a cash payment reaches the display; the state is payment_success
//   5. release ends the session ('completed', closed), the stream hears customer_display_completed, the display is idle
//   6. a forged device token is refused
// Unit 2 (customer-safe checkout from the ticket, spec §30–§39):
//   7. the display's checkout is the POS's: same lines (first-name technicians), same total; nothing internal in it
//   8. a POS tip shows on the display (the Unit-1 gap) — display tip == ticket tip
//   9. a manual discount on top of a promotion already on the ticket keeps both (the discount-stack bug), POS AND display
//      (a promotion, not a membership credit: the POS re-derives membership discounts from real memberships on every read,
//       so a seeded membership line with no membership behind it is — correctly — removed)
//  10. after the cash payment the display shows PAID, the cash payment, and total paid == what the POS recorded
// Usage (from apps/api, after `npx tsc -p tsconfig.json`):
//   DATABASE_URL=postgres://… SALON_CODE=PILOT01 OWNER_EMAIL=… OWNER_PASSWORD=… node scripts/live-display-lifecycle.mjs
// Leaves its seeded rows in place (marked "Live Display Proof") — never point it at a production database.
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const DB = process.env.DATABASE_URL;
const PORT = Number(process.env.PORT || 3031);
const BASE = `http://127.0.0.1:${PORT}`;
const SALON = process.env.SALON_CODE || 'PILOT01';
const EMAIL = process.env.OWNER_EMAIL || 'owner@pilotsalon.com';
const PASSWORD = process.env.OWNER_PASSWORD || 'ChangeMe!Owner1';
if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }

const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(10); } return null; }

function openStream(path, headers) {
  const events = []; const ctl = new AbortController();
  const done = (async () => {
    const res = await fetch(BASE + path, { headers: { accept: 'text/event-stream', ...headers }, signal: ctl.signal });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (data) { try { const d = JSON.parse(data); events.push({ at: Date.now(), event: d.event, d }); } catch { /* not JSON */ } }
      }
    }
  })().catch(() => undefined);
  return { events, close: () => { ctl.abort(); return done; } };
}

const client = new pg.Client({ connectionString: DB });
await client.connect();
const salon = (await client.query(`select t.id as tenant_id, b.id as branch_id from tenants t join branches b on b.tenant_id = t.id where t.tenant_code = $1 order by b.created_at limit 1`, [SALON])).rows[0];
if (!salon) { console.error(`salon ${SALON} not found`); process.exit(2); }
const T = salon.tenant_id, B = salon.branch_id;
const CUST = randomUUID(), TK = randomUUID(), DEV = randomUUID();
let dealId = null;
const TOKEN = randomBytes(24).toString('base64url');
// Any display this salon already has stays paired — retire the proof's predecessors only, so Send to Display picks ours.
await client.query(`update customer_display_devices set revoked_at = now() where tenant_id = $1 and device_name = 'Live Display Proof' and revoked_at is null`, [T]);
await client.query(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Proof','Sophia Proof')`, [CUST, T, B]);
// the ticket arrives at checkout; a $5 promotion is put on it below THROUGH the deals engine (BUILD_PLAN Phase 5: a
// coupon lives in the deals ledger with its locked terms, and re-pricing reads the ledger — a snapshot entry alone is
// not a promotion any more, so this proof applies a real published coupon over the API)
await client.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, B, CUST]);
const OLIVIA = randomUUID();
await client.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Olivia','Proof','Olivia Proof')`, [OLIVIA, T, B]);
// two of the salon's REAL services (a line must name a service or a product — ticket_service_lines_sellable)
const svcs = (await client.query(`select id, name, price_cents, duration_minutes from services where tenant_id = $1 and status = 'active' order by sort_order, name limit 2`, [T])).rows;
if (svcs.length < 2) { console.error('the salon needs two active services'); process.exit(2); }
for (const v of svcs) {
  await client.query(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$7,'percent',55)`,
    [T, B, TK, v.id, OLIVIA, v.name, Number(v.price_cents), Number(v.duration_minutes || 30)]);
}
const others = (await client.query(`select count(*)::int as n from customer_display_devices where tenant_id = $1 and revoked_at is null and pairing_status = 'paired'`, [T])).rows[0].n;
await client.query(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status, device_token_hash, created_at) values ($1,$2,$3,'Live Display Proof','paired',$4, now() - interval '10 years')`,
  [DEV, T, B, createHash('sha256').update(TOKEN).digest('hex')]);

const api = spawn('node', ['dist/main.js'], { env: { ...process.env, REPO_DRIVER: 'postgres', PORT: String(PORT), AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET || 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
let apiErr = ''; api.stderr.on('data', (c) => { apiErr += c; });
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(BASE + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(250); }
  check('API booted (health/ready)', !!up);
  const login = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ portal: 'tenant', salonCode: SALON, identifier: EMAIL, password: PASSWORD }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('owner signed in', login.ok && !!cookie, String(login.status));
  const pos = (method, path, body, extra = {}) => fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });
  const dev = (method, path, body, token = TOKEN) => fetch(BASE + '/customer-display/device' + path, { method, headers: { 'x-device-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  // 1. idle display hears Send to Display
  const idle = await (await dev('GET', '/current')).json();
  check('idle display state carries no customer', idle.state === 'idle' && !idle.customer && !idle.sessionId, idle.state);
  const s1 = openStream('/customer-display/device/stream', { 'x-device-token': TOKEN });
  check('idle device stream connected', !!(await waitFor(() => s1.events.find((e) => e.event === 'connected'), 3000)));
  // Unit 6 (§83–§85): a display is online when it has reported in recently — the display app sends this heartbeat on
  // start and every 30 s; Send to Display never picks a display that has not
  const hb = await dev('POST', '/heartbeat', { mode: 'advertisement', appVersion: 'live-proof', screen: { width: 1920, height: 1080, pixelRatio: 1 }, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE' });
  check('the display reported in (heartbeat)', hb.ok, String(hb.status));
  if (others > 0) results.push(`INFO  this salon already had ${others} paired display(s); Send to Display picks the oldest ONLINE shared one — the proof device is dated oldest`);
  const t0 = Date.now();
  const sent = await pos('POST', `/pos/checkout/tickets/${TK}/send-to-customer-display`);
  const sentBody = await sent.json().catch(() => ({}));
  check('POS Send to Display accepted', sent.ok && sentBody.deviceId === DEV, `${sent.status} device=${sentBody.deviceId === DEV ? 'proof' : sentBody.deviceId}`);
  const started = await waitFor(() => s1.events.find((e) => e.event === 'customer_display_session_started'), 3000);
  check('the IDLE display heard session_started on its own channel', !!started, started ? `${started.at - t0} ms after the POS call` : 'never arrived');
  await s1.close();
  const st1 = await (await dev('GET', '/current')).json();
  check('display now shows the checkout (Sophia, 2 services)', st1.state === 'ticket_review' && st1.customer?.firstName === 'Sophia' && st1.ticket?.services?.length === 2 && st1.sessionId === sentBody.sessionId, `${st1.state} ${st1.customer?.firstName} ${st1.ticket?.services?.length}`);
  check('the state carries a version', typeof st1.version === 'number' && st1.version > 0, String(st1.version));

  // 2. a POS change reaches the display (the client re-opens its stream when the session changes — do the same)
  const s2 = openStream('/customer-display/device/stream', { 'x-device-token': TOKEN });
  await waitFor(() => s2.events.find((e) => e.event === 'connected'), 3000);
  const t1 = Date.now();
  const tip = await pos('POST', `/pos/checkout/tickets/${TK}/apply-tip`, { tipType: 'percent', tipPercent: 20, source: 'front_desk' });
  check('POS applied a 20% tip', tip.ok, String(tip.status));
  const upd = await waitFor(() => s2.events.find((e) => e.event === 'customer_display_checkout_updated' && e.at >= t1), 3000);
  check('the display heard the POS change (checkout_updated)', !!upd, upd ? `${upd.at - t1} ms after the POS call` : 'never arrived');
  const tipRow = (await client.query(`select tip_cents from tickets where id = $1`, [TK])).rows[0];
  const stTip = await (await dev('GET', '/current')).json();
  check("the POS tip shows on the display (display tip == the ticket's tip)", stTip.totals?.tipCents === Number(tipRow?.tip_cents) && stTip.checkout?.tipCents === Number(tipRow?.tip_cents) && Number(tipRow?.tip_cents) > 0,
    `display ${stTip.totals?.tipCents} vs ticket ${tipRow?.tip_cents}`);
  // 7. the display's checkout IS the POS's checkout (the POS read first: opening a ticket may sync its discounts)
  const posTk = await (await pos('GET', `/pos/checkout/tickets/${TK}`)).json();
  const stSame = await (await dev('GET', '/current')).json();
  const c = stSame.checkout ?? {};
  check('display lines = the POS lines, technicians by first name', c.lines?.length === 2 && c.lines.every((l) => l.technicianName === 'Olivia') && c.lines.map((l) => l.name).join('|') === (posTk.completedServices ?? []).map((l) => l.serviceName).join('|'),
    (c.lines ?? []).map((l) => `${l.name}/${l.technicianName}`).join(', '));
  check('display total = the POS total for the same ticket', c.totalCents === posTk.totals?.totalDueCents && stSame.totals?.totalDueCents === posTk.totals?.totalDueCents, `${c.totalCents} vs ${posTk.totals?.totalDueCents}`);
  const leak = JSON.stringify(stSame).match(/commission|Proof|phone|email|technicianId|serviceLineId|tenant_id|branch_id/i);
  check('§39: nothing internal in the display state (commission, surnames, contact, ids)', !leak, leak ? leak[0] : 'clean');
  // 9. the discount-stack bug, live: a manual $3 discount on top of a $5 promotion applied through the deals engine
  const dealRes = await pos('POST', '/pos/deals', { branchId: B, kind: 'coupon', title: 'Promo: FALL5', discountType: 'fixed', discountCents: 500 });
  const deal = await dealRes.json().catch(() => ({}));
  if (deal.id) { dealId = deal.id; await pos('POST', `/pos/deals/${deal.id}/submit`); await pos('POST', `/pos/deals/${deal.id}/approve`, { reason: 'live proof' }); await pos('POST', `/pos/deals/${deal.id}/publish`); }
  const gen = await (await pos('POST', `/pos/deals/${deal.id}/coupons/generate`, { quantity: 1, singleUse: true, prefix: 'FALL' })).json().catch(() => ({}));
  const code = gen.codes?.[0];
  const promo = await pos('POST', `/pos/checkout/tickets/${TK}/apply-promotion`, { code });
  check('a $5 coupon (deals engine) is on the ticket before the manual discount', promo.ok, `${dealRes.status} deal, ${code ? 'code' : 'no code'}, ${promo.status} apply`);
  const disc = await pos('POST', `/pos/checkout/tickets/${TK}/apply-discount`, { discountCents: 300 });
  check('POS applied a $3 manual discount', disc.ok, String(disc.status));
  const snap = (await client.query(`select discount_cents, discount_snapshot from tickets where id = $1`, [TK])).rows[0];
  const cats = (snap.discount_snapshot?.applied ?? []).map((a) => `${a.category}:${a.appliedCents}`).sort().join(',');
  check('the promotion SURVIVED the manual discount (snapshot keeps both; $8 off)', cats === 'coupon:500,manual:300' && Number(snap.discount_cents) === 800, `${cats} → ${snap.discount_cents}`);
  const stDisc = await (await dev('GET', '/current')).json();
  check('the display lists both: Coupon: Promo: FALL5 −$5, Discount −$3', (stDisc.checkout?.adjustments ?? []).map((a) => `${a.label}:${a.amountCents}`).sort().join(',') === 'Coupon: Promo: FALL5:500,Discount:300',
    (stDisc.checkout?.adjustments ?? []).map((a) => `${a.label}:${a.amountCents}`).join(','));

  // 3. not paid → cannot be released
  const early = await dev('POST', '/release', { sessionId: sentBody.sessionId });
  check('an unpaid checkout cannot be released', early.status === 400, String(early.status));

  // 4. cash payment reaches the display
  const t2 = Date.now();
  const paid = await pos('POST', `/pos/checkout/tickets/${TK}/pay/cash`, { amountReceivedCents: 50000 }, { 'idempotency-key': 'live-proof-' + randomUUID() });
  const paidBody = await paid.json().catch(() => ({}));
  check('POS took the cash payment', paid.ok, `${paid.status} ${paid.ok ? '' : JSON.stringify(paidBody).slice(0, 160)}`);
  const payEv = await waitFor(() => s2.events.find((e) => e.event === 'customer_display_checkout_updated' && e.at >= t2), 3000);
  check('the display heard the payment', !!payEv, payEv ? `${payEv.at - t2} ms after the POS call` : 'never arrived');
  const st2 = await (await dev('GET', '/current')).json();
  check('display state is payment_success (no signature owed for cash)', st2.state === 'payment_success' && !st2.signatureRequired, `${st2.state} sig=${st2.signatureRequired}`);
  const cashRow = (await client.query(`select coalesce(sum(amount_cents),0)::int as paid from payments where ticket_id = $1 and status = 'approved'`, [TK])).rows[0];
  check('the completed display shows PAID, the cash payment, and total paid == what the POS recorded',
    st2.checkout?.paymentStatus === 'paid' && st2.checkout?.payments?.[0]?.label === 'Cash' && st2.checkout?.totalCents === cashRow.paid && st2.checkout?.balanceDueCents === 0,
    `${st2.checkout?.paymentStatus} ${(st2.checkout?.payments ?? []).map((p) => p.label + ' ' + p.amountCents).join(',')} total ${st2.checkout?.totalCents} vs paid ${cashRow.paid}`);

  // 5. release ends it
  const t3 = Date.now();
  const rel = await dev('POST', '/release', { sessionId: sentBody.sessionId });
  const relBody = await rel.json().catch(() => ({}));
  check('release returns the idle state with no customer data', rel.ok && relBody.state === 'idle' && !relBody.customer && !relBody.ticket && !relBody.sessionId && relBody.totals?.totalDueCents === 0, `${rel.status} ${relBody.state}`);
  const comp = await waitFor(() => s2.events.find((e) => e.event === 'customer_display_completed' && e.at >= t3), 3000);
  check('the stream heard customer_display_completed', !!comp, comp ? `${comp.at - t3} ms` : 'never arrived');
  await s2.close();
  const st3 = await (await dev('GET', '/current')).json();
  check('re-reading the display: idle, Sophia gone', st3.state === 'idle' && !JSON.stringify(st3).includes('Sophia'), st3.state);
  const row = (await client.query(`select state, closed_at from customer_display_sessions where id = $1`, [sentBody.sessionId])).rows[0];
  check('session row ended: state completed, closed', row?.state === 'completed' && !!row?.closed_at, `${row?.state}`);
  const again = await dev('POST', '/release', { sessionId: sentBody.sessionId });
  check('a second release is harmless', again.ok, String(again.status));

  // 6. forged token
  const forged = await dev('POST', '/release', { sessionId: sentBody.sessionId }, 'forged-token');
  check('a forged device token is refused', forged.status === 403, String(forged.status));
} finally {
  api.kill('SIGTERM');
  await client.query(`update customer_display_devices set revoked_at = now() where id = $1`, [DEV]).catch(() => undefined);
  if (dealId) { for (const t of ['deal_redemptions', 'deal_redemption_holds', 'deal_coupon_codes', 'deal_coupon_batches', 'deal_versions', 'deal_services', 'deal_approvals', 'deal_analytics_events', 'deal_daily_stats', 'deal_saves']) await client.query(`delete from ${t} where deal_id = $1`, [dealId]).catch(() => undefined); await client.query(`delete from deals where id = $1`, [dealId]).catch(() => undefined); }
  await client.end();
}
for (const r of results) console.log(r);
if (failed && apiErr) console.log('--- API stderr (tail) ---\n' + apiErr.split('\n').slice(-15).join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nall ${results.filter((r) => r.startsWith('PASS')).length} live checks passed`);
process.exit(failed ? 1 : 0);
