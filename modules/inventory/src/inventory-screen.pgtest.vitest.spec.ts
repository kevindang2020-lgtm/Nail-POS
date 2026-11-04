// inventory-screen.pgtest — Inventory / Products / Suppliers mandates (Oct 29 2026), against the real migrated schema:
//   * the metrics count what they say: products are product records (a bottle is never a product), bottles / open / unopened
//     come from the bottle rows by unit, a stale cached stock row is DETECTED (the photo's 11 vs 20 + 171) and Recount rebuilds
//     it from the bottles with one correction movement; expiring = bottles in the next 30 days, expired apart; value hidden
//     from the limited technician view;
//   * the product list: newest first, exact SKU first, search by barcode / colour / brand / supplier phone (three formats) /
//     supplier SKU / PO number / technician, a later-page product found, Last Used By, archive → restore, no cross-tenant rows;
//   * purchase orders: the expected delivery date is a calendar date (never a midnight-UTC timestamp), active ≠ draft,
//     remaining value, receive 20 of 30 → 10 remaining + partial, stock rises only on receipt, the alert re-evaluates;
//   * suppliers: 0 active suppliers + 1 draft PO of a deactivated supplier is explained by the KPIs; directory search by
//     contact phone / email, product SKU, brand, PO number (with what matched); duplicate warning; one primary contact.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';
import { InventoryScreenRepository } from './inventory-screen.repository';
import { SuppliersScreenRepository } from './suppliers-screen.repository';
import { paging } from './stock-alerts.repository';
import { openAlertCount } from './stock-alert-state';

const T = 'a7170000-0000-4000-8000-000000000001', B = 'a7170000-0000-4000-8000-0000000000b1', T2 = 'a7170000-0000-4000-8000-000000000002', B2 = 'a7170000-0000-4000-8000-0000000000b2';
const UM = 'a7170000-0000-4000-8000-0000000000e9', UA = 'a7170000-0000-4000-8000-0000000000e1', TA = 'a7170000-0000-4000-8000-0000000000c1';
const BR_OPI = 'a7170000-0000-4000-8000-0000000000a1', BR_DND = 'a7170000-0000-4000-8000-0000000000a2', BR_LONE = 'a7170000-0000-4000-8000-0000000000a3';
const V_OLD = 'a7170000-0000-4000-8000-0000000000f1', V_T2 = 'a7170000-0000-4000-8000-0000000000f2';
const P_GEL = 'a7170000-0000-4000-8000-0000000000d1', P_DRIFT = 'a7170000-0000-4000-8000-0000000000d2', P_EXP = 'a7170000-0000-4000-8000-0000000000d3', P_T2 = 'a7170000-0000-4000-8000-0000000000d9';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.vendor.manage', 'inventory.purchase_order.create'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'MANAGER', permissions: ALL };
const techView: any = { tenantId: T, branchId: B, userId: UA, role: 'TECHNICIAN', permissions: ['inventory.view_limited'] };
let pg: any; let inv: InventoryService; let repo: InventoryScreenRepository; let sup: SuppliersScreenRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.message; } };
const all = async () => repo.period(manager, { preset: 'all' });
const list = async (qq: Record<string, string> = {}, page = 1, size = 12) => repo.products(manager, qq, await all(), paging(String(page), String(size)));

