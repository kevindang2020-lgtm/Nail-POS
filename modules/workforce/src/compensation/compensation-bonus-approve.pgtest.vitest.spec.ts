// compensation-bonus-approve.pgtest.vitest.spec.ts — §17 end-to-end against real PG: approving a bonus writes an
// 'approved' bonus adjustment (via makeBonusAdjustmentAppender), and payroll's netForTechnicianPeriod sums it — the exact
// path autoBuildPeriod uses to add it to the technician's payable. Applies only migration 159 (compensation_adjustments).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { makeBonusAdjustmentAppender } from './compensation-bonus-facts.adapter';
import { CompensationAdjustmentsRepository } from './compensation-adjustments.repository';
import { buildManualAdjustment } from './compensation-adjustments';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const ctx = { tenantId: 'ec000000-0000-0000-0000-000000000001', branchId: null, userId: 'ec000000-0000-0000-0000-0000000000f1' };
const TECH = 'ec000000-0000-0000-0000-0000000000c1';
const PERIOD = 'ec000000-0000-0000-0000-0000000000d1';
let append: ReturnType<typeof makeBonusAdjustmentAppender>;
let adj: CompensationAdjustmentsRepository;

beforeAll(async () => {
  const pg = await PGlite.create({ extensions: { } });
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* pglite may lack it */ }
  // 159 (the ledger) + 588 (refund_payment_id / 'posted' status, merge Oct 12 2026 — the repository now writes that column).
  // 588 calls schema_apply_check (the Phase 10 helper) — a no-op stub stands in for it on this two-file harness.
  await pg.exec(`CREATE OR REPLACE FUNCTION schema_apply_check(t text, c text, e text, m text) RETURNS void AS $$ BEGIN EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, c, e); END $$ LANGUAGE plpgsql`).catch(() => undefined);
  for (const f of ['159_compensation_adjustments.sql', '588_compensation_adjustments_refund_idempotency.sql']) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(sql); } catch { for (const stmt of sql.split(/;\s*\n/)) { try { await pg.exec(stmt); } catch { /* tolerate */ } } }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  append = makeBonusAdjustmentAppender(db as any);
  adj = new CompensationAdjustmentsRepository(db as any);
});

describe('approved bonus → payroll net (§17, real PG)', () => {
  it('records an approved bonus adjustment that payroll sums into the period', async () => {
    const built = buildManualAdjustment({ technicianId: TECH, periodId: PERIOD, category: 'bonus', amountCents: 20000, reason: 'Production bonus', requestedBy: ctx.userId, approvedBy: ctx.userId });
    expect(built.entry?.status).toBe('approved');
    expect(await append(ctx, built.entry!)).toBe(true);
    const net = await adj.netForTechnicianPeriod(ctx.tenantId, TECH, '2000-01-01', '2100-01-01');
    expect(net).toBe(20000); // payroll adds this to the technician's payable
  });
});
