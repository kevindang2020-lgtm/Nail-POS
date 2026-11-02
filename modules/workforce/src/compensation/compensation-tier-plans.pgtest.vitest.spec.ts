// compensation-tier-plans.pgtest.vitest.spec.ts — proves KyselyTierPlansRepo against real PG: create writes the band
// ladder as JSONB (via sql cast), list reads + parses it back, archive removes it from the active list. Applies only
// migration 411.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTierPlansRepo } from './compensation-tier-plans.repository';

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

const ctx = { tenantId: 'ea000000-0000-0000-0000-000000000001', userId: 'ea000000-0000-0000-0000-0000000000f1' };
const TECH = 'ea000000-0000-0000-0000-0000000000c1';
const bands = [{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 600000, ratePercent: 55 }, { uptoCents: null, ratePercent: 60 }];

let repo: KyselyTierPlansRepo;

beforeAll(async () => {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/411_technician_tier_plans.sql`, 'utf8'));
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyTierPlansRepo(db as any);
});

describe('KyselyTierPlansRepo (real PG, JSONB)', () => {
  it('creates a plan, storing + parsing the band ladder as JSONB', async () => {
    const p = await repo.create(ctx, { technicianId: TECH, mode: 'marginal', bands });
    expect(p.mode).toBe('marginal');
    expect(p.bands).toHaveLength(3);
    expect(p.bands[0]).toEqual({ uptoCents: 400000, ratePercent: 50 });
    expect(p.bands[2]).toEqual({ uptoCents: null, ratePercent: 60 });
    const list = await repo.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].bands[2].uptoCents).toBeNull();
  });

  it('archives a plan (dropped from the active list)', async () => {
    const [p] = await repo.list(ctx);
    expect(await repo.archive(ctx, p.id)).toBe(true);
    expect(await repo.list(ctx)).toHaveLength(0);
    expect(await repo.archive(ctx, p.id)).toBe(false); // already archived
  });
});
