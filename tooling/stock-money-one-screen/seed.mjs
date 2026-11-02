// seed.mjs — Stock Alerts + Transactions + Payments & Money one-screen harness (Oct 29 2026). Seeds a TEST salon into a fresh
// database. Tooling only — never run against production; every figure is a fixture, no real customer, card or phone.
//   Stock Alerts: ~30 products; ELEVEN of them already at / below their reorder level with NO alert row (the photo's
//   "sidebar 11, page 0"), one already acknowledged, one on an open purchase order (PO-1042), vendors with phones, two
//   technicians both named "Anna Lee" (never merged), product uses recorded through the REAL InventoryService writer
//   (fractions, a backdated one, one reversed), and a Service-Done recipe deduction attributed to the ticket line's tech.
//   Transactions + Overview: TODAY the photo's three card tenders $63.16 + $53.27 + $51.72 (a split's 'partial' tender —
//   that ticket still owes $30.00) with $9.60 of tips across the three tickets, plus a month of tickets: splits, cash, gift
//   card, a completed and a pending refund, a void, declined and unanswered attempts, invoices, settlements (pending and
//   posted), a chargeback. Another salon has a "John Smith" with the same phone (must never show).
const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0950000', 1), EMPTY = id('f0950000', 2), OTHER = id('f0950000', 3);
export const BRANCH = id('b0950000', 1), BRANCH_E = id('b0950000', 3), BRANCH_O = id('b0950000', 4);
export const OWNER_USER = id('a0950000', 1), MANAGER_USER = id('a0950000', 2), DESK_USER = id('a0950000', 3), TECH_USER = id('a0950000', 4), TECH2_USER = id('a0950000', 5);
export const TECH = { anna: id('e0950000', 1), bao: id('e0950000', 2), chi: id('e0950000', 3), mai: id('e0950000', 4), anna2: id('e0950000', 5) };
const TZ = 'America/New_York';
export const salonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (ymd, d) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
/** a salon-local wall-clock time on a business date → ISO (New York is UTC−4 until Nov 1 2026, then −5) */
export const at = (ymd, hh, mm = 0) => { const off = ymd >= '2026-11-01' ? 5 : 4; const d = new Date(`${ymd}T00:00:00Z`); d.setUTCHours(hh + off, mm); return d.toISOString(); };
let seedN = 77; const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FIRST = ['Linh', 'Thao', 'Hoa', 'Lan', 'Ngoc', 'Emily', 'Sarah', 'Jessica', 'Olivia', 'Grace', 'Chloe'];
const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Johnson', 'Garcia', 'Brown'];
export const PRODUCTS = {};

