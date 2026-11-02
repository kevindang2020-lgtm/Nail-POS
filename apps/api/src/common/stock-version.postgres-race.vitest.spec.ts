// stock-version.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 10 (Constitution 1 §40), migration 539.
//
// Two managers edit the same location's stock settings at the same moment, both holding the version they loaded. On a
// REAL Postgres (concurrent connections, real row locks), exactly ONE write may win; every other one must get 409
// VERSION_CONFLICT and change nothing. Same for a technician's weekly schedule (a delete + insert set, now one
// transaction under a lock on the technician).
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { InventoryService } from '@aipowersalon/inventory';
import { KyselyTechniciansRepository, ScheduleVersionConflict } from '@aipowersalon/workforce';

const url = process.env.PG_RACE_URL;
const T = 'c0539000-0000-4000-8000-000000000001';
const B = 'c0539000-0000-4000-8000-0000000000b1';
const N = 8;

describe.skipIf(!url)('optimistic concurrency on real Postgres (539)', () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: N + 2 }) : (null as any);
  const db: any = url ? new Kysely<any>({ dialect: new PostgresDialect({ pool }) }) : null;
  const ctx = { tenantId: T, branchId: B, userId: 'c0539000-0000-4000-8000-0000000000aa', role: 'OWNER', permissions: ['*'] } as any;
  afterAll(async () => {
    if (!pool) return;
    for (const q of ['delete from inventory_location_stock where tenant_id = $1', 'delete from inventory_products where tenant_id = $1', 'delete from technician_schedules where tenant_id = $1',
      'delete from technicians where tenant_id = $1', 'delete from branches where tenant_id = $1', 'delete from tenants where id = $1']) await pool.query(q, [T]).catch(() => undefined);
    await db.destroy();
  });

  async function seed() {
    await pool.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, 'Race539', 'Race539', 'race539', 'RACE539', 'active') on conflict do nothing`, [T]);
    await pool.query(`insert into branches (id, tenant_id, name) values ($1, $2, 'Race') on conflict do nothing`, [B, T]);
  }

  it(`${N} concurrent stock-override saves with the same expectedVersion: exactly one wins, the rest are 409`, async () => {
    await seed();
    const product = (await pool.query(`insert into inventory_products (tenant_id, name) values ($1, 'Race gel') returning id`, [T])).rows[0].id;
    const svc = new InventoryService(db);
    await svc.setLocationStockOverrides(ctx, product, { reorderLevelOverride: 1 });
    const v = (await svc.getProduct(ctx, product)).product.stockVersion as number;
    const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => svc.setLocationStockOverrides(ctx, product, { reorderLevelOverride: 100 + i, expectedVersion: v })));
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(N - 1);
    for (const l of lost) expect(l.reason).toMatchObject({ status: 409, extra: { code: 'VERSION_CONFLICT' } });
    const level = (await pool.query(`select reorder_level_override from inventory_location_stock where product_id = $1`, [product])).rows[0].reorder_level_override;
    expect(level).toBeGreaterThanOrEqual(100);   // the one winner's value — not overwritten by a loser
  });

  it(`${N} concurrent schedule saves with the same expectedVersion: exactly one wins, the week is never mixed or empty`, async () => {
    await seed();
    const tech = (await pool.query(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, 'R', 'R', 'R R') returning id`, [T, B])).rows[0].id;
    const repo = new KyselyTechniciansRepository(db);
    await repo.setSchedule(ctx, tech, { weekly: { monday: { isWorking: true, startTime: '09:00', endTime: '17:00' } }, unavailableDates: [] });
    const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => repo.setSchedule(ctx, tech, {
      weekly: { monday: { isWorking: true, startTime: `1${i}:00`.slice(-5), endTime: '18:00' }, tuesday: { isWorking: true, startTime: '09:00', endTime: '18:00' } }, unavailableDates: [], expectedVersion: 1 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) expect(r.reason).toBeInstanceOf(ScheduleVersionConflict);
    const rows = (await pool.query(`select day_of_week, version from technician_schedules where technician_id = $1 order by day_of_week`, [tech])).rows;
    expect(rows).toHaveLength(2);                                  // monday + tuesday, exactly once each
    expect(new Set(rows.map((r: any) => r.version))).toEqual(new Set([2]));
  });
});
