// seed.mjs — Inventory · Products · Suppliers (+ Membership · Discounts) one-screen harness (Oct 29 2026). Seeds a TEST salon
// into a fresh database. Tooling only — never run against production; every figure is a fixture (no real customer, card,
// supplier or phone). Writes go through the REAL InventoryService where it has a writer (vendors, products, stock, purchase
// orders, receipts, transfers, counts, product uses), so movements / audits / alerts are what the product writes.
//   Products: the photo's eleven (Barbicide 16 oz, CND Shellac Romantique, CND SolarOil, DND Duo French Vanilla / Red Velvet,
//   Kiara Sky Nude Mood / Pure White, OPI Top Coat, OPI Alpine Snow / Big Apple Red / Bubble Bath — one bottle each, Critical)
//   plus 21 more so the catalog pages (12 per page → 3 pages); one product whose cached stock row says 11 on hand · 20 open ·
//   171 unopened while its bottle rows say 3 (the Inventory photo's mismatch); bottles expiring within 30 days and expired.
//   Suppliers: the photo's case — "Nail Supply Co" DEACTIVATED with one DRAFT purchase order still carrying its name; active
//   suppliers with several contacts (phones in mixed formats), product links with supplier SKUs, an approved order, a
//   partially received one (20 of 30), a received one, an order with NO supplier (legacy), an expected date in the past.
const hex = (n, w = 12) => n.toString(16).padStart(w, '0');
export const id = (kind, n) => `${kind}-0000-4000-8000-${hex(n)}`;
export const PILOT = id('f0970000', 1), EMPTY = id('f0970000', 2), OTHER = id('f0970000', 3);
export const BRANCH = id('b0970000', 1), BRANCH2 = id('b0970000', 2), BRANCH_E = id('b0970000', 3), BRANCH_O = id('b0970000', 4);
export const OWNER_USER = id('a0970000', 1), MANAGER_USER = id('a0970000', 2), DESK_USER = id('a0970000', 3), TECH_USER = id('a0970000', 4);
export const TECH = { anna: id('e0970000', 1), bao: id('e0970000', 2), chi: id('e0970000', 3) };
const TZ = 'America/New_York';
export const salonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const addDays = (ymd, d) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
export const PRODUCTS = {}; export const VENDORS = {}; export const POS = {};

