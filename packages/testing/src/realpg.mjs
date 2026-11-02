// realpg.mjs — a REAL PostgreSQL for the tests PGlite cannot run (Constitution 12 L6).
//
// PGlite is one session: an advisory lock never blocks the session that holds it, so two "concurrent" reservations
// never wait for each other there. Real PostgreSQL gives every connection its own session, and the lock serializes
// them — which is what production relies on. This starts an embedded PostgreSQL (downloaded binaries, no Docker),
// applies every migration in db/migrations exactly as the PGlite harness does, and hands back a pooled Kysely.
//
// Opt-in: only runs when the `embedded-postgres` binaries are installed (REALPG_MODULES points at their node_modules).
// Never part of the every-push lane — it downloads ~40 MB and takes ~20 s to initialise.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', '..', 'apps', 'api', 'db', 'migrations');   // packages/testing/src → apps/api/db/migrations (Constitution 13 §90)

export async function startRealPostgres(port = 54329) {
  const mods = process.env.REALPG_MODULES;
  if (!mods) return null;
  const req = createRequire(join(mods, 'x.js'));
  const { default: EmbeddedPostgres } = await import(req.resolve('embedded-postgres'));
  const pgMod = await import(req.resolve('pg')); const Pool = pgMod.Pool ?? pgMod.default?.Pool;   // pg is CommonJS: Pool sits on default
  const dir = `/tmp/realpg-${process.pid}-${port}`;
  const epg = new EmbeddedPostgres({ databaseDir: dir, user: 'aps', password: 'aps', port, persistent: false, createPostgresUser: true, onLog: () => undefined, onError: () => undefined });
  await epg.initialise(); await epg.start();
  const pool = new Pool({ connectionString: `postgresql://aps:aps@127.0.0.1:${port}/postgres`, max: 10 });
  pool.on('error', () => undefined);   // an idle client sees the server stop at shutdown; never an unhandled event
  for (const ext of ['pgcrypto', 'pg_trgm', 'btree_gist']) await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) await pool.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const { Kysely, PostgresDialect } = await import('kysely');
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  return { pool, db, stop: async () => { await db.destroy().catch(() => undefined); await pool.end().catch(() => undefined); await epg.stop().catch(() => undefined); } };
}
