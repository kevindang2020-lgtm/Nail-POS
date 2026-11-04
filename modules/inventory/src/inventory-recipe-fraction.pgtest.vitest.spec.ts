// inventory-recipe-fraction.pgtest — audit D9 (Nov 4 2026): a recipe line is an exact amount (0.25 bottle), not a whole
// bottle. Service Done takes it from the open bottle (remaining % down) and opens a sealed one only when needed; the
// ledger row carries the exact amount; a whole-unit product refuses a fraction.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a71b0000-0000-4000-8000-000000000001', B = 'a71b0000-0000-4000-8000-0000000000b1';
const UM = 'a71b0000-0000-4000-8000-0000000000e9', CAT = 'a71b0000-0000-4000-8000-0000000000c1', SVC = 'a71b0000-0000-4000-8000-0000000000d1';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.update'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Rf Co','Rf Salon','rf-co','RFCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@rf.test','Olive Owner')`, [UM, T]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Manicures')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Mani',30,3000)`, [SVC, T, B, CAT]);
}, 180_000);

describe('fractional recipes', () => {
  it('0.25 bottle per service: the open bottle goes down, the cost is exact, the ledger has 0.25', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Gel Top', sku: 'GT-1', unitType: 'bottle' });
    await inv.addStock(manager, pid, { quantity: 2, costCents: 1000 });
    const saved: any = await inv.setServiceRecipe(manager, SVC, { lines: [{ productId: pid, quantity: 0.25 }] });
    expect(Number(saved.lines[0].quantity)).toBe(0.25);
    expect(saved.recipeCostCents).toBe(250);
    const r: any = await inv.consumeServiceRecipe(manager, SVC, 1);
    expect(r.deducted[0]).toMatchObject({ requested: 0.25, deducted: 0.25 });
    const units = await q(`select status, estimated_remaining_percent from inventory_units where product_id = $1 order by status`, [pid]);
    expect(units.map((u: any) => [u.status, u.estimated_remaining_percent == null ? null : Number(u.estimated_remaining_percent)])).toEqual([['opened', 75], ['unopened', null]]);
    const [m] = await q(`select metadata_json->>'quantityHundredths' h from inventory_stock_movements where product_id = $1 and movement_type = 'service_usage'`, [pid]);
    expect(Number(m.h)).toBe(25);
    // three more services finish the open bottle; a fifth opens the sealed one
    for (let i = 0; i < 4; i++) await inv.consumeServiceRecipe(manager, SVC, 1);
    const after = await q(`select status, estimated_remaining_percent from inventory_units where product_id = $1 order by status`, [pid]);
    expect(after.map((u: any) => [u.status, u.estimated_remaining_percent == null ? null : Number(u.estimated_remaining_percent)])).toEqual([['empty', 0], ['opened', 75]]);
  });
  it('a whole-unit product refuses a fraction', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Gloves', sku: 'GL-1', unitType: 'pair' });
    await expect(inv.setServiceRecipe(manager, SVC, { lines: [{ productId: pid, quantity: 0.5 }] })).rejects.toThrow(/whole units only/);
  });
});
