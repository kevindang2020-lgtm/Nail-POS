// compensation-tier-plan.pgtest.vitest.spec.ts — proves PayrollAutoBuildAdapter.resolveTierPlan against real PG:
// loads the active plan for a technician, parses the JSONB band ladder, prefers a branch-specific plan, and returns
// null when there is none. Applies only migration 411 (the table is self-contained; the adapter's other repos are
// instantiated but unused by this method).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { PayrollAutoBuildAdapter } from './compensation-autobuild.adapter';

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

const T = 'da000000-0000-0000-0000-000000000001';
const TECH = 'da000000-0000-0000-0000-0000000000c1';
const TECH2 = 'da000000-0000-0000-0000-0000000000c2';
const B1 = 'da000000-0000-0000-0000-0000000000b1';

let adapter: PayrollAutoBuildAdapter;
let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/411_technician_tier_plans.sql`, 'utf8'));
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  adapter = new PayrollAutoBuildAdapter(db as any);
  const bands = JSON.stringify([{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 600000, ratePercent: 55 }, { uptoCents: null, ratePercent: 60 }]);
  // an all-branches marginal plan + a branch-specific entire plan for the same tech (branch-specific should win for B1)
  await pg.query(`insert into technician_tier_plans (tenant_id, technician_id, branch_id, mode, bands_json, status, effective_start) values ($1,$2,null,'marginal',$3::jsonb,'active', now() - interval '5 days')`, [T, TECH, bands]);
  await pg.query(`insert into technician_tier_plans (tenant_id, technician_id, branch_id, mode, bands_json, status, effective_start) values ($1,$2,$3,'entire',$4::jsonb,'active', now() - interval '5 days')`, [T, TECH, B1, bands]);
});

describe('resolveTierPlan (§2, real PG)', () => {
  it('loads the plan and parses the JSONB band ladder', async () => {
    const plan = await adapter.resolveTierPlan(T, TECH, null, new Date().toISOString());
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('marginal'); // the all-branches plan (no branch context)
    expect(plan!.bands).toHaveLength(3);
    expect(plan!.bands[0]).toEqual({ uptoCents: 400000, ratePercent: 50 });
    expect(plan!.bands[2]).toEqual({ uptoCents: null, ratePercent: 60 });
  });

  it('prefers a branch-specific plan over the all-branches one', async () => {
    const plan = await adapter.resolveTierPlan(T, TECH, B1, new Date().toISOString());
    expect(plan!.mode).toBe('entire'); // the branch-specific plan wins
  });

  it('returns null for a technician with no plan', async () => {
    expect(await adapter.resolveTierPlan(T, TECH2, null, new Date().toISOString())).toBeNull();
  });
});
