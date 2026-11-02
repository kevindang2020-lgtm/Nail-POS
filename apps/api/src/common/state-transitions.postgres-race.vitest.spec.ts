// state-transitions.postgres-race.vitest.spec — BUILD_PLAN Phase 12 (#27): the transition primitive and the adopted writers on
// REAL Postgres with real concurrent connections (PGlite is one session and cannot show a lost update). Runs when
// PG_RACE_URL points at a migrated database (the CI race lane).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { defineStateMachine, transitionStatus, InvalidStateTransitionError } from '@aipowersalon/database';
import { InventoryService } from '@aipowersalon/inventory';
import { PayrollService, KyselyPayrollRepository } from '@aipowersalon/workforce';

const url = process.env.PG_RACE_URL;
const M = defineStateMachine({ name: 'race_order', table: '_p12_sm_race', states: ['draft', 'approved', 'cancelled'] as const, transitions: { draft: ['approved', 'cancelled'], approved: ['cancelled'] } });
const T = 'd2800000-0000-4000-8000-000000000001', B = 'd2800000-0000-4000-8000-0000000000b1', U = 'd2800000-0000-4000-8000-0000000000c1';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.payroll.manage', 'inventory.manage'] } as any;

describe.skipIf(!url)('state transitions under real concurrency (Postgres)', () => {
  let pool: pg.Pool; let db: Kysely<any>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    await sql`CREATE TABLE IF NOT EXISTS _p12_sm_race (id int PRIMARY KEY, status text NOT NULL)`.execute(db);
    await sql`DELETE FROM _p12_sm_race`.execute(db);
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES (${T}, 'Race Nails LLC', 'Race Nails', 'd28race', 'D28R') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B}, ${T}, 'Main') ON CONFLICT (id) DO NOTHING`.execute(db);
  });
  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS _p12_sm_race`.execute(db);
    for (const t of ['inventory_movements', 'inventory_units', 'inventory_location_stock', 'inventory_count_lines', 'inventory_counts', 'inventory_products', 'payroll_lines', 'payroll_periods', 'audit_logs', 'outbox_events']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM branches WHERE id = ${B}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it('20 writers race draft → approved | cancelled on one row: exactly one wins, every other gets 409', async () => {
    await sql`INSERT INTO _p12_sm_race VALUES (1, 'draft')`.execute(db);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => transitionStatus(db, M, { where: { id: 1 }, from: 'draft', to: i % 2 ? 'approved' : 'cancelled' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(losers).toHaveLength(19);
    for (const l of losers) { expect(l.reason).toBeInstanceOf(InvalidStateTransitionError); expect(l.reason.details.reason).toBe('concurrent'); }
  });

  it('two reconciles of the same inventory count at once: one applies the stock correction, the other is refused', async () => {
    const prod = (await sql<{ id: string }>`INSERT INTO inventory_products (tenant_id, name) VALUES (${T}, 'Race Top Coat') RETURNING id`.execute(db)).rows[0];
    const inv = new InventoryService(db as any);
    const c = await inv.createCount(ctx, {});
    const line = (await sql<{ id: string }>`SELECT id FROM inventory_count_lines WHERE count_id = ${c.id}`.execute(db)).rows[0];
    await inv.enterCount(ctx, c.id, { lineId: line.id, countedQty: 3 });   // system says 0 → a surplus of 3 bottles
    const results = await Promise.allSettled([inv.reconcileCount(ctx, c.id), inv.reconcileCount(ctx, c.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const units = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_units WHERE tenant_id = ${T} AND product_id = ${prod.id}`.execute(db)).rows[0].n;
    expect(units).toBe(3);   // before Phase 12 both reconciles could pass the status read and add the surplus twice
  });

  it('"mark paid" and "reopen" of the same finalized payroll period at once: exactly one lands; a paid period is never reopened', async () => {
    const svc = new PayrollService(new KyselyPayrollRepository(db as any));
    const p = await svc.createPeriod(ctx, { periodStart: '2026-09-16', periodEnd: '2026-09-30' });
    await svc.finalize(ctx, p.id);
    const results = await Promise.allSettled([svc.markPaid(ctx, p.id), svc.reopen(ctx, p.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const final = (await sql<{ status: string }>`SELECT status FROM payroll_periods WHERE id = ${p.id}`.execute(db)).rows[0].status;
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value.status;
    expect(final).toBe(winner);
  });
});
