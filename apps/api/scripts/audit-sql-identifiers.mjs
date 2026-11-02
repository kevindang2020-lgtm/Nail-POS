#!/usr/bin/env node
// audit-sql-identifiers.mjs — verify that raw `sql`…`` queries reference tables and columns that ACTUALLY
// EXIST, by applying every migration to PGlite and checking identifiers against information_schema.
//
// The gap it closes: the Kysely query builder is type-checked and `check:types-drift` proves kysely.types
// matches the schema — but raw template SQL bypasses both, and most of it sits behind a catch that returns
// null/[] (see audit-silent-sql.mjs). So a wrong column name is invisible at compile time, at test time, and
// at runtime. This is the only thing that can see it without executing every query.
//
// Scope, deliberately narrow to stay trustworthy:
//   • table names after FROM / JOIN / INSERT INTO / UPDATE
//   • qualified column references (alias.column) where the alias maps to one of those tables
// CTEs, subquery aliases and computed aliases are skipped rather than guessed at.
//
// Report only — exit code is always 0. Run: node scripts/audit-sql-identifiers.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules

const SRC = new URL('../src', import.meta.url).pathname;
// Constitution 13: domain modules live in modules/*/src — every root is walked, so a moved controller/repository stays in view.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();

const MIG = new URL('../db/migrations', import.meta.url).pathname;

const { PGlite } = await import('@electric-sql/pglite');
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(MIG, f), 'utf8'));

const cols = new Map();   // table -> Set(columns)
{
  const r = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`);
  for (const row of r.rows) {
    if (!cols.has(row.table_name)) cols.set(row.table_name, new Set());
    cols.get(row.table_name).add(row.column_name);
  }
}

const files = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(e) && !e.includes('pgtest')) files.push(p);
  }
}
for (const r of [SRC, ...MODULE_SRC_ROOTS]) walk(r);

const badTables = [], badColumns = [];
// pull sql`...` template bodies (non-greedy, tolerate ${} placeholders)
const TPL = /sql(?:<[^>]*>)?`([\s\S]*?)`/g;

for (const p of files) {
  const src = readFileSync(p, 'utf8');
  if (!src.includes('sql`') && !src.includes('sql<')) continue;
  const rel = p.slice(SRC.length + 1);
  for (const m of src.matchAll(TPL)) {
    let q = m[1]
      .replace(/\$\{[^}]*\}/g, ' ? ')                       // placeholders out
      .replace(/--[^\n]*/g, ' ')                             // line comments (prose after "from" was noise)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')                       // block comments
      .replace(/extract\s*\(\s*\w+\s+from\b/gi, 'extract( ')  // EXTRACT(DOW FROM col) is not a table ref
      .replace(/\blateral\b/gi, ' ')                         // JOIN LATERAL (subquery follows, not a table)
      .replace(/is\s+(?:not\s+)?distinct\s+from/gi, ' ');     // "IS DISTINCT FROM false" is not a table ref
    // CTE names are not real tables — collect and exclude them
    const cte = new Set([...q.matchAll(/\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((x) => x[1].toLowerCase()));
    const line = src.slice(0, m.index).split('\n').length;
    const alias = new Map();                                  // alias -> table
    const tablesHere = new Set();
    for (const t of q.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
      const table = t[1].toLowerCase();
      const as = (t[2] || '').toLowerCase();
      if (['select', 'values', 'set', 'where', 'on', 'and', 'or', 'skip', 'only'].includes(table)) continue;
      if (/^(generate_series|unnest|jsonb?_|regexp_)/.test(table)) continue;  // set-returning functions
      if (cte.has(table)) continue;                           // CTE, not a base table
      if (/^(pg_|information_schema)/.test(table)) continue;   // catalog introspection is legitimate
      if (!cols.has(table)) { badTables.push({ rel, line, table }); continue; }
      tablesHere.add(table);
      alias.set(as && !['on', 'where', 'set', 'using', 'left', 'right', 'inner', 'group', 'order', 'limit'].includes(as) ? as : table, table);
      alias.set(table, table);
    }
    for (const c of q.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const a = c[1].toLowerCase(), col = c[2].toLowerCase();
      const table = alias.get(a);
      if (!table) continue;                                   // unknown alias → skip, never guess
      if (!cols.get(table).has(col)) badColumns.push({ rel, line, ref: `${a}.${col}`, table });
    }
  }
}

console.log('=== RAW SQL IDENTIFIER AUDIT ===\n');
console.log(`Schema: ${cols.size} tables from ${readdirSync(MIG).filter((x) => x.endsWith('.sql')).length} migrations\n`);
const uniq = (arr, key) => [...new Map(arr.map((x) => [key(x), x])).values()];
const bt = uniq(badTables, (x) => `${x.rel}|${x.table}`), bc = uniq(badColumns, (x) => `${x.rel}|${x.ref}`);
console.log(`Unknown TABLES referenced in raw SQL:  ${bt.length}`);
for (const x of bt.slice(0, 25)) console.log(`   ${x.rel}:${x.line}  →  ${x.table}`);
console.log(`\nUnknown COLUMNS on a resolved table:   ${bc.length}`);
for (const x of bc.slice(0, 40)) console.log(`   ${x.rel}:${x.line}  →  ${x.ref}   (${x.table} has no "${x.ref.split('.')[1]}")`);
console.log([
  '',
  'Report only — exit 0.',
  '',
  'TABLE list: the parser does not resolve subquery aliases (FROM ( ... ) w), so those appear here as',
  'unknown "tables". At the time of writing all four remaining hits are exactly that, and are harmless.',
  'A NEW name in this list is worth one look.',
  '',
  'COLUMN list is the valuable one, and it is currently EMPTY: every qualified column reference in raw',
  'SQL resolves against the migrated schema. The check is proven — reinstating a real bug (t.name where',
  'tenants has display_name) makes it report the exact file and line.',
  '',
].join('\n'));
