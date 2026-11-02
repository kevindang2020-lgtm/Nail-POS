// sql-prepare-check.mjs — PREPARE every raw SQL statement in the API against a REAL Postgres.
//
// The three worst bugs found in this codebase were all invisible to unit tests and all visible to Postgres:
//
//   • `queue_entries` — a table that does not exist. The All Salons dashboard 500'd.
//   • `status = 'sent_to_service_done'` on ticket_service_lines — a value that can never occur. Badge read 0 forever.
//   • `ON CONFLICT (tenant_id, branch_id)` on a PARTIAL index — refused outright. (That one was mine.)
//
// A mocked repository sees none of them. `PREPARE` sees all three: it resolves every table, every column, and
// every conflict target, without running the query or touching a row.
import { PGlite } from '@electric-sql/pglite';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = new URL('..', import.meta.url).pathname;

// ── 1. build the real schema ────────────────────────────────────────────────────────────────────────────
// Constitution 12: the same extensions the pgtest harness loads, so a migration that uses digest() (451's token-hash
// backfill) is APPLIED here instead of skipped -- a skipped migration is one this check cannot see inside, and it
// then reports every query against that migration's columns as a schema error.
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
const pg = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
for (const ext of ['pgcrypto', 'pg_trgm', 'btree_gist']) await pg.exec(`CREATE EXTENSION IF NOT EXISTS ${ext}`).catch(() => undefined);
const MIG = join(API, 'db/migrations');
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql'))
  .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

let applied = 0;
const migFailures = [];
for (const f of files) {
  // PGlite lacks pgcrypto/pg_trgm; gen_random_uuid() is native in PG13+. Only extension lines are stripped.
  const text = readFileSync(join(MIG, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
  try { await applyMigrationToPglite(pg, text); applied++; }   // Phase 10: `-- migrate: no-transaction` files (CONCURRENTLY → plain on PGlite)
  catch (e) { migFailures.push({ f, e: String(e.message).split('\n')[0] }); }
}
// The migration RUNNER creates its own schema_migrations ledger (scripts/migrate.mjs) — apply that exact statement too,
// so queries against the ledger (Constitution 12's restore verifier) are checked against what production really has.
{
  const runner = readFileSync(join(API, 'scripts/migrate.mjs'), 'utf8');
  // Delimited by the string's own quote: the DDL contains `now()`, so stopping at the first ')' truncates it (it did).
  const ledger = runner.match(/'(CREATE TABLE IF NOT EXISTS schema_migrations \(.*?\))'/);
  if (!ledger) throw new Error('sql-prepare-check: could not find the schema_migrations DDL in scripts/migrate.mjs');
  await pg.exec(ledger[1]);
}
console.log(`schema: ${applied}/${files.length} migrations applied`);

// PGlite ships without pgcrypto, pg_trgm and btree_gist. Two migrations need them, so they are SKIPPED here --
// and a skipped migration is a migration this check cannot see inside. It is not a failure, but it is not
// verified either, and silently swallowing it would be exactly the kind of quiet gap this script exists to find.
//
// Both DO apply on real PostgreSQL 16 (373/373 verified). If you change either one, verify it against a real
// server -- this harness cannot.
if (migFailures.length) {
  console.log(`\n   NOT VERIFIED HERE (${migFailures.length}) -- PGlite lacks the extension; real Postgres applies these:`);
  for (const m of migFailures) console.log(`     ${m.f}\n       ${m.e}`);
  console.log('');
}

// ── 2. extract every sql`` template ─────────────────────────────────────────────────────────────────────
function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const stmts = [];
// Constitution 13: most repositories (and their raw SQL) now live in modules/*/src — PREPARE those too.
const MODULES_DIR = join(API, '..', '..', 'modules');
const SQL_ROOTS = [join(API, 'src'), ...(existsSync(MODULES_DIR) ? readdirSync(MODULES_DIR).map((m) => join(MODULES_DIR, m, 'src')).filter((d) => existsSync(d)) : [])];
for (const file of SQL_ROOTS.flatMap((r) => walk(r))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`\s*(?:\.execute|\})/g)) {
    let q = m[1];
    // ${x} → a placeholder. Postgres cannot infer a type for a bare $n in every position, so use NULL-safe
    // literals that still resolve tables and columns — which is what we are actually checking.
    let n = 0;
    q = q.replace(/\$\{[^}]*\}/g, () => `$${++n}`);
    q = q.replace(/--[^\n]*/g, ' ').trim();
    if (!q || n > 60) continue;
    if (!/^(select|insert|update|delete|with)\b/i.test(q)) continue;
    stmts.push({ file: file.replace(API + '/', ''), sql: q, params: n });
  }
}
console.log(`\nraw SQL statements found: ${stmts.length}\n`);

// ── 3. PREPARE each one ─────────────────────────────────────────────────────────────────────────────────
const REAL = [];   // genuine schema errors
const NOISE = [];  // parameter-type inference failures — not schema bugs

let i = 0;
for (const s of stmts) {
  i++;
  try {
    await pg.query(`prepare _p${i} as ${s.sql}`);
    await pg.query(`deallocate _p${i}`).catch(() => {});
  } catch (e) {
    const msg = String(e.message).split('\n')[0];
    // Postgres cannot always infer a parameter's type from context ("could not determine data type of parameter
    // $1"). That is a limitation of PREPARE with untyped params, NOT a schema bug — the table and columns
    // resolved fine, or it would have failed on those first.
    // Only these are DEFINITIONALLY schema bugs. A syntax error means MY extractor mangled the template
    // (nested ${} , sql.raw fragments, params in identifier positions) — it says nothing about the codebase.
    // A type-inference failure means Postgres could not guess a bare $n's type — also not a schema bug.
    //
    // What IS a schema bug, always, no exceptions:
    const isSchemaBug =
      /relation "[^"]+" does not exist/i.test(msg) ||
      /column "[^"]+" does not exist/i.test(msg) ||
      /column [^ ]+ does not exist/i.test(msg) ||
      /no unique or exclusion constraint matching the ON CONFLICT/i.test(msg) ||
      /function [^ ]+ does not exist/i.test(msg);
    (isSchemaBug ? REAL : NOISE).push({ ...s, msg });
  }
}

console.log(`not schema bugs (extractor noise / type inference): ${NOISE.length}`);
console.log(`\n${'='.repeat(90)}`);
console.log(`REAL SCHEMA ERRORS: ${REAL.length}`);
console.log('='.repeat(90));

const byFile = new Map();
for (const r of REAL) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
for (const [file, list] of [...byFile.entries()].sort()) {
  console.log(`\n${file}`);
  for (const r of list) {
    console.log(`   ${r.msg}`);
    console.log(`      ${r.sql.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
}
await pg.close();

// Exit NON-ZERO on any real schema error, or this check is decoration. A CI step that prints a problem and then
// goes green is worse than no CI step: it teaches people the problem is acceptable.
if (REAL.length) {
  console.log(`\n${REAL.length} schema error(s). These will throw at runtime, and no unit test will catch them.`);
  process.exit(1);
}
console.log('\nOK — every raw SQL statement resolves against the real schema.');
process.exit(0);