export async function seed(pg, inv) {
  const q = (s, p = []) => pg.query(s, p);
  const today = salonToday(); const now = Date.now();
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot Nail Salon LLC','Pilot Nail Salon','pilot-cat','PCT001','active'), ($2,'New Salon LLC','New Salon','new-cat','NCT001','active'), ($3,'Other Salon LLC','Other Salon','other-cat','OCT001','active')`, [PILOT, EMPTY, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, city) values ($1,$2,'Cherry Hill','active',$8,'Cherry Hill'), ($3,$2,'Voorhees','active',$8,'Voorhees'), ($4,$5,'Main','active',$8,null), ($6,$7,'Elsewhere','active',$8,null)`, [BRANCH, PILOT, BRANCH2, BRANCH_E, EMPTY, BRANCH_O, OTHER, TZ]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$5,'owner@pilot.test','Pat Owner','OWNER','active'), ($2,$5,'manager@pilot.test','Mai Manager','MANAGER','active'), ($3,$5,'desk@pilot.test','Vy Front Desk','FRONT_DESK','active'), ($4,$5,'tech@pilot.test','Anna Lee','TECHNICIAN','active')`, [OWNER_USER, MANAGER_USER, DESK_USER, TECH_USER, PILOT]);
  for (const [k, f, l, u] of [['anna', 'Anna', 'Lee', TECH_USER], ['bao', 'Bao', 'Tran', null], ['chi', 'Chi', 'Pham', null]])
    await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,$4,$5,$6,$7,'active',true)`, [TECH[k], PILOT, BRANCH, u, f, l, `${f} ${l}`]);
  const mgr = { tenantId: PILOT, branchId: BRANCH, userId: MANAGER_USER, role: 'MANAGER', permissions: ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.product_usage.submit'] };

  // ── catalog ──
  const CAT = { polish: id('c1970000', 1), care: id('c1970000', 2), supply: id('c1970000', 3) };
  await q(`insert into inventory_categories (id, tenant_id, name, created_at) values ($1,$4,'Gel Polish',$5), ($2,$4,'Nail Care',$6), ($3,$4,'Salon Supplies',$7)`, [CAT.polish, CAT.care, CAT.supply, PILOT, ago(900), ago(800), ago(700)]);
  const BR = { opi: id('c2970000', 1), cnd: id('c2970000', 2), dnd: id('c2970000', 3), kiara: id('c2970000', 4), barbicide: id('c2970000', 5), lonely: id('c2970000', 6) };
  await q(`insert into inventory_brands (id, tenant_id, name, created_at) values ($1,$7,'OPI',$8), ($2,$7,'CND',$8), ($3,$7,'DND',$8), ($4,$7,'Kiara Sky',$8), ($5,$7,'Barbicide',$8), ($6,$7,'Gelish',$8)`, [BR.opi, BR.cnd, BR.dnd, BR.kiara, BR.barbicide, BR.lonely, PILOT, ago(900)]);
  // suppliers — through the real writer, then the photo's one deactivated
  const vend = async (key, body) => { const r = await inv.createVendor(mgr, { confirmDuplicate: true, ...body }); VENDORS[key] = r.id; return r.id; };
  await vend('old', { name: 'Nail Supply Co', phone: '(856) 555-1234', email: 'orders@nailsupply.test', contactName: 'Tina Ho' });
  await vend('glam', { name: 'Glam Distributors', tradeName: 'Glam', supplierCode: 'GLAM', phone: '609-555-0100', email: 'sales@glam.test', city: 'Camden', state: 'NJ', paymentTerms: 'Net 30', leadTimeDays: 5, preferred: true, minimumOrderCents: 15000, notes: 'Delivers Tuesdays and Fridays.' });
  await vend('pro', { name: 'Pro Nail Wholesale', phone: '+1 215 555 0142', email: 'help@pronail.test', paymentTerms: 'Due on receipt', leadTimeDays: 3 });
  await vend('beauty', { name: 'Beauty Source', phone: '(732) 555-0199' });
  for (let i = 1; i <= 9; i++) await vend('v' + i, { name: `Supplier ${String.fromCharCode(64 + i)} Trading`, phone: `(267) 555-01${String(10 + i)}` });
  // the PILOT supplier with the same phone at another salon (never shows)
  await q(`insert into inventory_vendors (tenant_id, name, phone) values ($1,'Other Salon Supply','(856) 555-1234')`, [OTHER]);
  await inv.saveVendorContact(mgr, VENDORS.glam, null, { name: 'Lan Pham', role: 'Sales rep', mobilePhone: '(609) 555-7788', email: 'lan@glam.test', preferredMethod: 'text', primary: true });
  await inv.saveVendorContact(mgr, VENDORS.glam, null, { name: 'Tom Lee', role: 'Accounts', officePhone: '609-555-9900', email: 'ar@glam.test', preferredMethod: 'email' });
  const old = await inv.saveVendorContact(mgr, VENDORS.glam, null, { name: 'Former Rep', role: 'Sales', mobilePhone: '609-555-0000' });
  await inv.deactivateVendorContact(mgr, VENDORS.glam, old.id);
  await inv.saveVendorContact(mgr, VENDORS.pro, null, { name: 'Diego Ruiz', role: 'Owner', mobilePhone: '+1 (215) 555-3344', primary: true });

  let pn = 0;
  const product = async (key, name, o) => {
    const { id: pid } = await inv.createProduct(mgr, { name, sku: o.sku, barcode: o.barcode ?? null, brandId: o.brand ?? null, categoryId: o.cat ?? CAT.polish, colorNumber: o.color ?? null, colorName: o.colorName ?? null,
      unitType: o.unit ?? 'bottle', trackingMode: 'bottle', costCents: o.cost ?? 450, retailPriceCents: o.retail ?? null, reorderLevel: o.reorder ?? 2, reorderQuantity: o.qty ?? 6, preferredVendorId: o.vendor ?? null, isRetail: o.retail != null, trackExpiration: !!o.expiry });
    PRODUCTS[key] = pid; pn++;
    await q(`update inventory_products set created_at = $2 where id = $1`, [pid, ago(24 * (60 - pn))]);
    if (o.bottles) await inv.addStock(mgr, pid, { quantity: o.bottles, lotNumber: o.lot ?? null, expirationDate: o.expiry ?? null });
    return pid;
  };
  // the Products photo: eleven products, one bottle each, Critical (reorder 3 → critical 2)
  const PHOTO = [
    ['barbicide', 'Barbicide Hospital Grade Disinfectant 16 oz', BR.barbicide, CAT.supply, 'BAR-16', 1499, null, null],
    ['romantique', 'CND Shellac Romantique', BR.cnd, CAT.polish, 'CND-ROM', 1650, 'Romantique', null],
    ['solaroil', 'CND SolarOil Cuticle Conditioner 0.5 oz', BR.cnd, CAT.care, 'CND-SOL', 1100, null, null],
    ['vanilla', 'DND Duo Gel & Lacquer French Vanilla', BR.dnd, CAT.polish, 'DND-438', 1500, 'French Vanilla', '438'],
    ['velvet', 'DND Duo Gel & Lacquer Red Velvet', BR.dnd, CAT.polish, 'DND-414', 1500, 'Red Velvet', '414'],
    ['nude', 'Kiara Sky Dip Powder Nude Mood', BR.kiara, CAT.polish, 'KS-D501', 1800, 'Nude Mood', 'D501'],
    ['white', 'Kiara Sky Dip Powder Pure White', BR.kiara, CAT.polish, 'KS-D401', 1800, 'Pure White', 'D401'],
    ['topcoat', 'OPI Diamond Gel High Shine Top Coat', BR.opi, CAT.polish, 'OPI-DG001', 2200, null, null],
    ['alpine', 'OPI Gel Color Alpine Snow', BR.opi, CAT.polish, 'OPI-GC-L00', 2000, 'Alpine Snow', 'L00'],
    ['bigapple', 'OPI Gel Color Big Apple Red', BR.opi, CAT.polish, 'OPI-GC-N25', 2000, 'Big Apple Red', 'N25'],
    ['bubble', 'OPI Gel Color Bubble Bath', BR.opi, CAT.polish, 'OPI-GC-S86', 2000, 'Bubble Bath', 'S86'],
  ];
  for (const [i, [key, name, brand, cat, sku, retail, colorName, color]] of PHOTO.entries())
    await product(key, name, { brand, cat, sku, barcode: '0619828' + String(100000 + i), retail, colorName, color, bottles: 1, reorder: 3, cost: Math.round(retail * 0.45), vendor: i % 2 ? VENDORS.glam : VENDORS.pro });
  // more catalog: healthy, low, out, expiring
  const MORE = ['Ballet Slipper', 'Cherry Bomb', 'Midnight Blue', 'Champagne', 'Coral Reef', 'Lilac Dream', 'Mocha', 'Ivory Lace', 'Sage', 'Sunset', 'Pearl', 'Plum', 'Mint', 'Gold Leaf'];
  for (const [i, c] of MORE.entries()) await product('m' + i, `Gelish ${c}`, { brand: BR.lonely, sku: `GEL-${500 + i}`, barcode: `0080${String(500 + i)}`, color: String(500 + i), colorName: c, bottles: i % 5 === 0 ? 0 : 4 + (i % 4), reorder: 2, cost: 600, retail: 1400, vendor: i % 3 ? VENDORS.glam : null });
  await product('gloves', 'Nitrile Gloves (pair)', { sku: 'SUP-GLV', cat: CAT.supply, unit: 'pair', bottles: 40, reorder: 10, cost: 12, vendor: VENDORS.pro });
  await product('primer', 'Bond Primer 0.5 oz', { sku: 'PRM-05', cat: CAT.care, bottles: 3, reorder: 1, cost: 700, expiry: addDays(today, 12), lot: 'L-2210' });
  await product('remover', 'Gel Remover Wraps', { sku: 'SUP-WRP', cat: CAT.supply, unit: 'pack', bottles: 2, reorder: 1, cost: 300 });
  await inv.addStock(mgr, PRODUCTS.primer, { quantity: 2, lotNumber: 'L-1901', expirationDate: addDays(today, -4) });   // already expired
  await product('cuticle', 'Cuticle Oil Pen', { sku: 'CO-PEN', cat: CAT.care, bottles: 5, reorder: 2, cost: 250, retail: 800, expiry: addDays(today, 25), lot: 'L-3001' });
  await product('drift', 'Drift Base Coat', { sku: 'DBC-01', brand: BR.opi, bottles: 3, reorder: 5, cost: 900 });
  // the Inventory photo's mismatch: the cached stock row says 11 on hand / 20 open / 171 unopened, the bottle rows say 3
  await q(`update inventory_location_stock set quantity_on_hand = 11, quantity_available = 11, quantity_open = 20, quantity_unopened = 171 where tenant_id = $1 and branch_id = $2 and product_id = $3`, [PILOT, BRANCH, PRODUCTS.drift]);
  // the second location has some stock (transfers)
  const ctx2 = { ...mgr, branchId: BRANCH2 };
  await inv.addStock(ctx2, PRODUCTS.m1, { quantity: 4 });
  // supplier ↔ product links
  await inv.linkVendorProduct(mgr, VENDORS.glam, { productId: PRODUCTS.m1, supplierSku: 'GL-CB-501', lastCostCents: 580, purchaseUnit: 'case', unitsPerPurchaseUnit: 6, minimumOrderQty: 1, leadTimeDays: 5, preferred: true });
  await inv.linkVendorProduct(mgr, VENDORS.glam, { productId: PRODUCTS.velvet, supplierSku: 'GL-DND-414', lastCostCents: 640, purchaseUnit: 'box', unitsPerPurchaseUnit: 3 });
  await inv.linkVendorProduct(mgr, VENDORS.pro, { productId: PRODUCTS.gloves, supplierSku: 'PN-GLV-M', lastCostCents: 11, purchaseUnit: 'box', unitsPerPurchaseUnit: 100 });

  // ── purchase orders through the real writer ──
  const po = async (key, vendorId, lines, o = {}) => { const r = await inv.createPurchaseOrder(mgr, { vendorId, expectedDate: o.expected ?? null, notes: o.notes ?? null, lines, shippingCents: o.ship ?? 0, taxCents: o.tax ?? 0 }); POS[key] = r.id; await q(`update purchase_orders set created_at = $2 where id = $1`, [r.id, ago(o.hoursAgo ?? 24)]); return r.id; };
  // the photo: ONE draft for the (now deactivated) Nail Supply Co, expected date set
  await po('draft', VENDORS.old, [{ productId: PRODUCTS.vanilla, quantityOrdered: 6, unitCostCents: 675 }, { productId: PRODUCTS.velvet, quantityOrdered: 6, unitCostCents: 675 }], { expected: addDays(today, 7), hoursAgo: 30 });
  await inv.archiveVendor(mgr, VENDORS.old);
  await po('approved', VENDORS.glam, [{ productId: PRODUCTS.romantique, quantityOrdered: 4, unitCostCents: 742 }, { productId: PRODUCTS.alpine, quantityOrdered: 6, unitCostCents: 900 }], { expected: addDays(today, -2), hoursAgo: 120, ship: 1200 });
  await inv.approvePurchaseOrder(mgr, POS.approved);
  await po('partial', VENDORS.pro, [{ productId: PRODUCTS.gloves, quantityOrdered: 30, unitCostCents: 12 }], { expected: addDays(today, 2), hoursAgo: 96 });
  await inv.approvePurchaseOrder(mgr, POS.partial);
  const pl = (await q(`select id from purchase_order_lines where purchase_order_id = $1`, [POS.partial])).rows[0].id;
  await inv.receivePurchaseOrder(mgr, POS.partial, { lines: [{ lineId: pl, quantity: 20 }] });
  await po('received', VENDORS.glam, [{ productId: PRODUCTS.m2, quantityOrdered: 4, unitCostCents: 600 }], { expected: addDays(today, -10), hoursAgo: 300 });
  await inv.approvePurchaseOrder(mgr, POS.received);
  const rl = (await q(`select id from purchase_order_lines where purchase_order_id = $1`, [POS.received])).rows[0].id;
  await inv.receivePurchaseOrder(mgr, POS.received, { lines: [{ lineId: rl, quantity: 4 }] });
  await po('legacy', null, [{ productId: PRODUCTS.barbicide, quantityOrdered: 2, unitCostCents: 650 }], { notes: 'Ordered by phone — supplier: "Salon Depot" (legacy, no record)', hoursAgo: 500 });
  for (let i = 0; i < 9; i++) await po('h' + i, VENDORS['v' + (1 + i)], [{ productId: PRODUCTS['m' + i], quantityOrdered: 2 + i, unitCostCents: 500 }], { hoursAgo: 600 + i * 24 });

  // ── transfers, counts, technician reports, product uses, recipes ──
  await inv.createTransfer(mgr, { toBranchId: BRANCH2, notes: 'Voorhees ran out', lines: [{ productId: PRODUCTS.m3, quantity: 1 }] });
  const cnt = await inv.createCount(mgr, { scopeType: 'brand', scopeId: BR.dnd, notes: 'Monthly DND count' });
  void cnt;
  await q(`insert into inventory_technician_reports (tenant_id, branch_id, product_id, technician_user_id, report_type, note, status, created_at) values ($1,$2,$3,$4,'empty','Bottle finished during a set','pending',$5), ($1,$2,$6,$4,'damaged','Cap cracked','pending',$7)`, [PILOT, BRANCH, PRODUCTS.topcoat, TECH_USER, ago(3), PRODUCTS.cuticle, ago(28)]);
  const use = (body, key) => inv.recordProductUsage(mgr, { onBehalfReason: 'logged at close', ...body }, key);
  await use({ productId: PRODUCTS.m4, quantity: '0.5', technicianId: TECH.anna, occurredAt: ago(30) }, 'cat-u1');
  await use({ productId: PRODUCTS.m4, quantity: '0.25', technicianId: TECH.bao, occurredAt: ago(5) }, 'cat-u2');
  await use({ productId: PRODUCTS.gloves, quantity: '2', technicianId: TECH.chi, occurredAt: ago(2) }, 'cat-u3');
  await use({ productId: PRODUCTS.cuticle, quantity: '1', technicianId: TECH.anna, occurredAt: ago(50) }, 'cat-u4');
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('c6970000', 1), PILOT, BRANCH]);
  const SV = { gel: id('c7970000', 1), pedi: id('c7970000', 2), art: id('c7970000', 3) };
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$4,$5,$6,'Gel Manicure',45,3500,'active'), ($2,$4,$5,$6,'Spa Pedicure',50,4500,'active'), ($3,$4,$5,$6,'Nail Art',20,1000,'active')`, [SV.gel, SV.pedi, SV.art, PILOT, BRANCH, id('c6970000', 1)]);
  await inv.setServiceRecipe(mgr, SV.gel, { lines: [{ productId: PRODUCTS.topcoat, quantity: 1 }, { productId: PRODUCTS.gloves, quantity: 2 }] });
  // the other salon's look-alike product (never shows)
  await q(`insert into inventory_products (tenant_id, name, sku, active) values ($1,'OPI Gel Color Bubble Bath','OPI-GC-S86',true)`, [OTHER]);
  return { products: Object.keys(PRODUCTS).length, vendors: Object.keys(VENDORS).length, pos: Object.keys(POS).length };
}
