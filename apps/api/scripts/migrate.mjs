// migrate.mjs — apply db/migrations/*.sql in order against DATABASE_URL. Plain Node + `pg` (a production dependency), so it
// runs in the lean production container with no devDependencies. Idempotent: a `schema_migrations` ledger records applied
// files and re-runs skip them; each file is applied in its own transaction and the run aborts on the first failure.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { isNoTransaction, splitStatements, concurrentUniqueIndexName, MIGRATION_RENAMES } from '../db/migration-sql.mjs';

// MIGRATIONS_DIR is overridable only so the concurrency test can run the real runner over a tiny fixture set.
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
// One runner at a time (Oct 6 2026). railway.json and the Dockerfile both run this on EVERY container start, so two
// replicas starting together raced the same files: the loser failed mid-file ("relation already exists") and its
// container crashed in a restart loop. A session advisory lock serialises runners; the one that waits re-reads the
// ledger after it gets the lock and finds the work already done.
const MIGRATE_LOCK_KEY = 727274001;
// A migration that waits on a busy table queues every request behind it; give up instead and let the deploy retry.
const LOCK_TIMEOUT_MS = Number(process.env.MIGRATE_LOCK_TIMEOUT_MS ?? 30_000);
// A transactional migration that runs longer than this is almost certainly rewriting a big table; 0 = no limit.
const STATEMENT_TIMEOUT_MS = Number(process.env.MIGRATE_STATEMENT_TIMEOUT_MS ?? 0);

