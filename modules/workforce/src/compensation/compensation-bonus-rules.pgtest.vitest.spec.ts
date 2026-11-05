// compensation-bonus-rules.pgtest.vitest.spec.ts — KyselyBonusRulesRepo against real PG: create writes NUMERIC target +
// BIGINT amount, list parses them back to numbers, archive drops from the active list. Applies only migration 412.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyBonusRulesRepo } from './compensation-bonus-rules.repository';

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

const ctx = { tenantId: 'eb000000-0000-0000-0000-000000000001', userId: 'eb000000-0000-0000-0000-0000000000f1' };
const TECH = 'eb000000-0000-0000-0000-0000000000c1';
let repo: KyselyBonusRulesRepo;

beforeAll(async () => {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/412_bonus_rules.sql`, 'utf8'));
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyBonusRulesRepo(db as any);
});

describe('KyselyBonusRulesRepo (real PG)', () => {
  it('creates a rule and parses NUMERIC target + BIGINT amount back to numbers', async () => {
    const r = await repo.create(ctx, { metric: 'service_production', target: 500000, amountCents: 20000, label: 'Prod', technicianId: TECH });
    expect(r).toMatchObject({ metric: 'service_production', target: 500000, amountCents: 20000, technicianId: TECH });
    expect(typeof r.target).toBe('number');
    expect(typeof r.amountCents).toBe('number');
    const list = await repo.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].target).toBe(500000);
  });

  it('supports a salon-wide rule (null technician) and archives', async () => {
    await repo.create(ctx, { metric: 'rating_avg', target: 4.5, amountCents: 2500, label: 'Rating' });
    expect(await repo.list(ctx)).toHaveLength(2);
    const [first] = await repo.list(ctx);
    expect(await repo.archive(ctx, first.id)).toBe(true);
    expect(await repo.list(ctx)).toHaveLength(1);
  });
});
