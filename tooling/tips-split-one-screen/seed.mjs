// seed.mjs — Tips & Gratuity + Split Payments one-screen harness (Oct 29 2026). Seeds a TEST salon into a fresh database:
// ~10 weeks of PAID tickets with their payment rows exactly as Checkout writes them (a single tender carries the ticket tip;
// a split's tenders carry 0 — the tip is on the ticket), one tip allocation row per (ticket, technician), the frozen
// compensation snapshot per technician, refund-driven reversals and manual corrections in compensation_adjustments, a PAID
// payroll period and an open one, and the canonical split tickets ($60 card + $40 cash · $70 card + a DECLINED $50 ·
// $30 gift + $50 card · $50 cash + $60 card + $40 gift with a $20 tip · a $30 refund on one tender).
// The PHOTO: ticket #1052, a $9.60 card tip for Vishal verma, whose snapshot carries the tip on TWO line rows (the retried-
// snapshot defect) — Total $9.60, Distribution would say $19.20. Tooling only — never run against production.
const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0810000', 1), EMPTY = id('f0810000', 2);
export const BRANCH = id('b0810000', 1), BRANCH_E = id('b0810000', 3);
export const OWNER_USER = id('a0810000', 1), MANAGER_USER = id('a0810000', 2), DESK_USER = id('a0810000', 3), TECH_USER = id('a0810000', 4);
export const TECH = { vishal: id('e0810000', 1), anna: id('e0810000', 2), bao: id('e0810000', 3), chi: id('e0810000', 4), mai: id('e0810000', 5) };
export const REG = { front: id('d0810000', 1), back: id('d0810000', 2) };
const FIRST = ['Linh', 'Mai', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Emily', 'Sarah', 'Jessica', 'Olivia', 'Grace', 'Chloe', 'Nora', 'Ivy', 'Rosa', 'Kim'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Smith', 'Johnson', 'Garcia', 'Brown', 'Davis', 'Wilson'];
let seedN = 23; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