/** `CREATE [UNIQUE] INDEX CONCURRENTLY [IF NOT EXISTS] name` — an earlier failed build leaves `name` INVALID; drop it. */
async function dropInvalidIndexIfAny(c, stmt) {
  const m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?)/i.exec(stmt);
  if (!m) return;
  const name = m[1].replace(/"/g, '');
  const r = await c.query(`SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid WHERE x.relname = $1 AND NOT i.indisvalid`, [name]);
  if (r.rowCount) { console.log(`\nmigrate: dropping INVALID index ${name} left by an earlier interrupted build ... `); await c.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`); }
}
/** Phase 15 C: a CONCURRENTLY unique build whose name a transactional pre-flight DEFERRED (an open schema_deferred_constraints
 *  row — duplicates on this database) is skipped, not attempted: the deploy goes on and db-validate-constraints builds it later. */
async function deferredByPreflight(c, stmt) {
  const name = concurrentUniqueIndexName(stmt);
  if (!name) return false;
  const r = await c.query(`SELECT 1 FROM schema_deferred_constraints WHERE name = $1 AND resolved_at IS NULL LIMIT 1`, [name]).catch(() => ({ rowCount: 0 }));
  if (r.rowCount) console.log(`\nmigrate: skipping ${name} — deferred by the pre-flight (duplicates on this database; scripts/db-validate-constraints.mjs builds it once resolved) ... `);
  return r.rowCount > 0;
}
// MIGRATE_DATABASE_URL (Phase 14, Constitution 12 least privilege): once the API runs as the non-owner `aps_api` login
// (apps/api/db/roles/, scripts/db-provision-roles.mjs) DATABASE_URL can no longer run DDL; the migration runner then uses
// the OWNER's URL from MIGRATE_DATABASE_URL. Unset = DATABASE_URL, exactly as before.
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('migrate: DATABASE_URL (or MIGRATE_DATABASE_URL) is required'); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, max: 1 });
(async () => {
  const c = await pool.connect();
  try {
    const got = (await c.query('SELECT pg_try_advisory_lock($1) AS ok', [MIGRATE_LOCK_KEY])).rows[0].ok;
    if (!got) {
      console.log('migrate: another runner holds the migration lock — waiting for it to finish');
      await c.query('SELECT pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    }
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');

    // Reconcile deliberate migration RENAMES. This ledger keys on filename, so a renamed migration would otherwise look
    // unapplied and re-run on any database that already applied it under the old name. Each entry rewrites the ledger
    // row old→new once; it's a no-op on a fresh DB (old name absent) and on an already-reconciled DB (new name present).
    // (Add future renumbers to MIGRATION_RENAMES in db/migration-sql.mjs.)
    const RENAMED = MIGRATION_RENAMES;   // the one list (db/migration-sql.mjs), shared with db-preflight.mjs
    await c.query('BEGIN');
    try {
      for (const [oldName, newName] of Object.entries(RENAMED)) {
        // rename the ledger row when only the old name is recorded (so the renamed file is treated as applied)…
        await c.query(
          'UPDATE schema_migrations SET filename = $2 WHERE filename = $1 AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $2)',
          [oldName, newName],
        );
        // …and if a pre-fix re-run already inserted the new name, drop the now-stale old row.
        await c.query(
          'DELETE FROM schema_migrations WHERE filename = $1 AND EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $2)',
          [oldName, newName],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      console.error(`migrate: rename reconciliation failed: ${e.message}`);
      process.exit(1);
    }

    // BUILD_PLAN Phase 10 (Constitution 1 §68, §98): the ledger records each file's sha256 when it is applied, so a file
    // edited AFTER it ran on this database is visible (the edit never reaches this database — a new migration must carry
    // it). Rows written before Phase 10 have no checksum and are adopted silently on this run.
    await c.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    await c.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS duration_ms integer');
    const sha = (sql) => createHash('sha256').update(sql).digest('hex');
    const ledger = (await c.query('SELECT filename, checksum FROM schema_migrations')).rows;
    const done = new Set(ledger.map((r) => r.filename));
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const fileSet = new Set(files);
    for (const r of ledger) {
      if (!fileSet.has(r.filename)) { console.warn(`migrate: WARNING ${r.filename} is in the ledger but has no file (deleted or renamed without a RENAMED entry)`); continue; }
      const now = sha(readFileSync(join(MIGRATIONS_DIR, r.filename), 'utf8'));
      if (!r.checksum) await c.query('UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL', [r.filename, now]);
      else if (r.checksum !== now) console.warn(`migrate: WARNING ${r.filename} changed since it was applied — the change is NOT applied to this database; put it in a new migration`);
    }
    const newestApplied = files.filter((f) => done.has(f)).pop();
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      const sum = sha(sql);
      const t0 = Date.now();
      if (newestApplied && f < newestApplied) console.warn(`migrate: WARNING ${f} is out of order (sorts before the already-applied ${newestApplied}); applying it now`);
      process.stdout.write(`migrate: applying ${f} ... `);
      if (isNoTransaction(sql)) {
        // BUILD_PLAN Phase 10 (Constitution 1 §69–71): a file headed `-- migrate: no-transaction` runs OUTSIDE a
        // transaction, one statement at a time — the only way to run CREATE INDEX CONCURRENTLY / VALIDATE CONSTRAINT
        // without blocking writes on a busy table. Every statement in such a file must be idempotent (IF NOT EXISTS …),
        // because a failure part-way leaves the earlier statements applied and the ledger row unwritten: the next run
        // re-applies the file and the already-done statements are no-ops. A CONCURRENTLY build that fails leaves an
        // INVALID index behind; it is dropped here before the retry so the rebuild can succeed.
        try {
          for (const stmt of splitStatements(sql)) {
            if (LOCK_TIMEOUT_MS > 0) await c.query(`SET lock_timeout = ${Math.floor(LOCK_TIMEOUT_MS)}`);
            await dropInvalidIndexIfAny(c, stmt);
            if (await deferredByPreflight(c, stmt)) continue;
            await c.query(stmt);
          }
          await c.query('RESET lock_timeout');
          await c.query('INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [f, sum, Date.now() - t0]);
          console.log('ok (no-transaction)');
          applied++;
        } catch (e) {
          await c.query('RESET lock_timeout').catch(() => undefined);
          console.error(`FAILED\nmigrate: ${f} failed: ${e.message}`);
          process.exit(1);
        }
        continue;
      }
      await c.query('BEGIN');
      try {
        if (LOCK_TIMEOUT_MS > 0) await c.query(`SET LOCAL lock_timeout = ${Math.floor(LOCK_TIMEOUT_MS)}`);
        if (STATEMENT_TIMEOUT_MS > 0) await c.query(`SET LOCAL statement_timeout = ${Math.floor(STATEMENT_TIMEOUT_MS)}`);
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1, $2, $3)', [f, sum, Date.now() - t0]);
        await c.query('COMMIT');
        console.log(`ok (${Date.now() - t0} ms)`);
        applied++;
      } catch (e) {
        await c.query('ROLLBACK');
        console.error(`FAILED\nmigrate: ${f} failed: ${e.message}`);
        process.exit(1);
      }
    }
    console.log(`migrate: complete — ${applied} applied, ${files.length - applied} already present (${files.length} total).`);
  } finally {
    await c.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error('migrate: fatal:', e.message); process.exit(1); });
