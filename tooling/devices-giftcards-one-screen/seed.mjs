// seed.mjs — Payment Terminals + Gift Cards one-screen harness (Oct 29 2026). Seeds a TEST salon into a fresh database.
// Device-side rows (terminals, phones, card payments) are what pairing / the processor / the phone app would have written;
// every gift card goes through the product's ONE gift-card writer (KyselyCheckoutRepository: issue on its own ticket,
// reload hold, reasoned void). This harness's Kysely stand-in runs raw SQL only, so Checkout's builder paths (activating a
// paid card, crediting a paid reload, redeeming at checkout) are reproduced statement for statement (payTicket / redeem).
// Tooling only — never run against production. Customers are invented; phones are 555-01xx test numbers.
//   PILOT  "Pilot Nail Salon (test)"  6 terminals in every state (incl. one with no location, one never tested, one on a
//          retired register), 6 Tap to Pay iPhones (active / pending / suspended / revoked), ~120 card payments over 8 weeks
//          (terminal, iPhone, not linked), ~60 gift cards (active, partly used, redeemed, void, pending payment, reloaded,
//          physical, gifts with recipients) incl. the mandate's $100 → $65 → $35 card, a capture-routing change in the audit.
//   EMPTY  "New Salon (test)"  nothing at all (the empty states)
import { KyselyCheckoutRepository } from '../../modules/checkout/src/checkout/checkout.kysely.repository.ts';

const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0710000', 1), EMPTY = id('f0710000', 2);
export const BRANCH = id('b0710000', 1), BRANCH2 = id('b0710000', 2), BRANCH_E = id('b0710000', 3);
export const OWNER_USER = id('a0710000', 1), MANAGER_USER = id('a0710000', 2), DESK_USER = id('a0710000', 3), TECH_USER = id('a0710000', 4);
export const STATION = (n) => id('d0710000', n);
const FIRST = ['Linh', 'Mai', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Emily', 'Sarah', 'Jessica', 'Olivia', 'Grace', 'Chloe', 'Nora', 'Ivy', 'Rosa', 'Kim', 'John'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Smith', 'Johnson', 'Garcia', 'Brown', 'Davis', 'Wilson'];
let seedN = 11; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();
const code = (n) => 'GC-' + ('SEEDCODE' + hex(n, 4)).toUpperCase();
const cardNo = (n) => '6000' + String(4100_0000_0000 + n * 7919).slice(-12);

