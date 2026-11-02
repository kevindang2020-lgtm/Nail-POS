// ai-settings-store-pgtest.vitest.spec — the REAL KyselyAiSettingsStore over tenant_settings (migration 016).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyAiSettingsStore, AI_SETTINGS_CATEGORY } from './ai-settings-store';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[], numAffectedRows: BigInt(r.affectedRows ?? 0), numUpdatedRows: BigInt(r.affectedRows ?? 0) }; }, async *streamQuery() {} }; }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {} async releaseConnection() {} async destroy() {}
}
let db: Kysely<any>; let store: KyselyAiSettingsStore;
const T = '33333333-3333-3333-3333-333333333333';
const B = '44444444-4444-4444-4444-444444444444';
const U = '55555555-5555-5555-5555-555555555555';

beforeAll(async () => {
  const pg = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(pg, readFileSync(join(dir, f), 'utf8'));
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  store = new KyselyAiSettingsStore(db);
}, 120_000);

describe('tenant AI settings persist in the EXISTING tenant_settings table', () => {
  it('an unset tenant reads as empty rather than failing', async () => {
    expect(await store.get(T)).toEqual({});
  });
  it('writes and reads back, under the ai-platform category', async () => {
    await store.put(T, { automation: { 'review.response_draft': 'SUGGEST_ONLY' }, autoActionsDisabled: true }, U, null);
    const back = await store.get(T);
    expect(back.automation!['review.response_draft']).toBe('SUGGEST_ONLY');
    expect(back.autoActionsDisabled).toBe(true);
    const row = await db.selectFrom('tenant_settings').select(['category', 'branch_id', 'updated_by_user_id']).where('tenant_id', '=', T).executeTakeFirst();
    expect(row).toMatchObject({ category: AI_SETTINGS_CATEGORY, branch_id: null, updated_by_user_id: U });
  });
  it('a second save UPDATES rather than duplicating (the unique index does the work)', async () => {
    await store.put(T, { automation: { 'review.response_draft': 'OFF' } }, U, null);
    const rows = await db.selectFrom('tenant_settings').selectAll().where('tenant_id', '=', T).where('category', '=', AI_SETTINGS_CATEGORY).execute();
    expect(rows).toHaveLength(1);
    expect((await store.get(T)).automation!['review.response_draft']).toBe('OFF');
  });
  it('§53 a BRANCH row layers over the tenant row by tightening, and does not affect tenant-wide reads', async () => {
    await store.put(T, { automation: { 'voice.summarize': 'LIMITED_AUTOMATION' } }, U, null);
    await store.put(T, { automation: { 'voice.summarize': 'SUGGEST_ONLY' } }, U, B);
    expect((await store.get(T, B)).automation!['voice.summarize']).toBe('SUGGEST_ONLY');
    expect((await store.get(T)).automation!['voice.summarize']).toBe('LIMITED_AUTOMATION');
    expect(await db.selectFrom('tenant_settings').selectAll().where('tenant_id', '=', T).where('category', '=', AI_SETTINGS_CATEGORY).execute()).toHaveLength(2);
  });
  it('another tenant is unaffected', async () => {
    expect(await store.get('66666666-6666-6666-6666-666666666666')).toEqual({});
  });
});
