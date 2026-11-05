// inventory-events-producer.postgres-race.vitest.spec.ts — inventory.adjusted and inventory.low_stock were declared since
// Constitution 8 and produced by nothing. Every stock movement records inventory.adjusted (quantities and ids only); a
// product crossing INTO a worse stock tier records inventory.low_stock once (a tier it already alerts at emits nothing).
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { InventoryService } from './inventory.service';

const url = process.env.PG_RACE_URL;
const T = 'a7a00000-0000-4000-8000-0000000000a1', B = 'b7a00000-0000-4000-8000-0000000000b1';
const ctx = { tenantId: T, branchId: B, userId: 'c7a00000-0000-4000-8000-0000000000c1', role: 'MANAGER', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let svc: InventoryService;
const events = async (type: string) => (await sql`select payload_json as payload from outbox_events where tenant_id = ${T} and event_type = ${type} order by created_at`.execute(db)).rows as any[];

describe.skipIf(!url)('inventory event producers', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    svc = new InventoryService(db as any, undefined, new OutboxWriter());
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'INV', 'INV', 'inv-events', 'INVE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    for (const t of ['outbox_events', 'inventory_alerts', 'inventory_stock_movements', 'inventory_units', 'inventory_location_stock', 'inventory_products']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
  });
  afterAll(async () => { for (const t of ['outbox_events', 'inventory_alerts', 'inventory_stock_movements', 'inventory_units', 'inventory_location_stock', 'inventory_products']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('receiving stock emits inventory.adjusted; emptying bottles below the reorder level emits inventory.low_stock exactly once', async () => {
    const { id: productId } = await svc.createProduct(ctx, { name: 'OPI Gel Red', reorderLevel: 4, criticalLevel: 1 });
    await svc.addStock(ctx, productId, { quantity: 5 });
    // addStock recomputes BEFORE inserting the bottles: 0 on hand with a reorder level is 'out_of_stock', so the existing
    // alert fires there and the event mirrors it; the recompute after the receipt resolves it.
    expect((await events('inventory.low_stock')).map((e) => e.payload.status)).toEqual(['out_of_stock']);
    const adj = await events('inventory.adjusted');
    expect(adj.length).toBeGreaterThanOrEqual(1);
    expect(adj[adj.length - 1].payload).toMatchObject({ productId, quantityAfter: 5 });
    expect(JSON.stringify(adj)).not.toMatch(/OPI Gel Red/);   // ids and quantities only
    const units: any[] = (await sql`select id from inventory_units where tenant_id = ${T} and product_id = ${productId} order by created_at`.execute(db)).rows;
    await svc.markDamaged(ctx, units[0].id);   // 5 → 4 on hand: at the reorder level → 'low'
    expect(await events('inventory.low_stock')).toHaveLength(2);
    expect((await events('inventory.low_stock'))[1].payload).toMatchObject({ productId, status: 'low', onHand: 4, reorderLevel: 4 });
    await svc.markDamaged(ctx, units[1].id);   // 4 → 3: still 'low' (critical is 1) → nothing new
    expect(await events('inventory.low_stock')).toHaveLength(2);
  });
});
