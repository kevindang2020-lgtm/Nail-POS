// pgtest-schema.ts — one migrated Postgres schema, built once and reused by every pgtest.
//
// The problem it solves: each pgtest that wants the REAL schema replays all db/migrations into PGlite, which
// costs ~6s per FILE. That is fine for two or three tests and a tax on covering the rest of the codebase
// (see scripts/audit-silent-sql.mjs — roughly 50 modules still uncovered). At ~6s each, covering them all
// would add minutes to every run, which is how good coverage stops getting written.
//
// So: build the schema once, dump it to a cache file, and have subsequent tests LOAD the dump instead of
// replaying SQL. The cache key is the migration set itself — add or edit a migration and it rebuilds, so the
// schema can never drift from db/migrations (drift being the exact failure these tests exist to catch).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as kyselyMod from 'kysely';
import { applyMigrationToPglite, pgliteCompatible } from '../../../apps/api/db/migration-sql.mjs';   // the no-transaction / CONCURRENTLY rules (Phase 10)
export { applyMigrationToPglite, pgliteCompatible };   // re-exported for tests that replay migrations themselves

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', '..', 'apps', 'api', 'db', 'migrations');   // packages/testing/src → apps/api/db/migrations
const CACHE_DIR = join(HERE, '..', '..', '..', 'node_modules', '.cache', 'pgtest-schema');  // repo-root node_modules (same depth as before)

function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

/** Cache key = every migration's name AND content. Any change busts it. */
function schemaKey() {
  const h = createHash('sha256');
  for (const f of migrationFiles()) { h.update(f); h.update(readFileSync(join(MIGRATIONS, f))); }
  return h.digest('hex').slice(0, 16);
}

/**
 * A PGlite instance with every migration applied.
 * First call in a run builds and caches it (~6s); later calls load the dump (fast).
 * Each caller gets its OWN instance — tests never share mutable state.
 */
export async function migratedPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const extensions = { pgcrypto, pg_trgm, btree_gist };
  const cacheFile = join(CACHE_DIR, `${schemaKey()}.tar.gz`);

  if (existsSync(cacheFile)) {
    try {
      const loadDataDir = new Blob([readFileSync(cacheFile)]);
      return await PGlite.create({ extensions, loadDataDir });
    } catch { /* corrupt or incompatible cache → fall through and rebuild */ }
  }

  const db = await PGlite.create({ extensions });
  for (const f of migrationFiles()) await applyMigrationToPglite(db, readFileSync(join(MIGRATIONS, f), 'utf8'));
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const dump = await db.dumpDataDir('gzip');
    writeFileSync(cacheFile, Buffer.from(await dump.arrayBuffer()));
  } catch { /* caching is an optimisation; never fail a test over it */ }
  return db;
}

/** Kysely bound to a PGlite instance — the driver every pgtest was hand-rolling. */
export function kyselyFor(pg) {
  const { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } = kyselyMod;
  class Driver {
    async init() {}
    async acquireConnection() {
      return {
        // Kysely derives numUpdatedRows / numDeletedRows from numAffectedRows (a bigint). Without it every UPDATE
        // and DELETE reports 0 rows touched — which made two correct repository methods look broken.
        async executeQuery(compiled) {
          const r = await pg.query(compiled.sql, compiled.parameters);
          return { rows: r.rows, numAffectedRows: BigInt(r.affectedRows ?? 0) };
        },
        async *streamQuery() {},
      };
    }
    // REAL transactions. The earlier no-op stubs meant db.transaction().execute() silently autocommitted every
    // statement — a rollback test passed nothing and proved nothing. PGlite is single-connection, so plain
    // BEGIN/COMMIT/ROLLBACK on the shared connection is exactly right.
    async beginTransaction() { await pg.query('BEGIN'); }
    async commitTransaction() { await pg.query('COMMIT'); }
    async rollbackTransaction() { await pg.query('ROLLBACK'); }
    async releaseConnection() {} async destroy() {}
  }
  return new Kysely({ dialect: {
    createAdapter: () => new PostgresAdapter(), createDriver: () => new Driver(),
    createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler(),
  } });
}
