// inventory-po-pack.pgtest — audit D9 (Nov 4 2026): "receiving ignores units_per_purchase_unit". A line ordered in the
// supplier's pack (a case of 6) puts 6 bottles on the shelf per case received, each at the case cost ÷ 6; what is on
// order counts bottles; a later change to the supplier's pack never changes an order already placed.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a71a0000-0000-4000-8000-000000000001', B = 'a71a0000-0000-4000-8000-0000000000b1';
const UM = 'a71a0000-0000-4000-8000-0000000000e9';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.vendor.manage', 'inventory.purchase_order.create'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Pk Co','Pk Salon','pk-co','PKCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@pk.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('purchase units on a purchase order', () => {
  it('2 cases of 6 received = 12 bottles at the case cost ÷ 6; on order counts bottles', async () => {
    const { id: vendorId } = await inv.createVendor(manager, { name: 'Case Supply' });
    const { id: pid } = await inv.createProduct(manager, { name: 'Gel Base', sku: 'GB-6' });
    await inv.linkVendorProduct(manager, vendorId, { productId: pid, purchaseUnit: 'case', unitsPerPurchaseUnit: 6 });
    await q(`update inventory_products set reorder_level = 20, reorder_quantity = 24 where id = $1`, [pid]);
    const po: any = await inv.createPurchaseOrder(manager, { vendorId, lines: [{ productId: pid, quantityOrdered: 2, unitCostCents: 1200 }] });
    await inv.approvePurchaseOrder(manager, po.id);
    const alert = ((await inv.alerts(manager)) as any).alerts.find((a: any) => a.productId === pid);
    expect(alert).toMatchObject({ onOrder: 12, suggested: 12 });   // 24 needed − 12 coming
    // the supplier changes the pack afterwards: the order placed stays a case of 6
    await inv.linkVendorProduct(manager, vendorId, { productId: pid, purchaseUnit: 'case', unitsPerPurchaseUnit: 12 });
    const got: any = await inv.getPurchaseOrder(manager, po.id);
    const line = (got.lines ?? got.purchaseOrder?.lines)[0];
    await inv.receivePurchaseOrder(manager, po.id, { lines: [{ lineId: line.id, quantity: 2 }] });
    const [{ n }] = await q(`select count(*)::int n from inventory_units where tenant_id = $1 and product_id = $2`, [T, pid]);
    expect(n).toBe(12);
    const [{ cost_cents }] = await q(`select cost_cents from inventory_products where id = $1`, [pid]);
    expect(Number(cost_cents)).toBe(200);   // a bottle's cost, not a case's
    const [l] = await q(`select quantity_received from purchase_order_lines where id = $1`, [line.id]);
    expect(Number(l.quantity_received)).toBe(2);   // the line stays in cases
  });
});
