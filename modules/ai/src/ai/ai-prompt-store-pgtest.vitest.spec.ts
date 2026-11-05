// ai-prompt-store-pgtest.vitest.spec — the REAL KyselyPromptStore against migration 436 on PGlite (Constitution 10 §22–§25).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyPromptStore } from './ai-prompt-store.kysely';
import { selectVersion, rollback, PROMPT_SEED } from './ai-prompt-registry';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[], numAffectedRows: BigInt(r.affectedRows ?? 0), numUpdatedRows: BigInt(r.affectedRows ?? 0) }; }, async *streamQuery() {} }; }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {} async releaseConnection() {} async destroy() {}
}
let db: Kysely<any>; let pg: PGlite;
const KEY = 'review.sentiment_analyze';

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/436_ai_prompt_versions.sql`, 'utf8'));
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('KyselyPromptStore over ai_prompt_versions', () => {
  it('serves the in-code seed on an empty table (§270 local testing needs no rows)', async () => {
    const store = new KyselyPromptStore(db);
    const v = await selectVersion(store, KEY, 't1');
    expect(v.version).toBe(1); expect(v.contentSha256).toBe(PROMPT_SEED.find((p) => p.promptKey === KEY)!.contentSha256);
  });
  it('a database row for the same (key, version) OVERRIDES the seed; a higher version extends it', async () => {
    const store = new KyselyPromptStore(db);
    const seed = PROMPT_SEED.find((p) => p.promptKey === KEY)!;
    await db.insertInto('ai_prompt_versions').values({ prompt_key: KEY, module: seed.module, task_key: KEY, version: 2, system_instructions: 'v2 from db: also detect sarcasm.', template: seed.template, variables: JSON.stringify(seed.variables), output_schema_key: seed.outputSchemaKey, status: 'ACTIVE', rollout_percent: 100, content_sha256: 'db2' }).execute();
    const v = await selectVersion(store, KEY, 't1');
    expect(v.version).toBe(2); expect(v.systemInstructions).toMatch(/sarcasm/);
    expect((await store.versionsFor(KEY)).map((x) => x.version).sort()).toEqual([1, 2]);
  });
  it('§25 rollback through the real store: v2 → ROLLED_BACK, v1 materialised as ACTIVE, audit row written', async () => {
    const store = new KyselyPromptStore(db);
    const r = await rollback(store, KEY, 1, '33333333-3333-3333-3333-333333333333', 'v2 misclassifies sarcastic reviews as positive');
    expect(r).toEqual({ from: 2, to: 1 });
    expect((await selectVersion(store, KEY, 't1')).version).toBe(1);
    const rows = await db.selectFrom('ai_prompt_versions').select(['version', 'status']).where('prompt_key', '=', KEY).orderBy('version').execute();
    expect(rows).toEqual([{ version: 1, status: 'ACTIVE' }, { version: 2, status: 'ROLLED_BACK' }]);
    const audit = await db.selectFrom('ai_prompt_rollbacks').selectAll().where('prompt_key', '=', KEY).execute();
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ from_version: 2, to_version: 1 });
  });
  it('§22 the trigger refuses a content edit even through Kysely', async () => {
    await expect(db.updateTable('ai_prompt_versions').set({ template: 'hacked' }).where('prompt_key', '=', KEY).where('version', '=', 1).execute()).rejects.toThrow(/immutable/);
  });
});
