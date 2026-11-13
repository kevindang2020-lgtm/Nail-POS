// inventory-product-duplicates.pgtest — Extras Products Management 07 (round 10): the duplicate product warning. The read-
// only GET names the live products a new / edited product may duplicate and why — exact and near SKU, barcode / UPC, a
// supplier SKU another product is already linked under, the same name + size — never an archived product, never another
// salon's, never the product being edited; nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const P = 'a74d0000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), B = id(3), BX = id(4), U = id(5);
const mgr: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.update'] };
const other: any = { tenantId: X, branchId: BX, userId: U, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.update'] };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
let gel = '', gelX = '', archived = '', top = '';

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'D','Dup','dup-74d','DUP74D'), ($2,'X','Other','dup-74dx','DUP74DX')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Other','America/New_York')`, [B, T, BX, X]);
  gel = (await inv.createProduct(mgr, { name: 'OPI Gel  Base', sku: 'OPI-GB-15', barcode: '0001112223334', sizeValue: 15, sizeUnit: 'ml' })).id;
  top = (await inv.createProduct(mgr, { name: 'Top Coat', sku: 'TC-1' })).id;
  archived = (await inv.createProduct(mgr, { name: 'Old Gel', sku: 'OLD-1', barcode: '999' })).id;
  await q(`update inventory_products set archived_at = now() where id = $1`, [archived]);
  gelX = (await inv.createProduct(other, { name: 'OPI Gel Base', sku: 'OPI-GB-15', barcode: '0001112223334' })).id;
  const [v] = await q(`insert into inventory_vendors (tenant_id, name) values ($1, 'Nail Supply Co') returning id`, [T]);
  await q(`insert into inventory_vendor_products (tenant_id, vendor_id, product_id, supplier_sku) values ($1, $2, $3, 'NSC 7788')`, [T, v.id, top]);
  await q(`insert into inventory_vendor_products (tenant_id, vendor_id, product_id, supplier_sku, active) values ($1, $2, $3, 'NSC-0000', false)`, [T, v.id, gel]);
}, 180_000);

describe('Products Management 07 — duplicate product warning', () => {
  it('names each live candidate with its reasons: near SKU, barcode, supplier SKU (with the supplier), name + size', async () => {
    const before = await q(`select (select count(*) from inventory_products)::int + (select count(*) from inventory_vendor_products)::int + (select count(*) from audit_logs)::int as n`);
    const near = await inv.productDuplicates(mgr, { sku: 'opi gb 15' });
    expect(near.candidates).toEqual([{ productId: gel, name: 'OPI Gel  Base', sku: 'OPI-GB-15', barcode: '0001112223334', reasons: ['sku_near'], supplierSku: null, supplierName: null }]);
    expect((await inv.productDuplicates(mgr, { sku: 'OPI-gb-15' })).candidates[0].reasons).toEqual(['sku_exact']);   // the one the save refuses
    expect((await inv.productDuplicates(mgr, { barcode: '0001112223334' })).candidates.map((c) => [c.productId, c.reasons])).toEqual([[gel, ['barcode']]]);
    const ss = await inv.productDuplicates(mgr, { supplierSku: 'nsc-7788' });
    expect(ss.candidates).toEqual([expect.objectContaining({ productId: top, reasons: ['supplier_sku'], supplierSku: 'NSC 7788', supplierName: 'Nail Supply Co' })]);
    expect((await inv.productDuplicates(mgr, { sku: 'NSC7788' })).candidates.map((c) => c.reasons)).toEqual([['supplier_sku']]);   // a new SKU that is another product's supplier SKU
    expect((await inv.productDuplicates(mgr, { supplierSku: 'NSC-0000' })).candidates).toEqual([]);                                    // an inactive link is not a match
    expect((await inv.productDuplicates(mgr, { name: 'opi gel base', sizeValue: '15', sizeUnit: 'ML' })).candidates.map((c) => c.reasons)).toEqual([['name_size']]);
    expect((await inv.productDuplicates(mgr, { name: 'opi gel base', sizeValue: '30', sizeUnit: 'ml' })).candidates).toEqual([]);         // another size is another product
    const both = await inv.productDuplicates(mgr, { sku: 'OPI-GB-15', barcode: '0001112223334', name: 'OPI gel base' });
    expect(both.candidates[0].reasons).toEqual(['sku_exact', 'barcode', 'name_size']);
    expect(both.checked).toEqual({ sku: true, barcode: true, supplierSku: false, name: true });
    expect(await q(`select (select count(*) from inventory_products)::int + (select count(*) from inventory_vendor_products)::int + (select count(*) from audit_logs)::int as n`)).toEqual(before);
  });
  it('never an archived product, another salon\'s product, or the product being edited; nothing asked → nothing checked', async () => {
    expect((await inv.productDuplicates(mgr, { sku: 'OLD-1', barcode: '999' })).candidates).toEqual([]);
    expect((await inv.productDuplicates(other, { supplierSku: 'NSC 7788' })).candidates).toEqual([]);
    expect((await inv.productDuplicates(other, { sku: 'OPI-GB-15' })).candidates.map((c) => c.productId)).toEqual([gelX]);
    expect((await inv.productDuplicates(mgr, { sku: 'OPI-GB-15', exceptId: gel })).candidates).toEqual([]);
    expect(await inv.productDuplicates(mgr, { name: 'ab' })).toEqual({ candidates: [], checked: { sku: false, barcode: false, supplierSku: false, name: false } });
  });
});

