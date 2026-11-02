// ai-pricing-usage-pgtest.vitest.spec — §218: a usage row records the price version that valued it, on real Postgres.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyAiUsageLogger } from './ai-access.kysely.repository';
import { priceVersionAt } from './ai-pricing';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[], numAffectedRows: BigInt(r.affectedRows ?? 0), numUpdatedRows: BigInt(r.affectedRows ?? 0) }; }, async *streamQuery() {} }; }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {} async releaseConnection() {} async destroy() {}
}
let db: Kysely<any>; let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(pg, readFileSync(join(dir, f), 'utf8'));
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}, 120_000);

describe('§218 the usage row remembers which price valued it', () => {
  it('writes price_version_id through the REAL logger, and it survives a read', async () => {
    const logger = new KyselyAiUsageLogger(db);
    const pv = priceVersionAt('gpt-4o-mini', '2026-09-20')!;
    await logger.log({
      tenantId: '11111111-1111-1111-1111-111111111111', userId: null, packageCode: 'ai_review_reputation_assistant',
      action: 'review.sentiment_analyze', modelProvider: 'openai', modelName: 'gpt-4o-mini',
      inputTokens: 100, outputTokens: 50, usageUnit: 'calls', usageAmount: 1, costMicroUsd: 45,
      status: 'success', errorMessage: null, createdAt: new Date().toISOString(), priceVersionId: pv.id,
    });
    const rows = await db.selectFrom('ai_usage_logs').select(['model_name', 'cost_micro_usd', 'price_version_id']).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].price_version_id).toBe(pv.id);
    expect(Number(rows[0].cost_micro_usd)).toBe(45);
  });
  it('a row without a version still writes — legacy callers are not broken', async () => {
    const logger = new KyselyAiUsageLogger(db);
    await logger.log({
      tenantId: '22222222-2222-2222-2222-222222222222', userId: null, packageCode: 'ai_marketing_assistant',
      action: 'generate_draft', modelProvider: 'openai', modelName: 'gpt-4o', inputTokens: 10, outputTokens: 5,
      usageUnit: 'calls', usageAmount: 1, costMicroUsd: 0, status: 'success', errorMessage: null, createdAt: new Date().toISOString(),
    });
    const row = await db.selectFrom('ai_usage_logs').select(['price_version_id']).where('tenant_id', '=', '22222222-2222-2222-2222-222222222222').executeTakeFirst();
    expect(row!.price_version_id).toBeNull();
  });
  it('ai_price_versions enforces one current row per model', async () => {
    // ids are slugs, supplied by the caller — the PK has no default, deliberately (see migration 440).
    await db.insertInto('ai_price_versions').values({ id: 'pv-openai-gpt4omini-2024-07', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens', in_per_m: 0.15, out_per_m: 0.6, effective_from: '2024-07-18' }).execute();
    await expect(db.insertInto('ai_price_versions').values({ id: 'pv-openai-gpt4omini-2027-01', provider: 'openai', model: 'gpt-4o-mini', unit: 'tokens', in_per_m: 0.3, out_per_m: 1.2, effective_from: '2027-01-01' }).execute())
      .rejects.toThrow();   // ux_ai_price_current: a second open-ended row would make "today's price" ambiguous
  });
  it('effective_to must be after effective_from', async () => {
    await expect(db.insertInto('ai_price_versions').values({ id: 'pv-bad-window', provider: 'x', model: 'y', unit: 'tokens', in_per_m: 1, out_per_m: 1, effective_from: '2026-05-01', effective_to: '2026-04-01' }).execute()).rejects.toThrow();
  });
});
