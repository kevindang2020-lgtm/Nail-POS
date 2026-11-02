// backfill.test.ts — BUILD_PLAN Phase 10 (Constitution 1 §69–71): runBackfill is resumable, batches are applied once,
// each batch commits on its own, and the schema_backfills row tells the truth about where it stopped. Real schema
// (migration 534) on PGlite.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { runBackfill } from './backfill';

let pg: any;
let db: Kysely<any>;

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await pg.exec(`CREATE TABLE bf_src (id int PRIMARY KEY, v int NOT NULL);
                 CREATE TABLE bf_dst (src_id int NOT NULL, v int NOT NULL);
                 INSERT INTO bf_src SELECT g, g * 10 FROM generate_series(1, 25) g;`);
}, 120_000);

const progress = async (name: string) => (await sql<any>`SELECT * FROM schema_backfills WHERE name = ${name}`.execute(db)).rows[0];
const select = (lastKey: string | null, limit: number) =>
  sql<{ id: number; v: number }>`SELECT id, v FROM bf_src WHERE id > ${lastKey === null ? 0 : Number(lastKey)} ORDER BY id LIMIT ${limit}`.execute(db).then((r) => r.rows);
const copy = async (trx: Kysely<any>, rows: { id: number; v: number }[]) => {
  for (const r of rows) await sql`INSERT INTO bf_dst (src_id, v) VALUES (${r.id}, ${r.v})`.execute(trx);
};

describe('runBackfill', () => {
  it('a crash mid-way leaves the completed batches committed, records failed + last_error, and a re-run resumes without re-applying a batch', async () => {
    await pg.exec('TRUNCATE bf_dst');
    let batch = 0;
    await expect(runBackfill({
      db, name: 'bf_crash', keyColumn: 'id', batchSize: 10,
      select: (k, n) => select(k, n),
      apply: async (trx, rows) => { batch++; await copy(trx, rows); if (batch === 2) throw new Error('killed during batch 2'); },
    })).rejects.toThrow('killed during batch 2');

    let p = await progress('bf_crash');
    expect(p.status).toBe('failed');
    expect(p.last_error).toContain('killed during batch 2');
    expect(p.last_key).toBe('10');            // batch 1 committed, batch 2 rolled back
    expect(Number(p.rows_done)).toBe(10);
    expect(p.batches_done).toBe(1);
    expect(Number((await sql<any>`SELECT count(*) c FROM bf_dst`.execute(db)).rows[0].c)).toBe(10);

    const seen: number[][] = [];
    const out = await runBackfill({
      db, name: 'bf_crash', keyColumn: 'id', batchSize: 10, maxBatches: 10,   // a safety stop: a resume bug must fail, not spin
      select: (k, n) => select(k, n),
      apply: async (trx, rows) => { seen.push(rows.map((r) => r.id)); await copy(trx, rows); },
    });
    expect(seen[0][0]).toBe(11);              // resumed after last_key, batch 1 never re-applied
    expect(out.status).toBe('completed');
    p = await progress('bf_crash');
    expect(p.status).toBe('completed');
    expect(p.last_error).toBeNull();
    expect(p.completed_at).not.toBeNull();
    expect(Number(p.rows_done)).toBe(25);
    expect(p.batches_done).toBe(3);
    const dst = (await sql<any>`SELECT src_id, count(*)::int c FROM bf_dst GROUP BY src_id HAVING count(*) > 1`.execute(db)).rows;
    expect(dst).toEqual([]);                  // every row exactly once
    expect(Number((await sql<any>`SELECT count(*) c FROM bf_dst`.execute(db)).rows[0].c)).toBe(25);
  });

  it('a completed backfill is a no-op when run again (deploys re-run it on every start)', async () => {
    let calls = 0;
    const out = await runBackfill({ db, name: 'bf_crash', keyColumn: 'id', batchSize: 10, select: (k, n) => select(k, n), apply: async () => { calls++; } });
    expect(calls).toBe(0);
    expect(out.status).toBe('completed');
  });

  it('shouldStop pauses between batches; the next run continues from the paused key', async () => {
    await pg.exec('TRUNCATE bf_dst');
    let n = 0;
    const first = await runBackfill({
      db, name: 'bf_pause', keyColumn: 'id', batchSize: 7,
      select: (k, l) => select(k, l), apply: copy, shouldStop: () => ++n > 2,
    });
    expect(first.status).toBe('paused');
    expect((await progress('bf_pause')).last_key).toBe('14');
    expect((await progress('bf_pause')).status).toBe('paused');
    const second = await runBackfill({ db, name: 'bf_pause', keyColumn: 'id', batchSize: 7, select: (k, l) => select(k, l), apply: copy });
    expect(second.status).toBe('completed');
    expect(Number((await sql<any>`SELECT count(*) c FROM bf_dst`.execute(db)).rows[0].c)).toBe(25);
  });

  it('the table + keyColumn form selects batches itself (uuid / text keys compare as the column type)', async () => {
    await pg.exec('TRUNCATE bf_dst');
    const out = await runBackfill({ db, name: 'bf_table', table: 'bf_src', keyColumn: 'id', batchSize: 4, apply: copy as any });
    expect(out.status).toBe('completed');
    expect(out.batches).toBe(7);
    expect(Number((await sql<any>`SELECT count(*) c FROM bf_dst`.execute(db)).rows[0].c)).toBe(25);
  });

  it('refuses an unsafe identifier and a non-positive batch size', async () => {
    await expect(runBackfill({ db, name: 'x', table: 'bf_src; drop table bf_src', keyColumn: 'id', batchSize: 5, apply: async () => {} })).rejects.toThrow(/identifier/);
    await expect(runBackfill({ db, name: 'x', table: 'bf_src', keyColumn: 'id', batchSize: 0, apply: async () => {} })).rejects.toThrow(/batchSize/);
  });
});