export async function seed(pg, inv) {
  const q = (s, p = []) => pg.query(s, p);
  const today = salonToday(); const now = Date.now();
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-sm','PSM001','active'), ($2,'New Salon LLC','New Salon','new-sm','NSM001','active'), ($3,'Other Salon LLC','Other Salon','other-sm','OSM001','active')`, [PILOT, EMPTY, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Cherry Hill','active',$7), ($3,$4,'Main','active',$7), ($5,$6,'Elsewhere','active',$7)`, [BRANCH, PILOT, BRANCH_E, EMPTY, BRANCH_O, OTHER, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$6,'owner@pilot.test','Pat Owner','OWNER','active'), ($2,$6,'manager@pilot.test','Mai Manager','MANAGER','active'), ($3,$6,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active'), ($4,$6,'tech@pilot.test','Anna Lee','TECHNICIAN','active'), ($5,$6,'tech2@pilot.test','Anna Lee','TECHNICIAN','active')`, [OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, TECH2_USER, PILOT]);
  for (const [k, f, l, u] of [['anna', 'Anna', 'Lee', TECH_USER], ['bao', 'Bao', 'Tran', null], ['chi', 'Chi', 'Pham', null], ['mai', 'Mai', 'Nguyen', null], ['anna2', 'Anna', 'Lee', TECH2_USER]])
    await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,$4,$5,$6,$7,'active',true)`, [TECH[k], PILOT, BRANCH, u, f, l, `${f} ${l}`]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Anna','Lee','Anna Lee','active',true)`, [id('e0950000', 99), OTHER, BRANCH_O]);
  // customers: John Smith (+1 856 555 1234) here AND a John Smith with the same phone at the other salon
  const customers = [id('c0950000', 1)];
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234','john.smith@example.com')`, [customers[0], PILOT, BRANCH]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'John','Smith','John Smith','+18565551234','(856) 555-1234'), ($4,$2,$3,'Walk','In','Walk-in',null,null)`, [id('c0950000', 900), OTHER, BRANCH_O, id('c0950000', 901)]);
  for (let i = 2; i <= 30; i++) { const cid = id('c0950000', i); const f = pick(FIRST), l = pick(LAST); const tail = String(3000 + i).slice(-4); customers.push(cid);
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [cid, PILOT, BRANCH, f, l, `${f} ${l}`, `+1856555${tail}`, `(856) 555-${tail}`, rnd() < 0.5 ? `${f.toLowerCase()}.${i}@example.com` : null]); }

  // ── inventory ──
  await q(`insert into inventory_categories (id, tenant_id, name) values ($1,$3,'Gel Polish'), ($2,$3,'Supplies')`, [id('c1950000', 1), id('c1950000', 2), PILOT]);
  await q(`insert into inventory_brands (id, tenant_id, name) values ($1,$4,'DND'), ($2,$4,'OPI'), ($3,$4,'Kiara Sky')`, [id('c2950000', 1), id('c2950000', 2), id('c2950000', 3), PILOT]);
  await q(`insert into inventory_vendors (id, tenant_id, name, phone) values ($1,$3,'Nail Supply Co','(609) 555-0188'), ($2,$3,'Beauty Wholesale','(215) 555-0142')`, [id('c3950000', 1), id('c3950000', 2), PILOT]);
  const COLORS = ['Rose Petal', 'Ballet Slipper', 'Cherry Bomb', 'Midnight Blue', 'Champagne', 'Coral Reef', 'Lilac Dream', 'Mocha', 'Ivory Lace', 'Ruby Red', 'Sage', 'Sunset', 'Pearl', 'Plum', 'Mint', 'Gold Leaf', 'Nude Blush', 'Ocean'];
  let pn = 0;
  const product = async (key, name, o) => {
    const pidv = id('c4950000', ++pn); PRODUCTS[key] = pidv;
    await q(`insert into inventory_products (id, tenant_id, name, sku, barcode, active, reorder_level, reorder_quantity, critical_level, unit_type, tracking_mode, category_id, brand_id, preferred_vendor_id, color_number, allow_negative_stock) values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,'bottle',$10,$11,$12,$13,$14)`,
      [pidv, PILOT, name, o.sku, o.barcode ?? null, o.reorder ?? 3, o.qty ?? 6, o.critical ?? null, o.unit ?? 'bottle', o.cat ?? id('c1950000', 1), o.brand ?? id('c2950000', 1), o.vendor ?? id('c3950000', 1), o.color ?? null, o.neg ?? false]);
    for (let i = 0; i < (o.bottles ?? 0); i++) await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, estimated_remaining_percent, created_at) values ($1,$2,$3,$4,$5,$6)`, [PILOT, BRANCH, pidv, o.opened && i === 0 ? 'opened' : 'unopened', o.opened && i === 0 ? o.opened : null, ago(24 * (40 - i))]);
    return pidv;
  };
  // eleven ALREADY low / out (bottles below the reorder level from the start — no threshold was ever crossed → no alert row)
  const low = [[0, 4], [0, 3], [1, 4], [1, 3], [1, 5], [2, 5], [2, 4], [0, 2], [1, 2], [2, 6], [3, 6]];
  for (const [i, [b, r]] of low.entries()) await product('low' + i, `${COLORS[i]} Gel`, { sku: `GEL-${String(400 + i)}`, barcode: `00800${String(100 + i)}`, bottles: b, reorder: r, color: String(400 + i), brand: id('c2950000', 1 + (i % 3)), vendor: id('c3950000', 1 + (i % 2)) });
  // healthy products
  for (let i = 11; i < COLORS.length; i++) await product('ok' + i, `${COLORS[i]} Gel`, { sku: `GEL-${400 + i}`, barcode: `00800${100 + i}`, bottles: 6 + (i % 3), reorder: 2, opened: i % 2 ? 60 : null });
  await product('base', 'Base Coat', { sku: 'BC-01', barcode: '0080099', bottles: 5, reorder: 2, opened: 40, brand: id('c2950000', 2) });
  await product('top', 'Top Coat', { sku: 'TC-01', barcode: '0080098', bottles: 4, reorder: 2, brand: id('c2950000', 2) });
  await product('gloves', 'Nitrile Gloves (pair)', { sku: 'SUP-GLV', bottles: 40, reorder: 10, unit: 'pair', cat: id('c1950000', 2), vendor: id('c3950000', 2) });
  await product('acetone', 'Acetone', { sku: 'SUP-ACE', bottles: 2, reorder: 1, cat: id('c1950000', 2), neg: true });
  for (const k of Object.keys(PRODUCTS)) await inv.recompute({ tenantId: PILOT, branchId: BRANCH, userId: MANAGER_USER, role: 'MANAGER', permissions: [] }, PRODUCTS[k]);
  // the recompute just raised alert rows for products whose count CHANGED; the eleven were written below the line from the
  // start — clear their rows to reproduce the photo exactly (a product low since setup has never had an alert row)
  await q(`delete from inventory_alerts where tenant_id = $1`, [PILOT]);
  // one alert acknowledged earlier (the workflow row), one product on an open PO
  await q(`insert into inventory_alerts (tenant_id, branch_id, product_id, status, on_hand, created_at, acknowledged_at, acknowledged_by_user_id) values ($1,$2,$3,'low',2,$4,$5,$6)`, [PILOT, BRANCH, PRODUCTS.low9, ago(50), ago(30), MANAGER_USER]);
  await q(`insert into purchase_orders (id, tenant_id, branch_id, vendor_id, po_number, status, created_at) values ($1,$2,$3,$4,'PO-1042','ordered',$5)`, [id('c5950000', 1), PILOT, BRANCH, id('c3950000', 1), ago(72)]);
  await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost_cents) values ($3,$1,$2,6,0,450)`, [id('c5950000', 1), PRODUCTS.low0, PILOT]);
  // product uses through the REAL writer (one transaction, one movement each)
  const techCtx = (u) => ({ tenantId: PILOT, branchId: BRANCH, userId: u, role: 'TECHNICIAN', permissions: ['inventory.view_limited', 'inventory.product_usage.submit'] });
  const mgr = { tenantId: PILOT, branchId: BRANCH, userId: MANAGER_USER, role: 'MANAGER', permissions: ['inventory.view', 'inventory.stock.adjust', 'inventory.product_usage.submit'] };
  const uses = [];
  const use = async (ctx, body, key) => { const r = await inv.recordProductUsage(ctx, body, key); uses.push(r.event.id); return r.event.id; };
  await use(techCtx(TECH_USER), { productId: PRODUCTS.base, quantity: '0.5', occurredAt: ago(30) }, 'seed-u1');
  await use(mgr, { productId: PRODUCTS.base, quantity: '0.25', technicianId: TECH.bao, onBehalfReason: 'logged at close', occurredAt: ago(6) }, 'seed-u2');
  await use(techCtx(TECH2_USER), { productId: PRODUCTS.top, quantity: '1', occurredAt: ago(20) }, 'seed-u3');
  await use(mgr, { productId: PRODUCTS.top, quantity: '0.5', technicianId: TECH.chi, onBehalfReason: 'tech app offline', occurredAt: ago(3) }, 'seed-u4');
  await use(techCtx(TECH_USER), { productId: PRODUCTS.low2, quantity: '0.5', occurredAt: ago(2) }, 'seed-u5');
  await use(techCtx(TECH_USER), { productId: PRODUCTS.gloves, quantity: '2', occurredAt: ago(1) }, 'seed-u6');
  const wrong = await use(mgr, { productId: PRODUCTS.ok12, quantity: '1', technicianId: TECH.mai, onBehalfReason: 'entered on the wrong product', occurredAt: ago(0.5) }, 'seed-u7');
  await inv.adjustProductUsage(mgr, wrong, { delta: '-1', reason: 'wrong product — reversed' }, 'seed-a1');
  await use(mgr, { productId: PRODUCTS.ok12, quantity: '0.25', technicianId: TECH.bao, onBehalfReason: 'backfill', occurredAt: ago(26) }, 'seed-u8');   // backdated: recorded last, used earlier
  for (let i = 0; i < 9; i++) await use(mgr, { productId: PRODUCTS['ok' + (11 + (i % 6))], quantity: ['0.25', '0.5', '1'][i % 3], technicianId: [TECH.anna, TECH.bao, TECH.chi][i % 3], onBehalfReason: 'history', occurredAt: ago(24 * (2 + i)) }, 'seed-h' + i);
  // a Service-Done recipe deduction (service_usage on a ticket line) — attributed to that line's technician
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('c6950000', 1), PILOT, BRANCH]);
  const SV = { gel: id('c7950000', 1), pedi: id('c7950000', 2), art: id('c7950000', 3), acr: id('c7950000', 4) };
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$5,$6,$7,'Gel Manicure',45,3500), ($2,$5,$6,$7,'Spa Pedicure',50,4500), ($3,$5,$6,$7,'Nail Art',20,1000), ($4,$5,$6,$7,'Acrylic Full Set',75,6000)`, [SV.gel, SV.pedi, SV.art, SV.acr, PILOT, BRANCH, id('c6950000', 1)]);

  // ── tickets & payments ──
  let n = 0, tn = 4000; const TID = () => id('d0950000', ++n), PID = () => id('d1950000', ++n);
  const ticket = async (o) => {
    const tid = TID(); const num = o.number ?? String(++tn);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13::timestamptz - interval '30 minutes')`,
      [tid, o.tenant ?? PILOT, o.branch ?? BRANCH, o.customer ?? (o.tenant ? id('c0950000', 900) : pick(customers)), o.tech ?? null, o.status ?? 'paid', o.sub, o.disc ?? 0, o.sub - (o.disc ?? 0), o.tip ?? 0, num, o.status && o.status !== 'paid' ? null : o.at, o.at]);
    for (const [svc, name, cents, tech] of o.lines ?? []) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, technician_id, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$4,$5,$6,$7,45,$7,'completed')`, [o.tenant ?? PILOT, o.branch ?? BRANCH, tid, svc, name, tech ?? o.tech ?? null, cents]);
    return { tid, num };
  };
  const pay = async (tid, method, amount, tip, when, o = {}) => {
    const pidv = PID();
    await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor, processor_transaction_id, settlement_batch_id, card_brand, card_last4, gift_card_last4, payment_surface, created_at, approved_at, stranded_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$16)`,
      [pidv, o.tenant ?? PILOT, o.branch ?? BRANCH, tid, method, amount, tip, o.status ?? 'approved', method === 'card' ? 'cardpointe' : null, o.ref ?? (method === 'card' ? 'RR' + String(700000 + n) : null), o.settlement ?? null, method === 'card' ? 'VISA' : null, method === 'card' ? (o.last4 ?? '4242') : null, method === 'gift_card' ? 'G7K2' : null, method === 'card' ? (o.surface ?? 'cardpointe_terminal') : null, when, ['approved', 'partial'].includes(o.status ?? 'approved') ? when : null, o.stranded ? when : null]);
    return pidv;
  };
  const S = { pending: id('c8950000', 1), posted: id('c8950000', 2) };
  await q(`insert into payment_settlements (id, tenant_id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, status, expected_deposit_date, actual_deposit_date, funding_account_last4, created_at) values
    ($1,$3,$4,'cardpointe','BATCH-201',11643,350,11293,'pending',$5,null,'6789',$7), ($2,$3,$4,'cardpointe','BATCH-200',24000,720,23280,'posted',$6,$6,'6789',$8)`, [S.pending, S.posted, PILOT, BRANCH, addDays(today, 1), addDays(today, -6), ago(8), ago(24 * 7)]);
  const ids = {};
  // TODAY — the photo: three card tenders; the third is one tender of a split ticket that still owes $30.00
  const t1 = await ticket({ sub: 5916, tip: 400, at: at(today, 9, 17), tech: TECH.anna, customer: customers[0], lines: [[SV.gel, 'Gel Manicure', 3500], [SV.art, 'Nail Art', 2416]] });
  ids.p1 = await pay(t1.tid, 'card', 6316, 400, at(today, 9, 17), { ref: 'RR4001', settlement: S.pending });
  const t2 = await ticket({ sub: 4967, tip: 360, at: at(today, 11, 40), tech: TECH.bao, lines: [[SV.pedi, 'Spa Pedicure', 4967]] });
  ids.p2 = await pay(t2.tid, 'card', 5327, 360, at(today, 11, 40), { ref: 'RR4002', settlement: S.pending, surface: 'tap_to_pay_iphone' });
  const t3 = await ticket({ sub: 7972, tip: 200, status: 'ready_checkout', at: at(today, 13, 5), tech: TECH.chi, lines: [[SV.acr, 'Acrylic Full Set', 7972]] });
  await pay(t3.tid, 'card', 3000, 0, at(today, 13, 3), { status: 'declined' });
  ids.p3 = await pay(t3.tid, 'card', 5172, 200, at(today, 13, 5), { status: 'partial', ref: 'RR4003' });
  // the recipe deduction on today's first ticket line (Anna), so "Last Used By" for Base Coat reflects it
  const line1 = (await q(`select id from ticket_service_lines where ticket_id = $1 order by created_at limit 1`, [t1.tid])).rows[0].id;
  await q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_before, quantity_change, quantity_after, related_type, related_id, reason, created_at) values ($1,$2,$3,'service_usage',4,-1,3,'ticket_line',$4,'Service done · ticket',$5)`, [PILOT, BRANCH, PRODUCTS.top, line1, ago(0.2)]);
  // the month: ~45 paid tickets (cash / card / gift card), a split, refunds, a void, an unanswered attempt
  for (let d = 1; d <= 27; d++) {
    const day = addDays(today, -d); if (day < today.slice(0, 8) + '01' && d > 3) continue;
    for (let k = 0; k < 1 + (d % 3); k++) {
      const sub = 2500 + Math.floor(rnd() * 70) * 100 + Math.floor(rnd() * 99); const tip = rnd() < 0.6 ? 300 + Math.floor(rnd() * 12) * 50 : 0;
      const tech = pick([TECH.anna, TECH.bao, TECH.chi, TECH.mai]); const svc = pick([[SV.gel, 'Gel Manicure'], [SV.pedi, 'Spa Pedicure'], [SV.acr, 'Acrylic Full Set']]);
      const tk = await ticket({ sub, tip, at: at(day, 10 + k * 2, 15), tech, lines: [[svc[0], svc[1], sub]] });
      const m = rnd(); await pay(tk.tid, m < 0.55 ? 'card' : m < 0.9 ? 'cash' : 'gift_card', sub + tip, tip, at(day, 10 + k * 2, 15), { settlement: day < addDays(today, -6) ? S.posted : null });
    }
  }
  const sp = await ticket({ sub: 9000, tip: 1000, at: at(addDays(today, -2), 15), tech: TECH.anna, customer: customers[0], lines: [[SV.gel, 'Gel Manicure', 5000, TECH.anna], [SV.pedi, 'Spa Pedicure', 4000, TECH.bao]] });
  ids.spCard = await pay(sp.tid, 'card', 6000, 1000, at(addDays(today, -2), 15), { ref: 'RR4010' });
  ids.spCash = await pay(sp.tid, 'cash', 4000, 0, at(addDays(today, -2), 15, 2));
  await pay(sp.tid, 'card', 1500, 0, at(addDays(today, -2), 17), { status: 'refunded', ref: 'RF4010' });
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, reason, status, processor_refund_id, created_at, settled_at) values ($1,$2,$3,1500,'Polish chipped','refunded','RF4010',$4,$4), ($1,$2,$3,500,'Goodwill','reserved',null,$5,null)`, [PILOT, BRANCH, ids.spCard, at(addDays(today, -2), 17), at(addDays(today, -1), 10)]);
  const vt = await ticket({ sub: 4500, at: at(addDays(today, -3), 14), tech: TECH.mai, lines: [[SV.acr, 'Acrylic Full Set', 4500]] });
  ids.void = await pay(vt.tid, 'card', 4500, 0, at(addDays(today, -3), 14), { status: 'voided', ref: 'RR4020' });
  await pay(vt.tid, 'card', 0, 0, at(addDays(today, -3), 14, 5), { status: 'voided', ref: 'VD4020' });
  const ut = await ticket({ sub: 3500, status: 'ready_checkout', at: at(addDays(today, -1), 16), tech: TECH.bao, lines: [[SV.gel, 'Gel Manicure', 3500]] });
  await pay(ut.tid, 'card', 3500, 0, at(addDays(today, -1), 16), { status: 'pending', stranded: true });
  // invoices: one sent with $20 recorded ($60 outstanding), one paid
  await q(`insert into invoices (id, tenant_id, branch_id, customer_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, bill_to_name, bill_to_phone, bill_to_phone_digits, created_at) values ($1,$3,$4,$5,'INV-0042','partially_paid',8000,0,8000,'John Smith','(856) 555-1234','8565551234',$6), ($2,$3,$4,$5,'INV-0043','paid',5000,0,5000,'John Smith','(856) 555-1234','8565551234',$7)`, [id('c9950000', 1), id('c9950000', 2), PILOT, BRANCH, customers[0], ago(24 * 5), ago(24 * 9)]);
  await q(`insert into invoice_payments (tenant_id, invoice_id, amount_cents, paid_on, method, idempotency_key) values ($1,$2,2000,$4,'cash','seed-ip1'), ($1,$3,5000,$4,'card_external','seed-ip2')`, [PILOT, id('c9950000', 1), id('c9950000', 2), addDays(today, -4)]);
  await q(`insert into chargebacks (tenant_id, branch_id, payment_id, processor_type, amount_cents, status, opened_at) values ($1,$2,$3,'cardpointe',4500,'open',$4)`, [PILOT, BRANCH, ids.spCard, ago(20)]);
  // the other salon: a John Smith (same phone) paid today
  const ot = await ticket({ tenant: OTHER, branch: BRANCH_O, sub: 9999, at: at(today, 10), number: '4001' });
  await pay(ot.tid, 'card', 9999, 0, at(today, 10), { tenant: OTHER, branch: BRANCH_O, ref: 'RR4001X' });
  return { products: Object.keys(PRODUCTS).length, uses: uses.length, tickets: n, ids };
}
