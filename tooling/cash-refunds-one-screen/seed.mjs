// seed.mjs — End-of-Day Cash + Refunds & Voids one-screen harness (Oct 29 2026). Seeds a TEST salon into a fresh database.
// Tooling only — never run against production; every figure is a fixture.
//   End-of-Day Cash: confirmed cash-to-technician collections (cash_payment_confirmations) for five technicians over the last
//   ~5 weeks, the hand-off units (tech_cash_handoffs) in every state — awaiting, handed off, balanced, short, over, resolved —
//   with their custody events; TODAY: Anna $300 from two partial hand-offs ($200 + $100), Bao $250 counted $245 (short $5),
//   Chi $80 awaiting, and a $100 split ticket paid $40 cash to Mai + $60 card (only the $40 is her custody).
//   Refunds & Voids: card / cash / gift-card tenders with completed, partial, pending (reserved), lost-answer (needs review),
//   failed and cancelled refunds, voids (the original marked voided + the zero-amount void record + the audit reason), a
//   settlement batch, a gift-card refund on its ledger; $100 captured with $30 refunded + $20 pending = $50 refundable.
const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0820000', 1), EMPTY = id('f0820000', 2), OTHER = id('f0820000', 3);
export const BRANCH = id('b0820000', 1), BRANCH_E = id('b0820000', 3), BRANCH_O = id('b0820000', 4);
export const OWNER_USER = id('a0820000', 1), MANAGER_USER = id('a0820000', 2), DESK_USER = id('a0820000', 3), TECH_USER = id('a0820000', 4);
export const TECH = { anna: id('e0820000', 1), bao: id('e0820000', 2), chi: id('e0820000', 3), mai: id('e0820000', 4), dee: id('e0820000', 5), finn: id('e0820000', 6) };
export const REG = { front: id('d0820000', 1), back: id('d0820000', 2) };
const FIRST = ['Linh', 'Mai', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Emily', 'Sarah', 'Jessica', 'Olivia', 'Grace', 'Chloe'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Smith', 'Johnson', 'Garcia', 'Brown'];
let seedN = 41; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const TZ = 'America/New_York';
export const salonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (ymd, d) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
/** a salon-local wall-clock time on a business date → ISO (New York is UTC−4 until Nov 1 2026, then −5) */
const at = (ymd, hh, mm = 0) => { const off = ymd >= '2026-11-01' ? 5 : 4; const d = new Date(`${ymd}T00:00:00Z`); d.setUTCHours(hh + off, mm); return d.toISOString(); };