export async function seed(pg) {
  const q = (s, p = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-ts','PTS001','active'), ($2,'New Salon LLC','New Salon','new-ts','NTS001','active')`, [PILOT, EMPTY]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active','America/New_York'), ($3,$4,'Main','active','America/New_York')`, [BRANCH, PILOT, BRANCH_E, EMPTY]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$5,'owner@pilot.test','Pat Owner','OWNER','active'), ($2,$5,'manager@pilot.test','Mai Manager','MANAGER','active'), ($3,$5,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active'), ($4,$5,'tech@pilot.test','Vishal Verma','TECHNICIAN','active')`, [OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, PILOT]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status) values ($1,$6,$7,$8,'Vishal','Verma','Vishal verma','active'), ($2,$6,$7,null,'Anna','Lee','Anna Lee','active'), ($3,$6,$7,null,'Bao','Tran','Bao Tran','active'), ($4,$6,$7,null,'Chi','Pham','Chi Pham','active'), ($5,$6,$7,null,'Mai','Nguyen','Mai Nguyen','active')`,
    [TECH.vishal, TECH.anna, TECH.bao, TECH.chi, TECH.mai, PILOT, BRANCH, TECH_USER]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$3,$4,'Front Desk'), ($2,$3,$4,'Back Bar')`, [REG.front, REG.back, PILOT, BRANCH]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('60810000', 1), PILOT, BRANCH]);
  const SERVICES = ['Gel Manicure', 'Pedicure', 'Acrylic Full Set', 'Nail Art', 'Dip Powder'];
  for (const [i, name] of SERVICES.entries()) await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,$5,45,4500)`, [id('61810000', i + 1), PILOT, BRANCH, id('60810000', 1), name]);
  const SVC = (name) => id('61810000', SERVICES.indexOf(name) + 1);
  const customers = [];
  for (let i = 1; i <= 60; i++) {
    const cid = id('c0810000', i); const f = pick(FIRST), l = pick(LAST); const phone = `+1856555${String(1000 + i).slice(-4)}`;
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [cid, PILOT, BRANCH, f, l, `${f} ${l}`, phone, `(856) 555-${String(1000 + i).slice(-4)}`, rnd() < 0.6 ? `${f.toLowerCase()}.${i}@example.com` : null]);
    customers.push({ id: cid, name: `${f} ${l}` });
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com')`, [id('c0810000', 900), PILOT, BRANCH]);
  const JOHN = id('c0810000', 900);
  // payroll periods: a PAID one (days 50–36 ago), an open one (last 14 days)
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status, payout_status, paid_at) values ($1,$2,$3,'Sep 9 – Sep 23', (now() - interval '50 days')::date, (now() - interval '36 days')::date, 'paid', 'paid', now() - interval '33 days'), ($4,$2,$3,'This period', (now() - interval '14 days')::date, now()::date, 'draft', 'none', null)`, [id('80810000', 1), PILOT, BRANCH, id('80810000', 2)]);

  let n = 0, pn = 0, tn = 1000, ln = 0;
  const TID = () => id('90810000', ++n), PID = () => id('91810000', ++pn), LID = () => id('92810000', ++ln);
  const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  /** a PAID ticket with its payment rows (as Checkout writes them), allocation rows and the frozen snapshot */
  async function paidTicket(o) {
    const tid = TID(); tn++; const at = minsAgo(o.minsAgo); const tip = o.tip ?? 0; const subtotal = o.subtotal; const tenders = o.tenders;   // [{method, amount}]
    const total = subtotal + tip;
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, chosen_payment_method, checkout_register_id, paid_at, created_at)
      values ($1,$2,$3,$4,$5,'paid',$6,0,0,$7,$8,$9,$10,$11,$12,$12::timestamptz - interval '35 minutes')`, [tid, PILOT, BRANCH, o.customer, o.techs[0].id, subtotal, total, tip, String(tn), tenders[0].method === 'cash' ? 'cash' : 'card', o.register ?? REG.front, at]);
    for (const t of tenders) await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, payment_surface, card_brand, card_last4, created_at) values ($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9,$10,$11,$12)`,
      [PID(), PILOT, BRANCH, tid, t.method, t.amount, tenders.length === 1 ? tip : 0, t.method === 'card' ? 'RR' + String(500000 + pn * 31) : null, t.method === 'card' ? (rnd() < 0.3 ? 'tap_to_pay_iphone' : 'cardpointe_terminal') : t.method === 'cash' ? 'cash' : 'pos', t.method === 'card' ? pick(['VISA', 'MC', 'AMEX']) : null, t.method === 'card' ? String(1000 + Math.floor(rnd() * 9000)) : null, at]);
    for (const tech of o.techs) { const svc = pick(SERVICES); await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, created_at) values ($1,$2,$3,$4,$5,$9,$6,$7,45,$7,'completed',$8)`, [LID(), PILOT, BRANCH, tid, tech.id, svc, Math.round(subtotal / o.techs.length), at, SVC(svc)]); }
    if (tip > 0) {
      const cardShare = tenders.length === 1 ? (tenders[0].method === 'cash' ? 0 : tip) : tip;   // the engine's rule: a split's tip follows the chosen (card) rail here
      const lines = (await q(`select id from ticket_service_lines where ticket_id = $1 order by created_at, id`, [tid])).rows;
      for (const [i, tech] of o.techs.entries()) {
        const share = tech.tip ?? Math.round(tip / o.techs.length);
        await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents, created_at) values ($1,$2,$3,$4,$5,$6)`, [PILOT, BRANCH, tid, tech.id, share, at]);
        const cardPart = Math.round(share * cardShare / tip);
        if (!o.noSnapshot) await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, tech_service_earnings_cents, card_tip_cents, cash_tip_cents, snapshot_at) values ($1,$2,$3,$4,$5,'1.0.0',$6,$7,$8,$9,$10)`,
          [PILOT, BRANCH, tid, lines[i].id, tech.id, Math.round(subtotal / o.techs.length), Math.round(subtotal / o.techs.length * 0.6), cardPart, share - cardPart, at]);
      }
    }
    return tid;
  }
  const techList = Object.values(TECH);
  // ── the photo: #1052 $9.60 card tip, Vishal, snapshot credited TWICE (two line rows); #1050 / #1051 no tip ──
  tn = 1049;
  for (const sub of [4500, 6000]) await paidTicket({ customer: pick(customers).id, techs: [{ id: TECH.vishal }], subtotal: sub, tip: 0, tenders: [{ method: 'card', amount: sub }], minsAgo: 60 * 30 });
  const photo = await paidTicket({ customer: JOHN, techs: [{ id: TECH.vishal }], subtotal: 14400, tip: 960, tenders: [{ method: 'card', amount: 15360 }], minsAgo: 60 * 26 });
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, created_at) values ($1,$2,$3,$4,$5,$6,'Nail Art',2000,20,2000,'completed', now() - interval '26 hours')`, [LID(), PILOT, BRANCH, photo, TECH.vishal, SVC('Nail Art')]);
  await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, tech_service_earnings_cents, card_tip_cents, cash_tip_cents, snapshot_at) values ($1,$2,$3,$4,$5,'1.0.0',2000,1200,960,0, now() - interval '25 hours')`, [PILOT, BRANCH, photo, id('92810000', ln), TECH.vishal]);
  // ── ten weeks of ordinary tipped / untipped tickets ──
  tn = 1052; let made = 0;
  while (made < 140) {
    const mins = Math.floor(rnd() * 60 * 24 * 70) + 60 * 27; const c = pick(customers); const sub = 3000 + Math.floor(rnd() * 150) * 100;
    const ntech = rnd() < 0.78 ? 1 : rnd() < 0.7 ? 2 : 3; const techs = [...new Set(Array.from({ length: ntech }, () => pick(techList)))].map((id) => ({ id }));
    const tipRate = rnd() < 0.22 ? 0 : pick([0.15, 0.18, 0.2, 0.2, 0.25]); let tip = Math.round(sub * tipRate / 100) * 100;
    if (techs.length > 1 && tip > 0) { let rem = tip; techs.forEach((t, i) => { t.tip = i === techs.length - 1 ? rem : Math.round(tip * (i === 0 ? 0.5 : 0.3) / 100) * 100; rem -= t.tip; }); }
    const r = rnd(); const tenders = r < 0.6 ? [{ method: 'card', amount: sub + tip }] : r < 0.85 ? [{ method: 'cash', amount: sub + tip }] : [{ method: 'card', amount: Math.round((sub + tip) * 0.6 / 100) * 100 }, { method: 'cash', amount: sub + tip - Math.round((sub + tip) * 0.6 / 100) * 100 }];
    await paidTicket({ customer: c.id, techs, subtotal: sub, tip, tenders, minsAgo: mins, register: rnd() < 0.3 ? REG.back : REG.front }); made++;
  }
  // ── the Split Payments canonical tickets (recent) ──
  tn = 1200;
  const s100 = await paidTicket({ customer: JOHN, techs: [{ id: TECH.anna }], subtotal: 10000, tip: 0, tenders: [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 4000 }], minsAgo: 60 * 5 });
  const s80 = await paidTicket({ customer: pick(customers).id, techs: [{ id: TECH.bao }], subtotal: 8000, tip: 0, tenders: [{ method: 'gift_card', amount: 3000 }, { method: 'card', amount: 5000 }], minsAgo: 60 * 8 });
  await q(`insert into gift_cards (id, tenant_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,'GC-SEEDSECRET','4471',5000,2000,5000,'active')`, [id('70810000', 1), PILOT]);
  const gp = (await q(`select id from payments where ticket_id = $1 and method = 'gift_card'`, [s80])).rows[0].id;
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, payment_id) values ($1,$2,$3,'redeem',3000,2000,$4,$5)`, [PILOT, BRANCH, id('70810000', 1), s80, gp]);
  const s150 = await paidTicket({ customer: JOHN, techs: [{ id: TECH.anna, tip: 1200 }, { id: TECH.chi, tip: 800 }], subtotal: 13000, tip: 2000, tenders: [{ method: 'cash', amount: 5000 }, { method: 'card', amount: 6000 }, { method: 'gift_card', amount: 4000 }], minsAgo: 60 * 12, register: REG.back });
  // $120 partially paid: $70 card confirmed + a DECLINED $50 card attempt
  const partial = TID(); tn++;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, locked_total_cents, ticket_number, chosen_payment_method, checkout_register_id, checkout_status, created_at)
    values ($1,$2,$3,$4,$5,'ready_checkout',12000,0,0,12000,0,12000,$6,'card',$7,'failed', now() - interval '3 hours')`, [partial, PILOT, BRANCH, pick(customers).id, TECH.mai, String(tn), REG.front]);
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, payment_surface, created_at) values ($1,$2,$3,$4,'card',7000,0,'approved','RR700001','cardpointe_terminal', now() - interval '170 minutes'), ($5,$2,$3,$4,'card',5000,0,'declined',null,'cardpointe_terminal', now() - interval '168 minutes')`, [PID(), PILOT, BRANCH, partial, PID()]);
  // a $100 split with a $30 refund on the card tender
  const sRef = await paidTicket({ customer: pick(customers).id, techs: [{ id: TECH.vishal }], subtotal: 10000, tip: 0, tenders: [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 4000 }], minsAgo: 60 * 24 * 2 });
  const ct = (await q(`select id from payments where ticket_id = $1 and method = 'card'`, [sRef])).rows[0].id;
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, created_at) values ($1,$2,$3,$4,'card',3000,0,'refunded','RF700002', now() - interval '40 hours')`, [PID(), PILOT, BRANCH, sRef]);
  await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, amount_cents, reason, status, processor_refund_id, created_by_user_id, created_at) values ($1,$2,$3,$4,3000,'Customer unhappy with the polish','refunded','RF700002',$5, now() - interval '40 hours')`, [id('81810000', 1), PILOT, BRANCH, ct, MANAGER_USER]);
  // ── a refunded tip (reversal) and a manual re-split on a PAID-period ticket ──
  const refundedTip = await paidTicket({ customer: pick(customers).id, techs: [{ id: TECH.chi }], subtotal: 6000, tip: 800, tenders: [{ method: 'card', amount: 6800 }], minsAgo: 60 * 24 * 4 });
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source, requested_by, approved_by, created_at) values ($1,$2,$3,$4,'tip_correction',-800,'Refund RF700003 — tip refunded to the customer','posted','refund',$5,$5, now() - interval '3 days')`, [PILOT, BRANCH, TECH.chi, refundedTip, MANAGER_USER]);
  const old = await paidTicket({ customer: pick(customers).id, techs: [{ id: TECH.vishal, tip: 700 }, { id: TECH.anna, tip: 500 }], subtotal: 9000, tip: 1200, tenders: [{ method: 'card', amount: 10200 }], minsAgo: 60 * 24 * 40 });
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, ticket_id, category, amount_cents, reason, status, source, requested_by, approved_by, created_at) values ($1,$2,$3,$5,'tip_correction',-300,'Anna did the pedicure','posted','manual',$6,$6, now() - interval '38 days'), ($1,$2,$4,$5,'tip_correction',300,'Anna did the pedicure','posted','manual',$6,$6, now() - interval '38 days')`, [PILOT, BRANCH, TECH.vishal, TECH.anna, old, MANAGER_USER]);
  const counts = (await q(`select (select count(*) from tickets where tenant_id = $1)::int t, (select count(*) from payments where tenant_id = $1)::int p, (select coalesce(sum(tip_cents),0) from tickets where tenant_id = $1 and status = 'paid')::int tips`, [PILOT])).rows[0];
  return { tickets: counts.t, payments: counts.p, tipsCents: counts.tips, photo, s100, s80, s150, partial, sRef, refundedTip, old };
}
