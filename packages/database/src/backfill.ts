// backfill.ts — BUILD_PLAN Phase 10 (Constitution 1 §69–71 "large migrations are safe"): the one helper for batched,
// resumable data backfills. A migration only ADDS a column / table; the data is filled by `runBackfill` from a script or
// a job, a batch at a time, so no single statement rewrites a big table while the salon is open.
//
// Guarantees (migration 534's `schema_backfills` row, keyed by `name`):
//   * each batch runs in ITS OWN transaction, and the progress row (last_key, rows_done, batches_done) is updated in that
//     same transaction — a batch is either applied AND recorded, or neither. So an interruption (deploy, crash, error)
//     never re-applies a committed batch and never skips one: the next run resumes after `last_key`;
//   * the progress row is locked (`FOR UPDATE`) for the life of each batch, so two runners of the same backfill
//     serialise batch by batch instead of applying the same rows twice;
//   * status: running → completed (no rows left) | paused (`shouldStop()` said so between batches) | failed (the batch
//     threw: rolled back, `last_error` recorded, the error re-thrown). A later run of a paused/failed backfill resumes;
//     a completed one is a no-op (deploys may call it on every start).
//   * `last_error` holds the error message only (truncated) — never row contents.
import { sql, type Kysely } from 'kysely';

export interface BackfillOptions<R extends Record<string, unknown> = Record<string, any>> {
  db: Kysely<any>;
  /** Stable backfill name — the schema_backfills primary key. */
  name: string;
  /** With `keyColumn` and no `select`: the table to walk in key order (`SELECT * … WHERE key > last ORDER BY key LIMIT n`). */
  table?: string;
  /** The column whose value orders the walk and is stored as `last_key` (default 'id'). Must be unique and sortable. */
  keyColumn?: string;
  batchSize: number;
  /** Rows after `lastKey` (null on the first batch), at most `limit`, ordered by the key. Runs inside the batch transaction. */
  select?: (lastKey: string | null, limit: number, trx: Kysely<any>) => Promise<R[]>;
  /** Apply one batch. Runs in the batch's transaction; throw to roll the batch back and mark the backfill failed. */
  apply: (trx: Kysely<any>, rows: R[]) => Promise<void>;
  /** Key of a row (default `row[keyColumn]`), stored as text. */
  keyOf?: (row: R) => unknown;
  /** Checked between batches; true → status 'paused' and return (resume later). */
  shouldStop?: () => boolean;
  /** Stop after this many batches in this run (status stays 'running'); for jobs that do a slice per tick. */
  maxBatches?: number;
}

export interface BackfillResult {
  name: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  /** Batches / rows applied in THIS run. */
  batches: number;
  rows: number;
  lastKey: string | null;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/i;
function ident(v: string, what: string): string {
  if (!IDENT.test(v)) throw new Error(`runBackfill: unsafe ${what} identifier`);
  return v;
}

export async function runBackfill<R extends Record<string, unknown> = Record<string, any>>(opts: BackfillOptions<R>): Promise<BackfillResult> {
  const { db, name } = opts;
  if (!name || typeof name !== 'string') throw new Error('runBackfill: name is required');
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1) throw new Error('runBackfill: batchSize must be a positive integer');
  const keyColumn = ident(opts.keyColumn ?? 'id', 'keyColumn');
  let select = opts.select;
  if (!select) {
    if (!opts.table) throw new Error('runBackfill: pass `select` or `table`');
    const table = ident(opts.table, 'table');
    select = async (lastKey, limit, trx) => (lastKey === null
      ? await sql<R>`SELECT * FROM ${sql.id(table)} ORDER BY ${sql.id(keyColumn)} LIMIT ${limit}`.execute(trx)
      : await sql<R>`SELECT * FROM ${sql.id(table)} WHERE ${sql.id(keyColumn)} > ${lastKey} ORDER BY ${sql.id(keyColumn)} LIMIT ${limit}`.execute(trx)).rows;
  } else if (opts.table) ident(opts.table, 'table');
  const keyOf = opts.keyOf ?? ((r: R) => (r as any)[keyColumn]);

  await sql`INSERT INTO schema_backfills (name, status, batch_size) VALUES (${name}, 'running', ${opts.batchSize}) ON CONFLICT (name) DO NOTHING`.execute(db);
  const start = (await sql<{ status: string; last_key: string | null }>`SELECT status, last_key FROM schema_backfills WHERE name = ${name}`.execute(db)).rows[0];
  if (start.status === 'completed') return { name, status: 'completed', batches: 0, rows: 0, lastKey: start.last_key };
  await sql`UPDATE schema_backfills SET status = 'running', batch_size = ${opts.batchSize}, last_error = NULL, updated_at = now() WHERE name = ${name}`.execute(db);

  let batches = 0; let rows = 0; let lastKey = start.last_key;
  for (;;) {
    if (opts.shouldStop?.()) {
      await sql`UPDATE schema_backfills SET status = 'paused', updated_at = now() WHERE name = ${name} AND status = 'running'`.execute(db);
      return { name, status: 'paused', batches, rows, lastKey };
    }
    if (opts.maxBatches !== undefined && batches >= opts.maxBatches) return { name, status: 'running', batches, rows, lastKey };
    let step: { done: boolean; n: number; key: string | null };
    try {
      step = await db.transaction().execute(async (trx) => {
        // Re-read under a row lock: another runner may have advanced (or completed) it while we waited.
        const cur = (await sql<{ status: string; last_key: string | null }>`SELECT status, last_key FROM schema_backfills WHERE name = ${name} FOR UPDATE`.execute(trx)).rows[0];
        if (cur.status === 'completed') return { done: true, n: 0, key: cur.last_key };
        const batch = await select!(cur.last_key, opts.batchSize, trx);
        if (!batch.length) {
          await sql`UPDATE schema_backfills SET status = 'completed', completed_at = now(), last_error = NULL, updated_at = now() WHERE name = ${name}`.execute(trx);
          return { done: true, n: 0, key: cur.last_key };
        }
        await opts.apply(trx, batch);
        const k = keyOf(batch[batch.length - 1]);
        if (k === null || k === undefined) throw new Error(`runBackfill: batch row has no ${keyColumn}`);
        const key = String(k);
        await sql`UPDATE schema_backfills SET last_key = ${key}, rows_done = rows_done + ${batch.length}, batches_done = batches_done + 1, updated_at = now() WHERE name = ${name}`.execute(trx);
        return { done: false, n: batch.length, key };
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      await sql`UPDATE schema_backfills SET status = 'failed', last_error = ${msg}, updated_at = now() WHERE name = ${name}`.execute(db).catch(() => undefined);
      throw e;
    }
    lastKey = step.key;
    if (step.done) return { name, status: 'completed', batches, rows, lastKey };
    batches++; rows += step.n;
  }
}