/** what Checkout writes when a ticket that carries a pending card (or a reload hold) is paid — see the header */
export async function payTicket(pg, tenant, branch, ticketId, at) {
  const q = (s, p = []) => pg.query(s, p);
  const pend = (await q(`select id, purchased_cents from gift_cards where tenant_id = $1 and sale_ticket_id = $2 and status = 'pending_payment'`, [tenant, ticketId])).rows;
  for (const c of pend) {
    await q(`update gift_cards set status = 'active', balance_cents = $2, updated_at = now() where id = $1 and status = 'pending_payment'`, [c.id, c.purchased_cents]);
    await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, idempotency_key, created_at) values ($1,$2,$3,'activate',$4,$4,$5,$6,$7)`, [tenant, branch, c.id, c.purchased_cents, ticketId, 'activate:' + c.id, at ?? new Date().toISOString()]);
  }
  const holds = (await q(`select id, gift_card_id, amount_cents from gift_card_transactions h where tenant_id = $1 and ticket_id = $2 and type = 'hold'
    and not exists (select 1 from gift_card_transactions c where c.tenant_id = h.tenant_id and c.idempotency_key = 'reload:' || h.id::text)`, [tenant, ticketId])).rows;
  for (const h of holds) {
    const nb = (await q(`update gift_cards set balance_cents = balance_cents + $2, status = 'active' where id = $1 returning balance_cents`, [h.gift_card_id, h.amount_cents])).rows[0].balance_cents;
    await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, idempotency_key, created_at) values ($1,$2,$3,'adjust',$4,$5,$6,$7)`, [tenant, branch, h.gift_card_id, h.amount_cents, nb, 'reload:' + h.id, at ?? new Date().toISOString()]);
  }
  await q(`update tickets set status = 'paid', checkout_status = 'paid' where id = $1 and tenant_id = $2`, [ticketId, tenant]).catch(() => undefined);
  return pend.length + holds.length;
}
export async function redeem(pg, tenant, branch, cardId, cents, at) {
  const q = (s, p = []) => pg.query(s, p);
  const u = (await q(`update gift_cards set balance_cents = balance_cents - $2, status = case when balance_cents - $2 <= 0 then 'redeemed' else 'active' end where id = $1 and status = 'active' and balance_cents >= $2 returning balance_cents`, [cardId, cents])).rows[0];
  if (!u) return false;
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, created_at) values ($1,$2,$3,'redeem',$4,$5,$6)`, [tenant, branch, cardId, cents, u.balance_cents, at ?? new Date().toISOString()]);
  return true;
}

export async function seed(pg, db) {
  const q = (s, p = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-dg','PDG001','active'), ($2,'New Salon LLC','New Salon','new-dg','NDG001','active')`, [PILOT, EMPTY]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$2,'Marlton','active','America/New_York'), ($4,$5,'Main','active','America/New_York')`, [BRANCH, PILOT, BRANCH2, BRANCH_E, EMPTY]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status, normalized_phone) values ($1,$5,'owner@pilot.test','Linh Owner','OWNER','active',null), ($2,$5,'manager@pilot.test','Mai Manager','MANAGER','active',null),
    ($3,$5,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active','+18565550190'), ($4,$5,'tech@pilot.test','Kim Tech','TECHNICIAN','active','+18565550191')`, [OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, PILOT]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$4,$5,'Front Desk'), ($2,$4,$5,'Back Bar'), ($3,$4,$5,'Pedicure Lounge')`, [STATION(1), STATION(2), STATION(3), PILOT, BRANCH]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name, retired_at) values ($1,$2,$3,'Old Register', now() - interval '20 days')`, [STATION(4), PILOT, BRANCH]).catch(async () => {
    await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$2,$3,'Old Register')`, [STATION(4), PILOT, BRANCH]); });

  // ── physical terminals (what pairing + the provider's pings wrote) ─────────────────────────────────────────────────────
  const term = (tid, branch, label, f = {}) => q(`insert into pos_payment_terminals (id, tenant_id, branch_id, label, station_id, status, paired_at, hsn, terminal_type, last_seen_at, last_ping_at, last_ping_ok, disabled_at, disabled_reason, provider, updated_at)
     values ($1,$2,$3,$4,$5,$6, now() - make_interval(mins => $7), $8, $9, $10, $11, $12, $13, $14, 'cardpointe', now())`,
    [tid, PILOT, branch, label, f.station ?? null, f.status ?? 'paired', Number(f.mins ?? 1000), f.hsn === undefined ? 'C043UQ' + tid.slice(-5) : f.hsn, f.model ?? 'clover_compact', f.seen ?? null, f.ping ?? null, f.pingOk ?? null, f.disabled ?? null, f.reason ?? null]);
  await term('term_cp_00001', BRANCH, 'Front Desk Clover', { station: STATION(1), seen: ago(2), ping: ago(2), pingOk: true, mins: 60 * 24 * 90 });
  await term('term_cp_00002', BRANCH, 'Back Bar Flex', { station: STATION(2), model: 'clover_flex', seen: ago(60 * 26), ping: ago(60 * 26), pingOk: false, mins: 60 * 24 * 60 });
  await term('term_cp_00003', BRANCH, 'Pedicure Lounge Mini', { station: STATION(3), model: 'clover_mini', mins: 60 * 24 * 2 });                       // never tested
  await term('term_cp_00004', null, 'Spare Reader', { hsn: null, seen: ago(5), ping: ago(5), pingOk: true, mins: 60 * 24 * 30 });                   // no location, no serial (was hidden from the old list)
  await term('term_cp_00005', BRANCH, 'Old Register Clover', { station: STATION(4), disabled: ago(60 * 24 * 19), reason: 'Register retired', status: 'paired', mins: 60 * 24 * 200 });
  await term('term_cp_00006', BRANCH2, 'Marlton Front Desk', { seen: ago(1), ping: ago(1), pingOk: true, mins: 60 * 24 * 45 });
  for (const [tid, action, mins] of [['term_cp_00001', 'pos_settings_terminal_paired', 60 * 24 * 90], ['term_cp_00001', 'pos_settings_terminal_tested', 2], ['term_cp_00002', 'pos_settings_terminal_tested', 60 * 26], ['term_cp_00005', 'pos_settings_terminal_disabled', 60 * 24 * 19]])
    await q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json, created_at) values ($1,$2,$3,'OWNER',$4,'payment_terminal',$5,'{}'::jsonb,'{}'::jsonb, now() - make_interval(mins => $6))`, [PILOT, BRANCH, OWNER_USER, action, tid, mins]);

  // ── Tap to Pay iPhones (what the phone app's registration wrote) ───────────────────────────────────────────────────────
  const phones = [['iphone-reg-0001', 'Kim iPhone 15', 'active', DESK_USER, 3], ['iphone-reg-0002', 'Front Desk iPhone', 'active', null, 60 * 5], ['iphone-reg-0003', 'Lan iPhone 13', 'pending', TECH_USER, 30],
    ['iphone-reg-0004', 'Loaner iPhone', 'disabled', null, 60 * 24 * 6], ['iphone-reg-0005', 'Old Staff iPhone', 'revoked', TECH_USER, 60 * 24 * 40], ['iphone-reg-0006', 'Lost iPhone', 'revoked', DESK_USER, 60 * 24 * 12]];
  let pn = 0;
  for (const [dev, label, status, user, mins] of phones) {
    pn++;
    await q(`insert into mobile_pay_devices (tenant_id, branch_id, device_id, label, platform, os_version, app_version, status, bound_user_id, last_seen_at, created_at, tap_to_pay_capable, revoked_at, revoke_reason, shared)
      values ($1,$2,$3,$4,'ios','18.' || $12::text,'3.4.' || $12::text,$5,$6, now() - make_interval(mins => $7), now() - make_interval(days => $8), true, $9, $10, $11)`,
      [PILOT, BRANCH, dev, label, status, user, mins, 120 - pn * 10, status === 'revoked' ? ago(mins) : null, status === 'revoked' ? (label.startsWith('Lost') ? 'Phone lost' : 'Staff left') : null, user == null, String(pn)]).catch(async (e) => {
      if (!/shared|os_version|app_version/.test(String(e.message))) throw e;
      await q(`insert into mobile_pay_devices (tenant_id, branch_id, device_id, label, platform, status, bound_user_id, last_seen_at, created_at, tap_to_pay_capable, revoked_at, revoke_reason)
        values ($1,$2,$3,$4,'ios',$5,$6, now() - make_interval(mins => $7), now() - make_interval(days => $8), true, $9, $10)`, [PILOT, BRANCH, dev, label, status, user, mins, 120 - pn * 10, status === 'revoked' ? ago(mins) : null, status === 'revoked' ? 'Staff left' : null]);
    });
  }

  // ── customers ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const customers = [];
  for (let i = 1; i <= 70; i++) {
    const cid = id('e0710000', i); const f = pick(FIRST), l = pick(LAST);
    const phone = `+1856555${String(1000 + i).slice(-4)}`, display = `(856) 555-${String(1000 + i).slice(-4)}`;
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cid, PILOT, BRANCH, f, l, `${f} ${l}`, phone, display, rnd() < 0.7 ? `${f.toLowerCase()}.${i}@example.com` : null]);
    customers.push({ id: cid, name: `${f} ${l}`, phone });
  }
  // the mandate's names: John Smith buys, Mai Tran receives
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$3,$4,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com'), ($2,$3,$4,'Mai','Tran','Mai Tran','+18565559876','(856) 555-9876',null)`, [id('e0710000', 900), id('e0710000', 901), PILOT, BRANCH]);
  const JOHN = id('e0710000', 900), MAI = id('e0710000', 901);

  // ── card payments over 8 weeks: through a terminal, a Tap to Pay iPhone, or with no device recorded ───────────────────────
  let tn = 1000, payN = 0;
  for (let i = 0; i < 120; i++) {
    const c = pick(customers); const mins = Math.floor(rnd() * 60 * 24 * 56) + 20; const tid = id('c0710000', ++tn);
    const r = rnd(); const [surface, dev, station] = r < 0.45 ? ['cardpointe_terminal', 'term_cp_00001', STATION(1)] : r < 0.6 ? ['cardpointe_terminal', 'term_cp_00002', STATION(2)] : r < 0.8 ? ['tap_to_pay_iphone', pick(['iphone-reg-0001', 'iphone-reg-0002', 'iphone-reg-0005']), null] : [null, null, null];
    const amount = 2500 + Math.floor(rnd() * 120) * 100; const st = rnd() < 0.9 ? 'approved' : rnd() < 0.5 ? 'declined' : 'refunded';
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, checkout_register_id, created_at) values ($1,$2,$3,$4,'paid',$5,$6,$7, now() - make_interval(mins => $8))`, [tid, PILOT, BRANCH, c.id, amount, String(tn), station, mins]);
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, payment_surface, device_id, card_brand, card_last4, created_by_user_id, created_at) values ($1,$2,$3,$4,'card',$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - make_interval(mins => $14))`,
      [id('90710000', ++payN), PILOT, BRANCH, tid, amount, Math.floor(amount * 0.18 / 100) * 100, st, st === 'declined' ? null : 'RR' + String(700000 + payN * 37), surface, dev, pick(['VISA', 'MC', 'AMEX', 'DISC']), String(1000 + Math.floor(rnd() * 9000)), DESK_USER, mins]).catch(async (e) => {
      if (!/tip_cents|created_by_user_id/.test(String(e.message))) throw e;
      await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status, processor_transaction_id, payment_surface, device_id, card_brand, card_last4, created_at) values ($1,$2,$3,$4,'card',$5,$6,$7,$8,$9,$10,$11, now() - make_interval(mins => $12))`,
        [id('90710000', payN), PILOT, BRANCH, tid, amount, st, st === 'declined' ? null : 'RR' + String(700000 + payN * 37), surface, dev, 'VISA', '4242', mins]);
    });
  }
  await q(`update pos_payment_terminals t set last_transaction_at = (select max(p.created_at) from payments p where p.tenant_id::text = t.tenant_id::text and p.device_id = t.id) where tenant_id = $1`, [PILOT]);

  // ── capture routing: changed once by the owner (audited) ────────────────────────────────────────────────────────────
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'payments-checkout', '{"customerDisplayCaptureMode":"terminal"}'::jsonb)`, [PILOT]);
  await q(`insert into settings_audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, before_json, after_json, created_at) values ($1,$2,$3,'OWNER','pos_settings_payments_checkout_updated','payments_checkout','payments-checkout','{"customerDisplayCaptureMode":"front_desk"}'::jsonb,'{"customerDisplayCaptureMode":"terminal"}'::jsonb, now() - interval '9 days')`, [PILOT, BRANCH, OWNER_USER]);
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'gift-card-settings', '{"enabled":true,"posSalesEnabled":true,"presetAmountsCents":[2500,5000,10000,15000],"customAmountEnabled":true,"minAmountCents":1000,"maxAmountCents":50000,"sendToFriendEnabled":true,"crossBranchRedemption":true}'::jsonb)`, [PILOT]);

  // ── gift cards, through the ONE writer ─────────────────────────────────────────────────────────────────────────────
  const w = new KyselyCheckoutRepository(db);
  const ctx = { tenantId: PILOT, branchId: BRANCH, userId: DESK_USER, role: 'FRONT_DESK', permissions: ['pos.checkout.gift_card_issue'] };
  const mgr = { ...ctx, userId: MANAGER_USER, role: 'MANAGER', permissions: ['pos.checkout.void'] };
  const backdate = async (cardId, ticketId, at) => {
    await q(`update gift_cards set created_at = $2 where id = $1`, [cardId, at]);
    await q(`update tickets set created_at = $2 where id = $1`, [ticketId, at]);
  };
  let n = 0; const made = [];
  const issue = async (o) => {
    n++;
    const r = await w.issueGiftCardOnNewTicket(ctx, { idempotencyKey: 'seed-issue-' + hex(n, 6), customerId: o.customer, amountCents: o.amount, code: code(n), reference: 'GC-****-' + code(n).slice(-4), cardNumber: cardNo(n), physical: false, recipient: o.recipient });
    if (!r.ok) throw new Error('seed issue failed: ' + r.reason);
    const at = ago(o.mins); await backdate(r.cardId, r.ticketId, at);
    if (o.paid !== false) await payTicket(pg, PILOT, BRANCH, r.ticketId, at);
    made.push({ ...r, ...o }); return r;
  };
  // the mandate's worked example: John Smith buys a $100 card for Mai Tran; Mai spends $65 → $35 left
  const ex = await issue({ customer: JOHN, amount: 10000, mins: 60 * 24 * 9, recipient: { name: 'Mai Tran', phone: '(856) 555-9876', message: 'Happy birthday!' } });
  await q(`update gift_card_recipients set customer_id = $2 where gift_card_id = $1`, [ex.cardId, MAI]).catch(() => undefined);
  await redeem(pg, PILOT, BRANCH, ex.cardId, 6500, ago(60 * 24 * 3));
  for (let i = 0; i < 52; i++) {
    const c = pick(customers); const amount = pick([2500, 5000, 5000, 7500, 10000, 10000, 15000, 20000]);
    const gift = rnd() < 0.35 ? pick(customers) : null;
    const r = await issue({ customer: c.id, amount, mins: Math.floor(rnd() * 60 * 24 * 330) + 60, recipient: gift ? { name: gift.name, phone: gift.phone } : undefined, paid: i % 17 !== 5 });
    if (i % 17 === 5) continue;
    const roll = rnd();
    if (roll < 0.25) await redeem(pg, PILOT, rnd() < 0.3 ? BRANCH2 : BRANCH, r.cardId, amount, ago(Math.floor(rnd() * 60 * 24 * 40) + 10));                       // used up
    else if (roll < 0.6) await redeem(pg, PILOT, BRANCH, r.cardId, Math.floor(amount * (0.2 + rnd() * 0.6) / 100) * 100, ago(Math.floor(rnd() * 60 * 24 * 50) + 10));  // partly used
  }
  // a reload, paid (hold → credit) and one still waiting for payment
  const rl = await w.reloadGiftCardOnNewTicket(ctx, { cardId: made[3].cardId, customerId: made[3].customer, amountCents: 5000, idempotencyKey: 'seed-reload-1' });
  if (rl.ok) await payTicket(pg, PILOT, BRANCH, rl.ticketId, ago(60 * 24 * 2));
  await w.reloadGiftCardOnNewTicket(ctx, { cardId: made[6].cardId, customerId: made[6].customer, amountCents: 2500, idempotencyKey: 'seed-reload-2' });
  // two voids, reasoned, by the manager (history kept, a compensating entry written)
  for (const k of [10, 20]) { const v = await w.voidGiftCardById(mgr, made[k].cardId, k === 10 ? 'Sold in error — customer paid twice' : 'Card reported stolen'); if (!v.ok && v.reason !== 'not_voidable') throw new Error('seed void ' + v.reason); }
  const counts = (await q(`select status, count(*)::int n from gift_cards where tenant_id = $1 group by status order by status`, [PILOT])).rows;
  return { customers: customers.length + 2, cards: made.length, exampleCard: ex.cardId, statuses: counts.map((r) => `${r.status}:${r.n}`).join(' '), payments: payN };
}