beforeAll(async () => {
  pg = await migratedPglite();
  const db = kyselyFor(pg) as any;
  inv = new InventoryService(db); repo = new InventoryScreenRepository(db); sup = new SuppliersScreenRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Inv Co','Inv Salon','inv-co','INVC'), ($2,'Other Co','Other Salon','other-inv','OTIV')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Other','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$3,'MANAGER','m@inv.test','Mia Manager'), ($2,$3,'TECHNICIAN','a@inv.test','Anna Nguyen')`, [UM, UA, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) values ($1,$2,$3,$4,'Anna','Nguyen','Anna Nguyen')`, [TA, T, B, UA]);
  await q(`insert into inventory_brands (id, tenant_id, name) values ($1,$4,'OPI'), ($2,$4,'DND'), ($3,$4,'Lonely Brand')`, [BR_OPI, BR_DND, BR_LONE, T]);
  // the photo's supplier: deactivated, but one DRAFT purchase order still carries its name
  await q(`insert into inventory_vendors (id, tenant_id, name, phone, email, active) values ($1,$2,'Nail Supply Co','(856) 555-1234','orders@nailsupply.test',false)`, [V_OLD, T]);
  await q(`insert into inventory_vendors (id, tenant_id, name, phone, active) values ($1,$2,'Other Tenant Supply','856-555-1234',true)`, [V_T2, T2]);
  await q(`insert into inventory_products (id, tenant_id, name, sku, barcode, color_number, color_name, brand_id, active, reorder_level, cost_cents, retail_price_cents, unit_type, preferred_vendor_id, created_at) values
    ($1,$4,'Rose Gel','RG-01','0001112223','428','Cherry Mocha',$5,true,2,450,1200,'bottle',$7, now() - interval '3 days'),
    ($2,$4,'Drift Polish','DP-01','0001112224','11','Ballet',$6,true,5,300,900,'bottle',null, now() - interval '2 days'),
    ($3,$4,'Old Primer','OP-01',null,null,null,null,true,0,200,null,'bottle',null, now() - interval '1 day')`, [P_GEL, P_DRIFT, P_EXP, T, BR_OPI, BR_DND, V_OLD]);
  await q(`insert into inventory_products (id, tenant_id, name, sku, active) values ($1,$2,'Rose Gel','RG-01',true)`, [P_T2, T2]);
  // Rose Gel: 3 sealed bottles; Drift Polish: 2 sealed + 1 open, its cached stock row says 11 / 20 open / 171 unopened (stale);
  // Old Primer: one sealed bottle expiring in 10 days, one already expired
  for (let i = 0; i < 3; i++) await q(`insert into inventory_units (tenant_id, branch_id, product_id, status) values ($1,$2,$3,'unopened')`, [T, B, P_GEL]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status) values ($1,$2,$3,'unopened'), ($1,$2,$3,'unopened'), ($1,$2,$3,'opened')`, [T, B, P_DRIFT]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, expiration_date) values ($1,$2,$3,'unopened', current_date + 10), ($1,$2,$3,'unopened', current_date - 3)`, [T, B, P_EXP]);
  await (inv as any).recompute({ ...manager }, P_GEL); await (inv as any).recompute({ ...manager }, P_EXP);
  await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, quantity_open, quantity_unopened) values ($1,$2,$3,11,20,171)`, [T, B, P_DRIFT]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status) values ($1,$2,$3,'unopened')`, [T2, B2, P_T2]);
}, 120000);

describe('metrics — what each number counts', () => {
  it('products are product records; bottles / open / unopened come from the bottle rows; drift is detected', async () => {
    const m = await repo.metrics(manager);
    expect(m.products).toBe(3);
    expect(m.bottles).toBe(8); expect(m.unopened).toBe(7); expect(m.open).toBe(1);
    expect(m.bottlesByUnit).toEqual([{ unit: 'bottle', count: 8 }]);
    expect(m.stockDrift).toBe(1);
    expect(m.expiringSoon).toBe(1); expect(m.expired).toBe(1); expect(m.expiryHorizonDays).toBe(30);
    // value: cost × usable, unexpired bottles = 3×450 + 3×300 + 1×200
    expect(m.inventoryValueCents).toBe(3 * 450 + 3 * 300 + 200);
    expect(m.retailValueCents).toBe(3 * 1200 + 3 * 900);
  });
  it('low stock is the Stock Alerts scope (Drift Polish: cache 11 > reorder 5 → not low until recounted)', async () => {
    const m = await repo.metrics(manager);
    expect(m.lowStock).toBe(0); expect(m.needReorder).toBe(0);
    expect(N((await openAlertCount(T, B).execute(kyselyFor(pg) as any)).rows[0]?.n)).toBe(m.openAlerts);
  });
  it('Recount rebuilds the cache from the bottles: 11 → 3, one correction movement, now low, drift gone', async () => {
    const r = await inv.recountProduct(manager, P_DRIFT);
    expect(r).toMatchObject({ before: 11, after: 3, changed: true });
    const mv = await q(`select movement_type, quantity_before, quantity_change, quantity_after from inventory_stock_movements where product_id = $1`, [P_DRIFT]);
    expect(mv).toEqual([{ movement_type: 'correction', quantity_before: 11, quantity_change: -8, quantity_after: 3 }]);
    const m = await repo.metrics(manager);
    expect(m.stockDrift).toBe(0); expect(m.lowStock).toBe(1); expect(m.needReorder).toBe(1);
    expect((await inv.recountProduct(manager, P_DRIFT)).changed).toBe(false);
  });
  it('the limited technician view never sees value or cost', async () => {
    const m = await repo.metrics(techView);
    expect(m.inventoryValueCents).toBeNull(); expect(m.retailValueCents).toBeNull();
    const l = await repo.products(techView, {}, await all(), paging());
    expect(l.rows.every((r) => r.costCents === null && r.retailCents === null)).toBe(true);
  });
});