export async function seed(pg) {
  const q = (s, p = []) => pg.query(s, p);
  const today = salonToday();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-cr','PCR001','active'), ($2,'New Salon LLC','New Salon','new-cr','NCR001','active'), ($3,'Other Salon LLC','Other Salon','other-cr','OCR001','active')`, [PILOT, EMPTY, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active',$7), ($3,$4,'Main','active',$7), ($5,$6,'Elsewhere','active',$7)`, [BRANCH, PILOT, BRANCH_E, EMPTY, BRANCH_O, OTHER, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$5,'owner@pilot.test','Pat Owner','OWNER','active'), ($2,$5,'manager@pilot.test','Mai Manager','MANAGER','active'), ($3,$5,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active'), ($4,$5,'tech@pilot.test','Anna Lee','TECHNICIAN','active')`, [OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, PILOT]);
  const T = [['anna', 'Anna', 'Lee', '+16095550101', TECH_USER], ['bao', 'Bao', 'Tran', '+16095550102', null], ['chi', 'Chi', 'Pham', '+16095550103', null], ['mai', 'Mai', 'Nguyen', '+16095550104', null], ['dee', 'Dee', 'Park', '+16095550105', null], ['finn', 'Finn', 'Vo', '+16095550106', null]];
  for (const [k, f, l, ph, u] of T) await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, normalized_phone, status, is_active) values ($1,$2,$3,$4,$5,$6,$7,$8,'active',true)`, [TECH[k], PILOT, BRANCH, u, f, l, `${f} ${l}`, ph]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, is_active) values ($1,$2,$3,'Anna','Lee','Anna Lee','+16095550101','active',true)`, [id('e0820000', 99), OTHER, BRANCH_O]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name) values ($1,$3,$4,'Front Desk'), ($2,$3,$4,'Back Bar')`, [REG.front, REG.back, PILOT, BRANCH]);
  const customers = [];
  for (let i = 1; i <= 40; i++) {
    const cid = id('c0820000', i); const f = pick(FIRST), l = pick(LAST); const tail = String(2000 + i).slice(-4);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [cid, PILOT, BRANCH, f, l, `${f} ${l}`, `+1856555${tail}`, `(856) 555-${tail}`, rnd() < 0.5 ? `${f.toLowerCase()}.${i}@example.com` : null]);
    customers.push(cid);
  }
  const JOHN = id('c0820000', 900);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com')`, [JOHN, PILOT, BRANCH]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'John','Smith','John Smith','+18565551234')`, [id('c0820000', 901), OTHER, BRANCH_O]);

  let n = 0, tn = 4000;
  const TID = () => id('90820000', ++n), PID = () => id('91820000', ++n), XID = () => id('93820000', ++n);
  async function ticket(o) {
    const tid = TID(); const num = o.number ?? String(++tn);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, checkout_register_id, paid_at, created_at) values ($1,$2,$3,$4,$5,'paid',$6,0,0,$6,$7,$8,$9,$10,$10::timestamptz - interval '30 minutes')`,
      [tid, o.tenant ?? PILOT, o.branch ?? BRANCH, o.customer ?? pick(customers), o.tech ?? null, o.total, o.tip ?? 0, num, o.tenant ? null : (o.register ?? REG.front), o.at]);
    return { tid, num };
  }
  async function pay(tid, method, amount, o) {
    const pid = PID();
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor, processor_transaction_id, settlement_batch_id, card_brand, card_last4, gift_card_last4, payment_surface, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [pid, o.tenant ?? PILOT, o.branch ?? BRANCH, tid, method, amount, o.status ?? 'approved', method === 'card' ? 'cardpointe' : null, o.ref ?? (method === 'card' ? 'RR' + String(800000 + n) : null), o.settlement ?? null, method === 'card' ? (o.brand ?? 'VISA') : null, method === 'card' ? (o.last4 ?? '4242') : null, method === 'gift_card' ? (o.gift4 ?? '7719') : null, method === 'card' ? 'cardpointe_terminal' : method === 'cash' ? 'cash' : 'pos', o.at]);
    return pid;
  }
  /** a confirmed cash-to-technician collection on a ticket (the custody source) */
  async function cash(tech, cents, when, o = {}) {
    const t = await ticket({ total: o.total ?? cents, at: when, customer: o.customer, tech, number: o.number });
    await q(`insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, customer_id, technician_id, amount_cents, confirmed_by_user_id, confirmed_at, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed')`, [PILOT, BRANCH, t.tid, o.customer ?? null, tech, cents, DESK_USER, when]);
    return t;
  }
  async function unit(tech, date, o) {
    const hid = XID();
    const variance = o.counted == null ? null : o.counted - o.expected;
    await q(`insert into tech_cash_handoffs (id, tenant_id, branch_id, technician_id, business_date, expected_cents, counted_cents, variance_cents, payment_count, status, submitted_by_user_id, submitted_at, reconciled_by_user_id, reconciled_at, notes, resolution_reason, resolved_by_user_id, resolved_at, version, drawer_transfer_cents, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)`,
      [hid, PILOT, BRANCH, tech, date, o.expected, o.counted ?? null, variance, o.count ?? 1, o.status, o.submitted ? TECH_USER : null, o.submitted ? at(date, 19) : null, o.counted == null ? null : (o.by ?? DESK_USER), o.counted == null ? null : at(date, 20), o.notes ?? null, o.resolved ?? null, o.resolved ? MANAGER_USER : null, o.resolved ? at(date, 21) : null, o.version ?? 1, o.drawer ?? 0, at(date, o.counted == null ? 19 : 20)]);
    for (const e of o.events ?? []) await q(`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, reason, actor_user_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [PILOT, BRANCH, tech, date, hid, e.type, e.amount, o.expected, e.total, e.total == null ? null : e.total - o.expected, e.reason ?? null, e.by ?? DESK_USER, e.at]);
    return hid;
  }

  // ── TODAY (the screenshot's day) ──
  await cash(TECH.anna, 18000, at(today, 11), { customer: JOHN, number: '5001' });
  await cash(TECH.anna, 12000, at(today, 14), { number: '5002' });
  await unit(TECH.anna, today, { expected: 30000, counted: 30000, status: 'reconciled', count: 2, version: 3, events: [{ type: 'partial', amount: 20000, total: 20000, at: at(today, 15) }, { type: 'partial', amount: 10000, total: 30000, at: at(today, 20) }] });
  await cash(TECH.bao, 25000, at(today, 13), { number: '5003' });
  await unit(TECH.bao, today, { expected: 25000, counted: 24500, status: 'discrepancy', notes: 'Counted twice — $5 short', events: [{ type: 'counted', amount: 24500, total: 24500, reason: 'Counted twice — $5 short', at: at(today, 20) }] });
  await cash(TECH.chi, 8000, at(today, 16), { number: '5004' });
  const split = await cash(TECH.mai, 4000, at(today, 17), { total: 10000, customer: JOHN, number: '5005' });   // $100 ticket: $40 cash to Mai …
  await pay(split.tid, 'card', 6000, { at: at(today, 17, 1) });                                                    // … + $60 card at the desk
  // last night 11:30 PM (business date = yesterday, UTC date = today)
  const yesterday = addDays(today, -1);
  await cash(TECH.dee, 6000, at(yesterday, 23, 30), { number: '5006' });
  // ── the last ~5 weeks: every state ──
  const states = ['reconciled', 'reconciled', 'reconciled', 'discrepancy_short', 'discrepancy_over', 'resolved', 'submitted', 'open'];
  let num = 5100;
  for (let d = 1; d <= 34; d++) {
    const date = addDays(today, -d); if (new Date(date + 'T12:00:00Z').getUTCDay() === 1) continue;   // closed Mondays
    for (const tech of [TECH.anna, TECH.bao, TECH.chi, TECH.mai]) {
      if (rnd() < 0.35) continue;
      const amounts = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => (30 + Math.floor(rnd() * 90)) * 100);
      for (const [i, a] of amounts.entries()) await cash(tech, a, at(date, 10 + i * 2), { number: String(++num), customer: rnd() < 0.5 ? pick(customers) : undefined });
      const exp = amounts.reduce((x, y) => x + y, 0);
      const s = d === 1 && tech === TECH.chi ? 'open' : pick(states);
      if (s === 'open') continue;
      if (s === 'submitted') { await unit(tech, date, { expected: exp, status: 'submitted', submitted: true, count: amounts.length, events: [{ type: 'submitted', amount: exp, total: null, at: at(date, 19), by: TECH_USER }] }); continue; }
      const counted = s === 'discrepancy_short' ? exp - 500 : s === 'discrepancy_over' ? exp + 500 : s === 'resolved' ? exp - 1000 : exp;
      await unit(tech, date, { expected: exp, counted, status: s.startsWith('discrepancy') ? 'discrepancy' : 'reconciled', count: amounts.length, version: s === 'resolved' ? 3 : 2, drawer: rnd() < 0.4 ? counted : 0,
        resolved: s === 'resolved' ? 'Recounted with the technician; $10 was paid out for supplies (receipt on file)' : null, notes: counted !== exp ? 'Difference on count' : null,
        events: [{ type: 'counted', amount: counted, total: counted, at: at(date, 20) }, ...(s === 'resolved' ? [{ type: 'resolved', amount: counted, total: counted, reason: 'Recounted with the technician; $10 was paid out for supplies (receipt on file)', at: at(date, 21), by: MANAGER_USER }] : [])] });
    }
  }
  // another salon's unit (must never appear)
  { const t = await ticket({ tenant: OTHER, branch: BRANCH_O, total: 9900, at: at(today, 12), customer: id('c0820000', 901), number: '5001' });
    await q(`insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, technician_id, amount_cents, confirmed_at, status) values ($1,$2,$3,$4,9900,$5,'confirmed')`, [OTHER, BRANCH_O, t.tid, id('e0820000', 99), at(today, 12)]); }

  // ── Refunds & Voids ──
  await q(`insert into payment_settlements (id, tenant_id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, status, settled_at, refunds_cents) values ($1,$2,$3,'cardpointe','BATCH-1027',184000,5300,178700,'settled',$4,3000)`, [id('71820000', 1), PILOT, BRANCH, at(addDays(today, -2), 23)]);
  async function refund(pid, amount, status, o) {
    const rid = id('81820000', ++n);
    await q(`insert into payment_refunds (id, tenant_id, branch_id, payment_id, processor_type, amount_cents, reason, status, processor_refund_id, created_by_user_id, created_at, review_reason, stranded_at, settled_at, settled_by, last_error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [rid, o.tenant ?? PILOT, o.branch ?? BRANCH, pid, o.processor ?? null, amount, o.reason ?? 'Customer request', status, o.ref ?? null, o.tenant ? null : (o.by ?? MANAGER_USER), o.at, o.review ?? null, o.review ? o.at : null, status === 'refunded' ? o.at : null, status === 'refunded' ? (o.settledBy ?? 'live') : null, o.error ?? null]);
    if (status === 'refunded' && !o.noRow) await pay(o.ticket, o.method ?? 'card', amount, { status: 'refunded', ref: o.ref, at: o.at });
    return rid;
  }
  const d = (k, h = 12) => at(addDays(today, -k), h);
  const out = {};
  // 1. $100 card: completed $30 + pending $20 → $50 refundable (settled in BATCH-1027)
  { const t = await ticket({ total: 10000, customer: JOHN, at: d(3), number: '6001' }); const p = await pay(t.tid, 'card', 10000, { at: d(3), settlement: id('71820000', 1), ref: 'RR6001' });
    out.r6001 = await refund(p, 3000, 'refunded', { ticket: t.tid, at: d(2, 10), ref: 'RF6001', processor: 'cardpointe', reason: 'Chipped polish on two nails' });
    out.r6001b = await refund(p, 2000, 'reserved', { at: d(0, 9), processor: 'cardpointe', reason: 'Goodwill — late appointment' }); out.p6001 = p; }
  // 2. $100 split $60 card + $40 cash: $30 refunded on the card only
  { const t = await ticket({ total: 10000, customer: JOHN, at: d(5), number: '6002' }); const c = await pay(t.tid, 'card', 6000, { at: d(5), ref: 'RR6002' }); await pay(t.tid, 'cash', 4000, { at: d(5) });
    out.r6002 = await refund(c, 3000, 'refunded', { ticket: t.tid, at: d(4), ref: 'RF6002', processor: 'cardpointe', reason: 'Service not finished' }); }
  // 3. a $45 card voided before settlement
  { const t = await ticket({ total: 4500, at: d(1, 15), number: '6003' }); const p = await pay(t.tid, 'card', 4500, { status: 'voided', ref: 'RR6003', at: d(1, 15) });
    await pay(t.tid, 'card', 0, { status: 'voided', ref: 'VD6003', at: d(1, 16) });
    await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json, created_at) values ($1,$2,$3,'MANAGER','pos_checkout_void_created','pos_void',$4,$5::jsonb,$6)`, [PILOT, BRANCH, MANAGER_USER, p, JSON.stringify({ metadata: { reason: 'Wrong amount keyed' } }), d(1, 16)]); out.v6003 = p; }
  // 4. lost processor answer → needs review
  { const t = await ticket({ total: 2500, customer: customers[3], at: d(6), number: '6004' }); const p = await pay(t.tid, 'card', 2500, { at: d(6), ref: 'RR6004' });
    out.r6004 = await refund(p, 2500, 'processing', { at: d(6, 15), processor: 'cardpointe', review: 'processor_status_unavailable', error: 'threw: ETIMEDOUT' }); }
  // 5. declined refund → failed (still refundable)
  { const t = await ticket({ total: 5000, at: d(7), number: '6005' }); const p = await pay(t.tid, 'card', 5000, { at: d(7), ref: 'RR6005' });
    out.r6005 = await refund(p, 5000, 'failed', { at: d(7, 15), processor: 'cardpointe', reason: 'Double charge reported' }); out.p6005 = p; }
  // 6. gift-card refund restored onto the card
  { await q(`insert into gift_cards (id, tenant_id, code, card_number_last4, initial_balance_cents, balance_cents, purchased_cents, status) values ($1,$2,'GC-HARNESS-SECRET','7719',5000,5000,5000,'active')`, [id('70820000', 1), PILOT]);
    const t = await ticket({ total: 2000, at: d(8), number: '6006' }); const p = await pay(t.tid, 'gift_card', 2000, { at: d(8) });
    const rp = await pay(t.tid, 'gift_card', 2000, { status: 'refunded', at: d(8, 14) });
    out.r6006 = await refund(p, 2000, 'refunded', { ref: rp, at: d(8, 14), settledBy: 'gift_card', noRow: true, reason: 'Duplicate gift-card charge' });
    await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id, payment_id, created_at) values ($1,$2,$3,'refund',2000,5000,$4,$5,$6)`, [PILOT, BRANCH, id('70820000', 1), t.tid, rp, d(8, 14)]); }
  // 7. a full cash refund (drawer payout)
  { const t = await ticket({ total: 3500, at: d(9), number: '6007' }); const p = await pay(t.tid, 'cash', 3500, { at: d(9) });
    out.r6007 = await refund(p, 3500, 'refunded', { ticket: t.tid, method: 'cash', at: d(9, 14), settledBy: 'cash', reason: 'Allergic reaction — full refund' }); }
  // 8–30: ordinary history for paging (completed card refunds, a few voids, cancelled ones)
  let k = 6100;
  for (let i = 0; i < 24; i++) {
    const days = 2 + Math.floor(rnd() * 26); const total = (25 + Math.floor(rnd() * 90)) * 100; const t = await ticket({ total, customer: pick(customers), at: d(days), number: String(++k) });
    const r = rnd();
    if (r < 0.2) { const p = await pay(t.tid, 'card', total, { status: 'voided', at: d(days) }); await pay(t.tid, 'card', 0, { status: 'voided', ref: 'VD' + k, at: d(days, 13) });
      await q(`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json, created_at) values ($1,$2,$3,'MANAGER','pos_checkout_void_created','pos_void',$4,$5::jsonb,$6)`, [PILOT, BRANCH, MANAGER_USER, p, JSON.stringify({ metadata: { reason: pick(['Keyed twice', 'Customer changed tender', 'Wrong ticket']) } }), d(days, 13)]); continue; }
    const p = await pay(t.tid, 'card', total, { at: d(days), ref: 'RR' + k });
    const amt = r < 0.6 ? total : Math.round(total * 0.4 / 100) * 100;
    if (r > 0.95) { await refund(p, amt, 'cancelled', { at: d(days, 14), processor: 'cardpointe' }); continue; }
    await refund(p, amt, 'refunded', { ticket: t.tid, at: d(days - 1, 11), ref: 'RF' + k, processor: 'cardpointe', reason: pick(['Customer unhappy with the shape', 'Service redone free', 'Price adjustment', 'Booked the wrong service']) });
  }
  // a captured, untouched card payment to refund in the harness + a settled one (void not allowed)
  { const t = await ticket({ total: 6800, customer: JOHN, at: d(0, 11), number: '6200' }); out.p6200 = await pay(t.tid, 'card', 6800, { at: d(0, 11), ref: 'RR6200' }); }
  { const t = await ticket({ total: 5400, customer: JOHN, at: d(2, 11), number: '6201' }); out.p6201 = await pay(t.tid, 'card', 5400, { at: d(2, 11), ref: 'RR6201', settlement: id('71820000', 1) }); }
  { const t = await ticket({ total: 3900, customer: customers[5], at: d(0, 12), number: '6202' }); out.p6202 = await pay(t.tid, 'card', 3900, { at: d(0, 12), ref: 'RR6202' }); }   // unsettled, untouched: voidable
  // another salon's refund (never visible)
  { const t = await ticket({ tenant: OTHER, branch: BRANCH_O, total: 9900, at: d(2), customer: id('c0820000', 901), number: '6001' }); const p = await pay(t.tid, 'card', 9900, { tenant: OTHER, branch: BRANCH_O, ref: 'RR9999', at: d(2) });
    await refund(p, 9900, 'refunded', { tenant: OTHER, branch: BRANCH_O, ticket: t.tid, at: d(1), ref: 'RF9999', noRow: true }); }
  const counts = (await q(`select (select count(*) from cash_payment_confirmations where tenant_id = $1)::int conf, (select count(*) from tech_cash_handoffs where tenant_id = $1)::int units, (select count(*) from payment_refunds where tenant_id = $1)::int refunds`, [PILOT])).rows[0];
  return { today, ...counts, ...out };
}
