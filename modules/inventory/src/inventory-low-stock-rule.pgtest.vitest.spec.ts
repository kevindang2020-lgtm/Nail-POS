// inventory-low-stock-rule.pgtest — audit D9 (Nov 4 2026): "three low-stock definitions disagree". Inventory's summary
// card and alert list now use the rule the Overview board and insight use: the location override wins, an inactive
// product is never low, and LOW means at or under a reorder point (a product with no reorder point is never "low").
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a7190000-0000-4000-8000-000000000001', B = 'a7190000-0000-4000-8000-0000000000b1';
const UM = 'a7190000-0000-4000-8000-0000000000e9';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Ls Co','Ls Salon','ls-co','LSCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@ls.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('one low-stock rule', () => {
  it('summary and alerts agree: override wins, inactive never low, no reorder point never low', async () => {
    const mk = async (name: string, sku: string, qty: number, reorder: number) => {
      const { id } = await inv.createProduct(manager, { name, sku });
      if (qty) await inv.addStock(manager, id, { quantity: qty });
      await q(`update inventory_products set reorder_level = $2, critical_level = null where id = $1`, [id, reorder]);
      return id;
    };
    const low = await mk('Low Polish', 'LP-1', 2, 5);            // low by the product default
    const overridden = await mk('Override', 'OV-1', 2, 5);       // the location says reorder at 1 → not low
    await q(`update inventory_location_stock set reorder_level_override = 1 where product_id = $1`, [overridden]);
    const inactive = await mk('Retired', 'RT-1', 1, 5);          // inactive → never low
    await q(`update inventory_products set active = false where id = $1`, [inactive]);
    await mk('No Point', 'NP-1', 1, 0);                          // no reorder point → never low
    const { summary }: any = await inv.summary(manager);
    const { alerts }: any = await inv.alerts(manager);
    expect(alerts.map((a: any) => a.productId)).toEqual([low]);
    expect(summary.lowStock).toBe(1);
  });
  it('a committed purchase order is subtracted from the suggestion; a draft is not on order', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Reorder Me', sku: 'RM-1' });
    await inv.addStock(manager, id, { quantity: 1 });
    await q(`update inventory_products set reorder_level = 5, reorder_quantity = 6 where id = $1`, [id]);
    const sugg = async () => ((await inv.alerts(manager)) as any).alerts.find((a: any) => a.productId === id);
    expect((await sugg()).suggested).toBe(6);
    const po: any = await inv.createPurchaseOrder(manager, { lines: [{ productId: id, quantityOrdered: 4, unitCostCents: 100 }] });
    expect((await sugg())).toMatchObject({ onOrder: 0, suggested: 6 });   // a draft is not an order yet
    await inv.approvePurchaseOrder(manager, po.id);
    expect((await sugg())).toMatchObject({ onOrder: 4, suggested: 2 });   // 6 needed − 4 coming
    const listed: any = (await inv.listProducts(manager, {}));
    const row = (listed.products ?? listed.items ?? listed).find((p: any) => p.id === id);
    expect(row).toMatchObject({ onOrder: 4, reorderSuggestion: 2 });
  });
});