// Products Management 09 (round 10): the stock status preview before Add Stock — this location, the product's unit, what is
// coming on committed purchase orders, the location's effective thresholds, THE stock status rule; nothing written
describe('Products Management 09 — stock status preview before Add Stock', () => {
  it('current / incoming / after / after + incoming with the location thresholds and statuses; a draft PO and another location are not incoming', async () => {
    const B2 = id(6);
    await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Second','America/New_York')`, [B2, T]);
    const { id: pid } = await inv.createProduct(mgr, { name: 'Builder gel', sku: 'BG-1', reorderLevel: 6, reorderQuantity: 6, maximumStock: 12, sizeValue: 30, sizeUnit: 'ml', unitType: 'jar' });
    await inv.addStock(mgr, pid, { quantity: 2 });                                                           // on hand 2 here
    await q(`update inventory_location_stock set reorder_level_override = 8 where product_id = $1 and branch_id = $2`, [pid, B]);   // this location reorders at 8 (critical → 4)
    const po = (await q(`insert into purchase_orders (tenant_id, branch_id, status) values ($1,$2,'ordered') returning id`, [T, B]))[0].id;
    await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, units_per_purchase_unit) values ($1,$2,$3,2,1,3)`, [T, po, pid]);   // 1 pack of 3 still to come
    const draft = (await q(`insert into purchase_orders (tenant_id, branch_id, status) values ($1,$2,'draft') returning id`, [T, B]))[0].id;
    await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received) values ($1,$2,$3,50,0)`, [T, draft, pid]);
    const other = (await q(`insert into purchase_orders (tenant_id, branch_id, status) values ($1,$2,'ordered') returning id`, [T, B2]))[0].id;
    await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received) values ($1,$2,$3,40,0)`, [T, other, pid]);
    const before = await q(`select (select count(*) from inventory_units)::int + (select count(*) from inventory_stock_movements)::int + (select count(*) from audit_logs)::int as n`);
    const p = await inv.stockPreview(mgr, pid, '5');
    expect(p).toEqual({ productId: pid, branch: { id: B, name: 'Main' }, unit: 'jar', quantity: 5, onHand: 2, incoming: 3, afterAdd: 7, afterAddAndIncoming: 10,
      reorderLevel: 8, criticalLevel: 4, maximumStock: 12, statusNow: 'critical', statusAfter: 'low', statusAfterIncoming: 'in_stock', clearsReorder: false, overMaximum: false });
    expect(await inv.stockPreview(mgr, pid, 7)).toMatchObject({ afterAdd: 9, statusAfter: 'in_stock', clearsReorder: true, overMaximum: false });
    expect(await inv.stockPreview(mgr, pid, 11)).toMatchObject({ afterAdd: 13, statusAfter: 'overstock', overMaximum: true });
    expect(await inv.stockPreview({ ...mgr, branchId: B2 }, pid, 1)).toMatchObject({ branch: { id: B2, name: 'Second' }, onHand: 0, incoming: 40, reorderLevel: 6, criticalLevel: 3, statusNow: 'out_of_stock', statusAfter: 'critical' });
    expect(await q(`select (select count(*) from inventory_units)::int + (select count(*) from inventory_stock_movements)::int + (select count(*) from audit_logs)::int as n`)).toEqual(before);
    await expect(inv.stockPreview(other, pid, 1)).rejects.toMatchObject({ status: 404 });   // another salon never sees it
  });
});

// Products Management 14 (round 10): the Reorder draft's prefill — THE reorder rule (on-order subtracted) and the VERIFIED
// supplier mapping (active link, active supplier, the product's preferred supplier first); packs, at least the minimum order
describe('Products Management 14 — reorder draft from the verified supplier mapping', () => {
  it('prefills supplier, SKU, cost and packs from the mapping; preferred supplier wins; inactive links / suppliers are not verified; nothing written', async () => {
    const { id: pid } = await inv.createProduct(mgr, { name: 'Acetone 1 gal', sku: 'AC-1', reorderLevel: 10, reorderQuantity: 12 });
    await inv.addStock(mgr, pid, { quantity: 3 });
    const [va] = await q(`insert into inventory_vendors (tenant_id, name) values ($1, 'Alpha Supply') returning id`, [T]);
    const [vb] = await q(`insert into inventory_vendors (tenant_id, name, lead_time_days) values ($1, 'Beta Beauty', 4) returning id`, [T]);
    const [vc] = await q(`insert into inventory_vendors (tenant_id, name, active) values ($1, 'Closed Co', false) returning id`, [T]);
    await q(`insert into inventory_vendor_products (tenant_id, vendor_id, product_id, supplier_sku, last_cost_cents, purchase_unit, units_per_purchase_unit, minimum_order_qty, is_preferred) values
      ($1, $2, $4, 'A-AC1', 900, 'case', 4, null, true), ($1, $3, $4, 'B-77', 850, 'case', 6, 3, false)`, [T, va.id, vb.id, pid]);
    await q(`insert into inventory_vendor_products (tenant_id, vendor_id, product_id, supplier_sku, units_per_purchase_unit) values ($1, $2, $3, 'C-1', 1)`, [T, vc.id, pid]);
    const before = await q(`select (select count(*) from purchase_orders)::int + (select count(*) from purchase_order_lines)::int + (select count(*) from audit_logs)::int as n`);
    // on hand 3, reorder at 10 → max(12, 7) = 12 suggested; the link marked preferred (Alpha, pack 4) → 3 packs = 12
    expect(await inv.reorderDraft(mgr, pid)).toEqual({ productId: pid, productName: 'Acetone 1 gal', branchId: B, unit: 'bottle', onHand: 3, onOrder: 0, reorderLevel: 10, reorderQuantity: 12, suggestedUnits: 12,
      mapping: { vendorId: va.id, vendorName: 'Alpha Supply', supplierSku: 'A-AC1', unitCostCents: 900, purchaseUnit: 'case', unitsPerPurchaseUnit: 4, minimumOrderQty: null, leadTimeDays: null }, purchaseUnitsToOrder: 3, unitsThatArrive: 12 });
    // the product's preferred supplier is Beta → Beta wins; 12 / 6 = 2 packs but its minimum is 3
    await q(`update inventory_products set preferred_vendor_id = $1 where id = $2`, [vb.id, pid]);
    expect(await inv.reorderDraft(mgr, pid)).toMatchObject({ mapping: { vendorId: vb.id, supplierSku: 'B-77', unitsPerPurchaseUnit: 6, minimumOrderQty: 3, leadTimeDays: 4 }, purchaseUnitsToOrder: 3, unitsThatArrive: 18 });
    // a committed order on the way is subtracted (THE rule); a draft is not
    const po = (await q(`insert into purchase_orders (tenant_id, branch_id, status) values ($1,$2,'ordered') returning id`, [T, B]))[0].id;
    await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, units_per_purchase_unit) values ($1,$2,$3,2,0,6)`, [T, po, pid]);
    expect(await inv.reorderDraft(mgr, pid)).toMatchObject({ onOrder: 12, suggestedUnits: 0, purchaseUnitsToOrder: 0, unitsThatArrive: 0 });
    await q(`update purchase_orders set status = 'cancelled' where id = $1`, [po]);
    // only the inactive supplier's link left → no verified mapping, nothing guessed (one unit per pack)
    await q(`update inventory_vendor_products set active = false where vendor_id in ($1, $2)`, [va.id, vb.id]);
    expect(await inv.reorderDraft(mgr, pid)).toMatchObject({ mapping: null, suggestedUnits: 12, purchaseUnitsToOrder: 12, unitsThatArrive: 12 });
    expect(await q(`select (select count(*) from purchase_orders)::int + (select count(*) from purchase_order_lines)::int + (select count(*) from audit_logs)::int as n`)).toEqual([{ n: before[0].n + 2 }]);   // only this test's own PO + line
    await expect(inv.reorderDraft(other, pid)).rejects.toMatchObject({ status: 404 });
  });
});
