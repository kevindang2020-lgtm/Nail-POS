// inventory-product-concurrency.pgtest — Products backlog · 17 (concurrent-edit protection): an edit sent with the
// updatedAt the form was opened with is refused (409 PRODUCT_CHANGED) when the product changed elsewhere since then;
// without expectedUpdatedAt the old behaviour stays.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a71c0000-0000-4000-8000-000000000001', B = 'a71c0000-0000-4000-8000-0000000000b1', UM = 'a71c0000-0000-4000-8000-0000000000e9';
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.update', 'inventory.cost.view'] };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Cc Co','Cc Salon','cc-co','CCCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@cc.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('product edit — concurrent-edit protection', () => {
  it('the form\'s updatedAt saves; a stale one is refused with PRODUCT_CHANGED and nothing is written', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Polish A', sku: 'CC-1' });
    const [r0] = await q(`select updated_at from inventory_products where id = $1`, [id]);
    const opened = new Date(r0.updated_at).toISOString();
    await inv.updateProduct(manager, id, { name: 'Polish A1', expectedUpdatedAt: opened });
    expect((await q(`select name from inventory_products where id = $1`, [id]))[0].name).toBe('Polish A1');
    // the same (now stale) timestamp again: someone saved in between
    await expect(inv.updateProduct(manager, id, { name: 'Polish A2', expectedUpdatedAt: opened })).rejects.toMatchObject({ status: 409, extra: { code: 'PRODUCT_CHANGED' } });
    expect((await q(`select name from inventory_products where id = $1`, [id]))[0].name).toBe('Polish A1');
  });
  it('without expectedUpdatedAt the update works as before', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Polish B', sku: 'CC-2' });
    await inv.updateProduct(manager, id, { name: 'Polish B1' });
    expect((await q(`select name from inventory_products where id = $1`, [id]))[0].name).toBe('Polish B1');
  });
});
