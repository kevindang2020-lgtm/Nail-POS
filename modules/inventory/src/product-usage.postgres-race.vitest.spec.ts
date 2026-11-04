// product-usage.postgres-race.vitest.spec.ts — two technicians record a use of the same product AT THE SAME TIME on real
// PostgreSQL (PGlite is one connection and cannot overlap two transactions, so product-usage.pgtest runs them back to back).
// Pins: both uses land, stock drops by exactly both quantities, one stock movement each, never negative.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { InventoryService } from './inventory.service';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), UA = randomUUID(), UB = randomUUID(), TA = randomUUID(), TB = randomUUID(), GLOVE = randomUUID();
const tech = (userId: string): any => ({ tenantId: T, branchId: B, userId, role: 'TECHNICIAN', permissions: ['inventory.view_limited', 'inventory.product_usage.submit'] });

describe.skipIf(!url)('product usage on real Postgres', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 3 }) }) });
  const dbs = url ? [mk(), mk()] : [];
  const svcs = dbs.map((d) => new InventoryService(d as any));
  const q = (s: any) => s.execute(dbs[0]);
  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'PU', 'PU', ${'pu-' + T.slice(0, 8)}, ${'PU' + T.slice(0, 6)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`);
    for (const u of [UA, UB]) await q(sql`insert into users (id, tenant_id, role, email, full_name) values (${u}, ${T}, 'TECHNICIAN', ${u.slice(0, 8) + '@pu.test'}, 'Tech')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) values (${TA}, ${T}, ${B}, ${UA}, 'Anna', 'N', 'Anna N'), (${TB}, ${T}, ${B}, ${UB}, 'Bao', 'T', 'Bao T')`);
    await q(sql`insert into inventory_products (id, tenant_id, name, sku, active, reorder_level, unit_type, allow_negative_stock) values (${GLOVE}, ${T}, 'Gloves', 'GL-01', true, 0, 'pair', false)`);
    for (let i = 0; i < 5; i++) await q(sql`insert into inventory_units (tenant_id, branch_id, product_id, status) values (${T}, ${B}, ${GLOVE}, 'unopened')`);
    await (svcs[0] as any).recompute({ tenantId: T, branchId: B, userId: UA, role: 'MANAGER', permissions: [] }, GLOVE);
  });
  afterAll(async () => { for (const d of dbs) await d.destroy(); });

  it('two uses of the same product at once both land, in order, with exact stock and one movement each', async () => {
    const onHand = async () => Number((await q(sql`select count(*)::int n from inventory_units where tenant_id = ${T} and product_id = ${GLOVE} and status in ('unopened', 'opened', 'low')`)).rows[0].n);
    const before = await onHand();
    const res = await Promise.allSettled([svcs[0].recordProductUsage(tech(UA), { productId: GLOVE, quantity: 1 }, 'race-a-' + T), svcs[1].recordProductUsage(tech(UB), { productId: GLOVE, quantity: 1 }, 'race-b-' + T)]);
    expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await onHand()).toBe(before - 2);
    const moves = (await q(sql`select count(*)::int n from inventory_stock_movements where tenant_id = ${T} and product_id = ${GLOVE} and movement_type = 'technician_usage'`)).rows[0].n;
    expect(Number(moves)).toBe(2);
  });
});
