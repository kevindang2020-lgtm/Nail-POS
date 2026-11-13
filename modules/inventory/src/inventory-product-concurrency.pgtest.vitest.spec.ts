// inventory-product-concurrency.pgtest — Products backlog · 17 (concurrent-edit protection): an edit sent with the
// updatedAt the form was opened with is refused (409 PRODUCT_CHANGED) when the product changed elsewhere since then;
// without expectedUpdatedAt the old behaviour stays.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';
import { InventoryScreenRepository } from './inventory-screen.repository';

const T = 'a71c0000-0000-4000-8000-000000000001', B = 'a71c0000-0000-4000-8000-0000000000b1', UM = 'a71c0000-0000-4000-8000-0000000000e9';
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.update', 'inventory.cost.view'] };
let pg: any; let inv: InventoryService; let repo: InventoryScreenRepository;
const techView: any = { tenantId: T, branchId: B, userId: UM, role: 'TECHNICIAN', permissions: ['inventory.view_limited'] };
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any); repo = new InventoryScreenRepository(kyselyFor(pg) as any);
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

describe('Products backlog · 11 — readable price history', () => {
  it('a retail edit is saved (retailPriceCents was silently dropped) and audited with before → after and the reason', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Polish P', sku: 'CC-P', costCents: 400, retailPriceCents: 1200 });
    await inv.updateProduct(manager, id, { retailPriceCents: 1500, costCents: 450, priceChangeReason: 'Supplier raised cost' });
    const [row] = await q(`select cost_cents, retail_price_cents from inventory_products where id = $1`, [id]);
    expect([Number(row.cost_cents), Number(row.retail_price_cents)]).toEqual([450, 1500]);
    await inv.updateProduct(manager, id, { name: 'Polish P2' });   // not a price change: no price history row
    await inv.updateProduct(manager, id, { retailPriceCents: 1500 });   // same value: not a change either
    await inv.updateProduct(manager, id, { retail_price_cents: 1400 });
    const d: any = await repo.product(manager, id);
    expect(d.priceHistory).toHaveLength(2);
    expect(d.priceHistory[0]).toMatchObject({ retail: { before: 1500, after: 1400 }, cost: null, reason: null, actor: 'Olive Owner' });
    expect(d.priceHistory[1]).toMatchObject({ retail: { before: 1200, after: 1500 }, cost: { before: 400, after: 450 }, reason: 'Supplier raised cost' });
    const aud = d.audit.find((a: any) => a.meta?.priceReason);
    expect(aud.meta.fields).toEqual(['retailPriceCents', 'costCents']);   // the reason is not a field
  });
  it('a viewer who cannot see prices gets no price history and no prices in the audit metadata', async () => {
    const { id } = await inv.createProduct(manager, { name: 'Polish Q', sku: 'CC-Q', costCents: 400, retailPriceCents: 1200 });
    await inv.updateProduct(manager, id, { retailPriceCents: 1300, priceChangeReason: 'promo end' });
    const d: any = await repo.product(techView, id);
    expect(d.priceHistory).toEqual([]);
    expect(JSON.stringify(d.audit)).not.toMatch(/1300|retailAfter|promo end/);
  });
  // SERVICES PRODUCTS 2 · 08 (round 10): duplicate scan / import prevention, pinned on the real schema
  it('a second product with the same SKU (any case) is refused 409 PRODUCT_SKU_TAKEN; a product import job key can be used once', async () => {
    await inv.createProduct(manager, { name: 'Dup A', sku: 'DUP-950' });
    await expect(inv.createProduct(manager, { name: 'Dup B', sku: 'dup-950' })).rejects.toMatchObject({ apiCode: 'PRODUCT_SKU_TAKEN' });
    expect((await q(`select count(*)::int as n from inventory_products where tenant_id = $1 and lower(sku) = 'dup-950'`, [T]))[0].n).toBe(1);
    const cols = (await q(`select column_name from information_schema.columns where table_name = 'product_import_jobs'`)).map((r: any) => r.column_name);
    expect(cols).toContain('idempotency_key');
    const idx = await q(`select indexdef from pg_indexes where indexname = 'ux_product_import_idem'`);
    expect(idx[0].indexdef).toMatch(/UNIQUE INDEX .*product_import_jobs.*idempotency_key/i);
  });
});
