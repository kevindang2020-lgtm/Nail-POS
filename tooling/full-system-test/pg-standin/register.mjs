// register.mjs — run a repository script that imports @electric-sql/pglite against a REAL PostgreSQL server instead
// (FullSystemTest.pdf, Oct 28 2026; for an environment with no node_modules). Each `new PGlite()` is a fresh database on
// FST_PG_HOST:FST_PG_PORT (default 127.0.0.1:55432, trust auth, user postgres), dropped on close() unless FST_KEEP_DB=1.
// `kysely` resolves to a raw-`sql` stand-in ONLY when the real package is not installed (no query builder).
//   node --import ./tooling/full-system-test/pg-standin/register.mjs apps/api/scripts/db-ownership.mjs
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
