#!/usr/bin/env node
// audit-silent-sql.mjs — RISK REPORT (not a gate): raw SQL whose failure is invisible.
//
// The pattern: a raw `sql\`…\`` query inside a catch that returns [], null, 0 or {}. That is good resilience —
// an analytics panel should not take down a page — but it converts WRONG SQL into INVISIBLE SQL: a bad column
// name does not throw, does not fail a test, and renders as "empty" or "NotConnected". It looks unimplemented.
//
// Why raw SQL specifically: the Kysely query builder is type-checked, and `check:types-drift` proves
// kysely.types matches the migrated schema. Raw template SQL bypasses BOTH. Nothing verifies those column
// names except executing them.
//
// This found three real bugs in one module (Sep 2026): a status value that did not exist in the CHECK
// constraint, and `tenants.name` where the column is `display_name` (twice).
//
// Output is ranked advice, and exit code is always 0 — a swallowing catch is not by itself a defect.
// Run: node scripts/audit-silent-sql.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;
// Constitution 13: domain modules live in modules/*/src — every root is walked, so a moved controller/repository stays in view.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();

const files = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (e.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(e) && !e.includes('pgtest')) files.push(p);
  }
}
for (const r of [SRC, ...MODULE_SRC_ROOTS]) walk(r);

const pgtestDirs = new Set();
function walkPgtests(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walkPgtests(p);
    else if (e.includes('pgtest')) pgtestDirs.add(d);
  }
}
for (const r of [SRC, ...MODULE_SRC_ROOTS]) walkPgtests(r);

const SWALLOW = /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^*]*\*\/\s*)?return\s*(null|\[\]|0|\{\s*\}|undefined)/g;
const rows = [];
for (const p of files) {
  const s = readFileSync(p, 'utf8');
  if (!s.includes('sql`')) continue;
  const swallows = (s.match(SWALLOW) || []).length;
  if (!swallows) continue;
  const queries = (s.match(/sql[<`]/g) || []).length;
  rows.push({ file: p.slice(SRC.length + 1), swallows, queries, covered: pgtestDirs.has(dirname(p)) });
}
// Rank by SWALLOWING CATCHES, not catches × queries. Only a swallowed query can fail invisibly; a module with
// 87 queries behind a single catch is far safer than one with 6 catches over 18 queries. The original
// multiply-by-volume ranking put `owner` (1 catch, 87 queries) above `overview-board` (6 catches, 18) — exactly
// backwards for the risk being measured.
const uncovered = rows.filter((r) => !r.covered).sort((a, b) => b.swallows - a.swallows || b.queries - a.queries);

console.log('=== SILENT-SQL RISK REPORT ===\n');
console.log(`Files with raw SQL behind an error-swallowing catch: ${rows.length}`);
console.log(`  module has a pgtest (queries are executed somewhere): ${rows.length - uncovered.length}`);
console.log(`  module has NO pgtest (column names never executed):   ${uncovered.length}\n`);
console.log('Ranked by SWALLOWING CATCHES (queries shown for context) — highest first:\n');
for (const r of uncovered.slice(0, 20)) {
  console.log(`  ${String(r.swallows).padStart(3)} catches · ${String(r.queries).padStart(3)} queries · ${r.file}`);
}
console.log(`
NOT a defect list. A swallowing catch is often correct. The recommendation is narrower:
for each module above, add ONE pgtest that boots PGlite, creates the tables with the column
names from db/migrations, calls the repository methods, and asserts the result is NOT empty —
because empty is exactly what a broken query looks like.
Examples to copy: src/super-admin-product-catalog/product-catalog-queries.pgtest.vitest.spec.ts
                  src/help/status-query.pgtest.vitest.spec.ts
`);
