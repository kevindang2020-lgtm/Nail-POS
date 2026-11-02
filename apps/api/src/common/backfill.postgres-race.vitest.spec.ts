// backfill.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 10 (Constitution 1 §70): two runners of the SAME backfill
// (two API replicas starting together, or a script started twice) on real Postgres apply every row exactly once —
// runBackfill locks the schema_backfills row for each batch, so the second runner continues after the first's last key.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runBackfill, MIGRATIONS_DIR } from '@aipowersalon/database';

const url = process.env.PG_RACE_URL;

describe.skipIf(!url)('runBackfill — concurrent runners on Postgres', () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 6 }) : (null as any);
  const db = url ? new Kysely<any>({ dialect: new PostgresDialect({ pool }) }) : (null as any);
  afterAll(async () => {
    if (!db) return;
    await sql`DROP TABLE IF EXISTS bf_race_src, bf_race_dst`.execute(db);
    await sql`DELETE FROM schema_backfills WHERE name = 'bf_race'`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it('two runners together: every row applied once, progress row consistent', async () => {
    await sql.raw(readFileSync(join(MIGRATIONS_DIR, '534_schema_operations_ledgers.sql'), 'utf8')).execute(db);
    await sql`DROP TABLE IF EXISTS bf_race_src, bf_race_dst`.execute(db);
    await sql`DELETE FROM schema_backfills WHERE name = 'bf_race'`.execute(db);
    await sql`CREATE TABLE bf_race_src (id int PRIMARY KEY)`.execute(db);
    await sql`CREATE TABLE bf_race_dst (src_id int NOT NULL)`.execute(db);
    await sql`INSERT INTO bf_race_src SELECT generate_series(1, 400)`.execute(db);
    const runner = () => runBackfill({
      db, name: 'bf_race', table: 'bf_race_src', keyColumn: 'id', batchSize: 25,
      apply: async (trx, rows) => {
        await sql`SELECT pg_sleep(0.01)`.execute(trx);   // widen the window
        for (const r of rows) await sql`INSERT INTO bf_race_dst (src_id) VALUES (${r.id})`.execute(trx);
      },
    });
    const [a, b] = await Promise.all([runner(), runner()]);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
    expect(a.rows + b.rows).toBe(400);
    const dup = (await sql<any>`SELECT src_id FROM bf_race_dst GROUP BY src_id HAVING count(*) > 1`.execute(db)).rows;
    expect(dup).toEqual([]);
    expect(Number((await sql<any>`SELECT count(*) c FROM bf_race_dst`.execute(db)).rows[0].c)).toBe(400);
    const p = (await sql<any>`SELECT * FROM schema_backfills WHERE name = 'bf_race'`.execute(db)).rows[0];
    expect([p.status, p.last_key, Number(p.rows_done), p.batches_done]).toEqual(['completed', '400', 400, 16]);
  }, 60_000);
});