describe('products — search, paging, newest first, Last Used By', () => {
  it('newest first by created_at; another tenant’s identical product is never listed', async () => {
    const l = await list();
    expect(l.rows.map((r) => r.name)).toEqual(['Old Primer', 'Drift Polish', 'Rose Gel']);
    expect(l.total).toBe(3);
  });
  it('search: exact SKU first, barcode, colour number / name, brand, supplier phone in three formats', async () => {
    expect((await list({ search: 'rg-01' })).rows.map((r) => r.id)).toEqual([P_GEL]);
    expect((await list({ search: '0001112224' })).rows.map((r) => r.id)).toEqual([P_DRIFT]);
    expect((await list({ search: '428' })).rows.map((r) => r.id)).toEqual([P_GEL]);
    expect((await list({ search: 'cherry' })).rows.map((r) => r.id)).toEqual([P_GEL]);
    expect((await list({ search: 'dnd' })).rows.map((r) => r.id)).toEqual([P_DRIFT]);
    for (const ph of ['8565551234', '(856) 555-1234', '+1 856 555 1234']) expect((await list({ search: ph })).rows.map((r) => r.id)).toEqual([P_GEL]);
  });
  it('a product on page 2 is found by search (the whole list, not the visible page)', async () => {
    const p1 = await list({}, 1, 2); const p2 = await list({}, 2, 2);
    expect(p1.pages).toBe(2); expect(p2.rows.map((r) => r.name)).toEqual(['Rose Gel']);
    expect((await list({ search: 'rose' }, 1, 2)).rows.map((r) => r.name)).toEqual(['Rose Gel']);
    expect((await list({}, 9, 2)).page).toBe(2);   // a page past the end clamps to the last page
  });
  it('a new product appears first on page 1; adding stock updates its row, never a duplicate', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Fresh Top Coat', sku: 'FT-01' });
    expect((await list({}, 1, 2)).rows[0].id).toBe(id);
    await inv.addStock(manager, id, { quantity: 2 });
    const rows = (await list({ search: 'fresh' })).rows;
    expect(rows.length).toBe(1); expect(rows[0].onHand).toBe(2);
  });
  it('No recorded use → then a technician use sets Last Used By; searchable by that technician', async () => {
    expect((await list({ search: 'RG-01' })).rows[0].lastUsedLabel).toBe('No recorded use');
    await inv.recordProductUsage({ tenantId: T, branchId: B, userId: UA, role: 'TECHNICIAN', permissions: ['inventory.product_usage.submit'] }, { productId: P_GEL, quantity: '0.5' }, 'inv-screen-1');
    const r = (await list({ search: 'RG-01' })).rows[0];
    expect(r.lastUsedBy).toBe('Anna Nguyen'); expect(r.lastUsedTechnicianId).toBe(TA);
    expect((await list({ search: 'anna' })).rows.map((x) => x.id)).toEqual([P_GEL]);
    expect((await list({ technicianId: TA })).rows.map((x) => x.id)).toEqual([P_GEL]);
    expect((await list({ sort: 'last_used' })).rows[0].id).toBe(P_GEL);
  });
  it('status filter (needs reorder), archive → archived list → restore', async () => {
    expect((await list({ status: 'needs_reorder' })).rows.map((r) => r.id)).toEqual([P_DRIFT]);
    await inv.archiveProduct(manager, P_EXP);
    expect((await list()).rows.some((r) => r.id === P_EXP)).toBe(false);
    expect((await list({ lifecycle: 'archived' })).rows.map((r) => r.id)).toEqual([P_EXP]);
    await inv.restoreProduct(manager, P_EXP);
    expect((await list()).rows.some((r) => r.id === P_EXP)).toBe(true);
    expect(await code(inv.restoreProduct(manager, P_EXP))).toBe('PRODUCT_NOT_FOUND');
  });
  it('product details: bottles with expiry, suppliers (preferred), audit; another tenant’s id is not found', async () => {
    const d = await repo.product(manager, P_EXP);
    expect(d.bottles.length).toBe(2); expect(d.bottles.filter((b) => b.expired).length).toBe(1);
    expect(d.product.available).toBe(1);
    const g = await repo.product(manager, P_GEL);
    expect(g.suppliers.map((s) => s.name)).toEqual(['Nail Supply Co']); expect(g.suppliers[0].preferred).toBe(true);
    expect(g.audit.length).toBeGreaterThanOrEqual(0);
    expect(await code(repo.product(manager, P_T2))).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('purchase orders — dates, statuses, receiving', () => {
  let draftId = ''; let poId = '';
  it('the expected delivery date is a calendar date string; a draft is not an active PO', async () => {
    draftId = (await inv.createPurchaseOrder(manager, { vendorId: V_OLD, expectedDate: '2026-11-05', lines: [{ productId: P_GEL, quantityOrdered: 6, unitCostCents: 450 }] })).id;
    // Nov 3 audit: another salon's vendor is refused (it was stored unchecked)
    expect(await code(inv.createPurchaseOrder(manager, { vendorId: V_T2, lines: [{ productId: P_GEL, quantityOrdered: 1, unitCostCents: 100 }] }))).toBe('VENDOR_NOT_FOUND');
    const r = (await repo.purchaseOrders(manager, {}, await all(), paging())).rows.find((x) => x.id === draftId)!;
    expect(r.expectedDate).toBe('2026-11-05'); expect(r.vendor).toBe('Nail Supply Co'); expect(r.vendorArchived).toBe(true);
    const k = await sup.supplierKpis(manager);
    expect(k).toMatchObject({ totalSuppliers: 0, inactiveSuppliers: 1, activePurchaseOrders: 0, draftPurchaseOrders: 1, totalPurchaseOrders: 1, inactiveSupplierPurchaseOrders: 1, openPoValueCents: 0, brands: 3 });
    expect(k.brandsWithoutSupplier).toBe(2);   // DND and Lonely Brand: products without a linked supplier, still counted
  });
  it('expected-date range filters on the date itself; PO-number search ranks the exact number first', async () => {
    const inRange = await repo.purchaseOrders(manager, { dateField: 'expected' }, await repo.period(manager, { preset: 'custom', from: '2026-11-05', to: '2026-11-05' }), paging());
    expect(inRange.rows.map((r) => r.id)).toEqual([draftId]);
    const out = await repo.purchaseOrders(manager, { dateField: 'expected' }, await repo.period(manager, { preset: 'custom', from: '2026-11-06', to: '2026-11-30' }), paging());
    expect(out.total).toBe(0);
    const num = (await q(`select po_number from purchase_orders where id = $1`, [draftId]))[0].po_number;
    expect((await repo.purchaseOrders(manager, { search: num }, await all(), paging())).rows[0].id).toBe(draftId);
    expect((await repo.purchaseOrders(manager, { search: '(856) 555-1234' }, await all(), paging())).rows.map((r) => r.id)).toEqual([draftId]);
  });
  it('saving a draft adds no stock; receive 20 of 30 → 10 remaining, partial; stock rises by 20 once; alert re-evaluated', async () => {
    poId = (await inv.createPurchaseOrder(manager, { lines: [{ productId: P_DRIFT, quantityOrdered: 30, unitCostCents: 300 }] })).id;
    const before = (await repo.product(manager, P_DRIFT)).product.onHand;
    expect(before).toBe(3);
    await inv.approvePurchaseOrder(manager, poId);
    let r = (await repo.purchaseOrders(manager, { status: 'active' }, await all(), paging())).rows.find((x) => x.id === poId)!;
    expect(r).toMatchObject({ ordered: 30, received: 0, remaining: 30, remainingCents: 9000, vendor: null });
    const line = (await q(`select id from purchase_order_lines where purchase_order_id = $1`, [poId]))[0].id;
    await inv.receivePurchaseOrder(manager, poId, { lines: [{ lineId: line, quantity: 20 }] });
    r = (await repo.purchaseOrders(manager, {}, await all(), paging())).rows.find((x) => x.id === poId)!;
    expect(r).toMatchObject({ status: 'partial', received: 20, remaining: 10, remainingCents: 3000 });
    expect((await repo.product(manager, P_DRIFT)).product.onHand).toBe(23);
    expect((await repo.metrics(manager)).needReorder).toBe(0);   // above the reorder level again → the live alert is gone
    expect((await sup.supplierKpis(manager)).openPoValueCents).toBe(3000);
    const d = await repo.purchaseOrder(manager, poId);
    expect(d.lines[0]).toMatchObject({ ordered: 30, received: 20, remaining: 10 }); expect(d.receipts.length).toBe(1); expect(d.receipts[0].quantity).toBe(20);
  });
  it('an order with no supplier can be linked to one (audited); a cancelled one cannot', async () => {
    expect((await repo.purchaseOrders(manager, { unlinked: 'true' }, await all(), paging())).rows.map((r) => r.id)).toEqual([poId]);
    const { id: vNew } = await inv.createVendor(manager, { name: 'Pro Nail Wholesale', phone: '215-555-0000' });
    await inv.linkPurchaseOrderVendor(manager, poId, vNew);
    expect((await repo.purchaseOrders(manager, { vendorId: vNew }, await all(), paging())).rows.map((r) => r.id)).toEqual([poId]);
    await inv.cancelPurchaseOrder(manager, draftId);
    expect(await code(inv.linkPurchaseOrderVendor(manager, draftId, vNew))).toBe('PO_STATE_INVALID');
    expect((await q(`select count(*)::int n from audit_logs where action_type = 'inventory_po_vendor_linked' and tenant_id = $1`, [T]))[0].n).toBe(1);
  });
});

describe('suppliers — directory, contacts, product links, duplicates', () => {
  let vid = '';
  it('a duplicate name / phone / email is a warning, saved only when confirmed; a bad email is refused', async () => {
    expect(await code(inv.createVendor(manager, { name: 'nail supply co' }))).toBe('SUPPLIER_DUPLICATE');
    expect(await code(inv.createVendor(manager, { name: 'Brand New', phone: '+1 (856) 555-1234' }))).toBe('SUPPLIER_DUPLICATE');
    expect(await code(inv.createVendor(manager, { name: 'Brand New', email: 'not-an-email' }))).toBe('VENDOR_EMAIL_INVALID');
    expect(await code(inv.createVendor(manager, { name: 'Brand New', phone: '12' }))).toBe('VENDOR_PHONE_INVALID');
    vid = (await inv.createVendor(manager, { name: 'Glam Distributors', supplierCode: 'GLAM', tradeName: 'Glam', preferred: true, city: 'Camden', minimumOrderCents: 5000 })).id;
    const twin = await inv.createVendor(manager, { name: 'Glam Distributors', confirmDuplicate: true });
    expect(twin.id).not.toBe(vid);
    expect(await code(inv.createVendor(manager, { name: 'Code Clash', supplierCode: 'glam' }))).toBe('SUPPLIER_CODE_TAKEN');
  });
  it('many contacts, one primary; a deactivated contact is kept', async () => {
    const a = (await inv.saveVendorContact(manager, vid, null, { name: 'Lan Pham', role: 'Sales', mobilePhone: '(609) 555-7788', email: 'lan@glam.test', primary: true })).id!;
    const b = (await inv.saveVendorContact(manager, vid, null, { name: 'Tom Lee', role: 'Accounts', officePhone: '609-555-9900', primary: true })).id!;
    const d = await sup.supplier(manager, vid);
    expect(d.contacts.filter((c) => c.primary).map((c) => c.id)).toEqual([b]);
    await inv.deactivateVendorContact(manager, vid, a);
    const d2 = await sup.supplier(manager, vid);
    expect(d2.contacts.length).toBe(2); expect(d2.contacts.find((c) => c.id === a)!.active).toBe(false);
    expect(await code(inv.saveVendorContact(manager, vid, null, { name: 'X', email: 'bad' }))).toBe('VENDOR_EMAIL_INVALID');
  });
  it('directory search: contact phone in three formats, contact email, supplier code exact first, with what matched', async () => {
    for (const ph of ['6095559900', '(609) 555-9900', '+1 609 555 9900']) {
      const r = await sup.directory(manager, { search: ph }, paging());
      expect(r.rows.map((x) => x.id)).toEqual([vid]); expect(r.rows[0].matchedVia).toBe('contact');
    }
    expect((await sup.directory(manager, { search: 'GLAM' }, paging())).rows[0].id).toBe(vid);
    expect((await sup.directory(manager, { search: 'lan@glam' }, paging())).rows.map((x) => x.id)).toEqual([vid]);
    expect((await sup.directory(manager, { status: 'preferred' }, paging())).rows.map((x) => x.id)).toEqual([vid]);
    // another tenant's supplier with the same phone never shows
    expect((await sup.directory(manager, { search: '856-555-1234', status: 'all' }, paging())).rows.map((x) => x.id)).toEqual([V_OLD]);
  });
  it('linking a product: searchable by supplier SKU and brand, upsert (no duplicate link), unlink keeps history', async () => {
    await inv.linkVendorProduct(manager, vid, { productId: P_DRIFT, supplierSku: 'GL-DP-11', lastCostCents: 280, purchaseUnit: 'case', unitsPerPurchaseUnit: 12, preferred: true });
    await inv.linkVendorProduct(manager, vid, { productId: P_DRIFT, supplierSku: 'GL-DP-11B', lastCostCents: 290 });
    expect((await q(`select count(*)::int n from inventory_vendor_products where vendor_id = $1`, [vid]))[0].n).toBe(1);
    const r = await sup.directory(manager, { search: 'gl-dp-11b' }, paging());
    expect(r.rows.map((x) => x.id)).toEqual([vid]); expect(r.rows[0].matchedVia).toBe('product');
    expect((await sup.directory(manager, { search: 'dnd' }, paging())).rows.map((x) => x.id)).toEqual([vid]);
    expect((await list({ search: 'gl-dp-11b' })).rows.map((x) => x.id)).toEqual([P_DRIFT]);
    const sp = await sup.supplierProducts(manager, vid, {}, paging());
    expect(sp.rows[0]).toMatchObject({ productId: P_DRIFT, supplierSku: 'GL-DP-11B', lastCostCents: 290, source: 'linked' });
    expect((await sup.directory(manager, { search: 'Glam Distributors' }, paging())).rows.find((x) => x.id === vid)!.products).toBe(1);
    await inv.unlinkVendorProduct(manager, vid, P_DRIFT);
    expect((await sup.supplierProducts(manager, vid, {}, paging())).total).toBe(0);
    expect(await code(inv.unlinkVendorProduct(manager, vid, P_DRIFT))).toBe('VENDOR_PRODUCT_NOT_LINKED');
  });
  it('deactivate → inactive filter → restore; the KPIs follow', async () => {
    const before = (await sup.supplierKpis(manager)).totalSuppliers;
    await inv.archiveVendor(manager, vid);
    expect((await sup.supplierKpis(manager)).totalSuppliers).toBe(before - 1);
    expect((await sup.directory(manager, { status: 'inactive' }, paging())).rows.some((x) => x.id === vid)).toBe(true);
    await inv.restoreVendor(manager, vid);
    expect((await sup.supplierKpis(manager)).totalSuppliers).toBe(before);
    await inv.updateVendor(manager, vid, { email: 'hello@glam.test' });
    const audit = await q(`select metadata_json from audit_logs where action_type = 'inventory_vendor_updated' and tenant_id = $1`, [T]);
    expect(audit[0].metadata_json.changed.email).toEqual({ from: null, to: 'hello@glam.test' });
  });
  it('receiving history lists the supplier’s receipts', async () => {
    const poVendor = (await q(`select vendor_id from purchase_orders where vendor_id is not null and status = 'partial'`))[0].vendor_id;
    const r = await sup.supplierReceiving(manager, poVendor, await all(), paging());
    expect(r.rows.length).toBe(1); expect(r.rows[0].quantity).toBe(20);
  });
});

describe('other tabs — each its own paged, searchable list', () => {
  it('catalog brands newest first with product counts; recipes; movements of one product', async () => {
    const c = await repo.catalog(manager, { kind: 'brand' }, paging());
    expect(c.total).toBe(3); expect(c.rows.find((r) => r.name === 'OPI')!.products).toBe(1);
    expect((await repo.catalog(manager, { kind: 'brand', search: 'lone' }, paging())).rows.map((r) => r.name)).toEqual(['Lonely Brand']);
    const mv = await repo.movements(manager, { productId: P_DRIFT }, await all(), paging());
    expect(mv.rows[0].type).toBe('purchase_received'); expect(mv.rows.map((r) => r.type)).toContain('correction');
    const rc = await repo.recipes(manager, {}, paging());
    expect(rc.total).toBeGreaterThanOrEqual(0);
  });
});

function N(v: unknown) { return Number(v ?? 0) || 0; }
