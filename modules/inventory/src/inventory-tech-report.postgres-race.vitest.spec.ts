// inventory-tech-report.postgres-race — BUILD_PLAN Phase 12 round 2 (#27): a technician's bottle report is reviewed ONCE
// (INVENTORY_TECH_REPORT). Before round 2 two managers approving at the same moment both passed the "still pending" read
// and both applied the stock effect; the review is now claimed first with a conditional pending → approved move, so the
// second approval is a 409 and the effect is applied once. Runs when PG_RACE_URL points at a migrated database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { InventoryService } from './inventory.service';

const url = process.env.PG_RACE_URL;
const T = 'd2f00000-0000-4000-8000-000000000001', B = 'd2f00000-0000-4000-8000-0000000000b1', U = 'd2f00000-0000-4000-8000-0000000000c1';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['inventory.manage'] } as any;

describe.skipIf(!url)('technician inventory report review under real concurrency (Postgres)', () => {
  let pool: pg.Pool; let db: Kysely<any>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES (${T}, 'Inv Race LLC', 'Inv Race', 'd2frace', 'D2FR') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B}, ${T}, 'Main') ON CONFLICT (id) DO NOTHING`.execute(db);
  });
  afterAll(async () => {
    for (const t of ['inventory_technician_reports', 'inventory_movements', 'inventory_units', 'inventory_location_stock', 'inventory_products', 'audit_logs', 'outbox_events']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM branches WHERE id = ${B}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it('two approvals of one pending report at once: exactly one lands, the other is 409; a reject after it is refused too', async () => {
    const prod = (await sql<{ id: string }>`INSERT INTO inventory_products (tenant_id, name) VALUES (${T}, 'Race Base Coat') RETURNING id`.execute(db)).rows[0];
    const rep = (await sql<{ id: string }>`INSERT INTO inventory_technician_reports (tenant_id, branch_id, product_id, technician_user_id, report_type)
      VALUES (${T}, ${B}, ${prod.id}, ${U}, 'missing') RETURNING id`.execute(db)).rows[0];
    const inv = new InventoryService(db as any);
    const results = await Promise.allSettled([inv.approveReport(ctx, rep.id), inv.approveReport(ctx, rep.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect([409]).toContain((loser.reason as any).status);
    await expect(inv.rejectReport(ctx, rep.id, 'late')).rejects.toMatchObject({ status: 409 });
    expect((await sql<{ status: string }>`SELECT status FROM inventory_technician_reports WHERE id = ${rep.id}`.execute(db)).rows[0].status).toBe('approved');
  });
});
