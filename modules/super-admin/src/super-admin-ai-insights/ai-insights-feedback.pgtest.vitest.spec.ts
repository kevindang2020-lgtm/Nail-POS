// ai-insights-feedback.pgtest.vitest.spec.ts — the 424 feedback store against the REAL tables. Pinned: feedback
// snapshots the insight's model/prompt version at feedback time (a regeneration cannot rewrite what the reviewer
// saw), the verdict CHECK holds, unknown insights are rejected with null (never a dangling row), and the recent
// log orders newest-first. Human-review-only by design — nothing here feeds a model.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { submitInsightFeedback, recentInsightFeedback } from './ai-insights.kysely.repository';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

let db: Kysely<any>; let pg: PGlite;
const INS = 'fb000000-0000-0000-0000-0000000000a1';

beforeAll(async () => {
  pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await pg.exec(`CREATE TABLE ai_insights (id uuid primary key default gen_random_uuid(), insight_reference text not null,
    tenant_id uuid, title text not null, model_version text, prompt_version text)`);
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/424_ai_insight_feedback.sql`, 'utf8'));
  await pg.query(`INSERT INTO ai_insights (id, insight_reference, title, model_version, prompt_version) VALUES
    ($1, 'AI-BKG-0001', 'Declining bookings', 'gpt-x-2026-06', 'insights-v12')`, [INS]);
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('ai_insight_feedback (real PG, real 424 migration file)', () => {
  it('records feedback and SNAPSHOTS the model/prompt version the reviewer saw', async () => {
    const r = await submitInsightFeedback(db as any, { insightId: INS, verdict: 'not_helpful', comment: '  too vague  ' });
    expect(r).not.toBeNull();
    expect(r!.modelVersion).toBe('gpt-x-2026-06');
    expect(r!.promptVersion).toBe('insights-v12');
    expect(r!.comment).toBe('too vague');
    // the snapshot survives a regeneration that bumps the insight's versions
    await pg.query(`UPDATE ai_insights SET model_version='gpt-y-2026-07', prompt_version='insights-v13' WHERE id=$1`, [INS]);
    const log = await recentInsightFeedback(db as any, 10);
    expect(log[0].modelVersion).toBe('gpt-x-2026-06');
  });

  it('rejects feedback on an insight that does not exist — null, never a dangling row', async () => {
    expect(await submitInsightFeedback(db as any, { insightId: 'fb000000-0000-0000-0000-0000000000ff', verdict: 'helpful' })).toBeNull();
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM ai_insight_feedback`);
    expect((rows[0] as any).n).toBe(1);
  });

  it('the verdict CHECK holds at the database, not just in code', async () => {
    await expect(pg.query(`INSERT INTO ai_insight_feedback (insight_id, verdict) VALUES ($1, 'meh')`, [INS])).rejects.toThrow();
  });

  it('recent log is newest-first and respects the limit', async () => {
    await submitInsightFeedback(db as any, { insightId: INS, verdict: 'helpful' });
    await submitInsightFeedback(db as any, { insightId: INS, verdict: 'incorrect' });
    const log = await recentInsightFeedback(db as any, 2);
    expect(log).toHaveLength(2);
    expect(log[0].verdict).toBe('incorrect');
  });
});
