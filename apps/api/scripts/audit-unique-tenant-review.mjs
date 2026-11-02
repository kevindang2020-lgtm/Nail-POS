#!/usr/bin/env node
// audit-unique-tenant-review.mjs — BUILD_PLAN Phase 15 C (Constitution 1 §35): gate `check:unique-tenant-review`.
//
// A unique index on a tenant table whose key does not include tenant_id is a platform-wide rule: if two salons could
// legitimately hold the same value, the second is refused (or silently dropped by ON CONFLICT DO NOTHING). Every such
// index was reviewed on Oct 10 2026 in docs/UNIQUE_INDEX_TENANT_REVIEW.md. This replays every migration into PGlite (the
// schema the code runs against) and FAILS when
//   * a non-PK unique index on a table with tenant_id, not including tenant_id, is not in the reviewed table (a NEW one),
//   * a reviewed index's definition changed (re-review it: the reason may no longer hold),
//   * a reviewed row names an index that no longer exists (remove the row),
//   * a row's class is not one of the reviewed classes (a value two salons could share is keyed (tenant_id, …), not listed).
//   node scripts/audit-unique-tenant-review.mjs           check
//   node scripts/audit-unique-tenant-review.mjs --list    print the live set (index | table | definition) for a new row
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = join(ROOT, 'docs', 'UNIQUE_INDEX_TENANT_REVIEW.md');
export const CLASSES = ['GLOBAL — parent', 'GLOBAL — secret', 'GLOBAL — provider id', 'GLOBAL — platform', 'GLOBAL — composed key', 'DEAD'];

/** The SQL that finds them — the same predicate the review used against the live database. */
export const UNREVIEWED_SQL = `
  SELECT t.relname AS table_name, x.relname AS index_name, regexp_replace(pg_get_indexdef(i.indexrelid), '^.* USING btree ', '') AS def
    FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = current_schema() AND i.indisunique AND NOT i.indisprimary
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'tenant_id' AND a.attnum = ANY(i.indkey))
     AND pg_get_indexdef(i.indexrelid) !~ 'tenant_id'
   ORDER BY 1, 2`;

/** Rows of the "Reviewed" table: | `index` | `table` | `definition` | class | reason | */
export function parseReview(md) {
  const at = md.indexOf('## Reviewed');
  const out = new Map();
  if (at < 0) return out;
  for (const line of md.slice(at).split('\n')) {
    const m = /^\| `([^`]+)` \| `([^`]+)` \| `((?:[^`\\]|\\.)+)` \| ([^|]+?) \| (.*) \|\s*$/.exec(line);
    if (m) out.set(m[1], { table: m[2], def: m[3].replace(/\\\|/g, '|'), cls: m[4].trim(), reason: m[5].trim() });
  }
  return out;
}

/** live: [{table_name, index_name, def}], reviewed: Map from parseReview → problems (empty = pass). */
export function reviewProblems(live, reviewed) {
  const problems = [];
  const seen = new Set();
  for (const r of live) {
    seen.add(r.index_name);
    const rev = reviewed.get(r.index_name);
    if (!rev) { problems.push(`NEW  ${r.table_name}.${r.index_name} (${r.def}) — unique without tenant_id and not reviewed: key it (tenant_id, …) or add a reviewed row with its class and evidence`); continue; }
    if (rev.table !== r.table_name || rev.def !== r.def) problems.push(`CHANGED  ${r.table_name}.${r.index_name}: reviewed as \`${rev.table}\` \`${rev.def}\`, now \`${r.def}\` — re-review it`);
    if (!CLASSES.includes(rev.cls)) problems.push(`CLASS  ${r.index_name}: "${rev.cls}" is not a reviewed class (${CLASSES.join(' / ')})`);
    if (!rev.reason) problems.push(`REASON  ${r.index_name}: no reason / evidence`);
  }
  for (const [name, rev] of reviewed) if (!seen.has(name)) problems.push(`STALE  ${rev.table}.${name} is reviewed but no longer exists (or now includes tenant_id) — remove the row`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { migratedPglite } = await import('../../../packages/testing/src/pgtest-schema.mjs');
  const pg = await migratedPglite();
  // pg_get_indexdef prints timestamp literals in the SESSION time zone — pin UTC so the reviewed text never depends on the
  // machine's zone (an index predicate `created_at >= '2026-10-05 00:00:00+00'` printed as '2026-10-04 19:00:00-05' in New York).
  await pg.query("SET TIME ZONE 'UTC'");
  const live = (await pg.query(UNREVIEWED_SQL)).rows;
  await pg.close?.();
  if (process.argv.includes('--list')) { for (const r of live) console.log(`| \`${r.index_name}\` | \`${r.table_name}\` | \`${r.def.replace(/\|/g, '\\|')}\` | ? | ? |`); process.exit(0); }
  const problems = reviewProblems(live, parseReview(readFileSync(DOC, 'utf8')));
  if (problems.length) {
    console.error(`❌ unique-tenant-review: ${problems.length} problem(s) — docs/UNIQUE_INDEX_TENANT_REVIEW.md`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log(`✅ unique-tenant-review: ${live.length} non-PK unique index(es) on tenant tables without tenant_id — every one reviewed (docs/UNIQUE_INDEX_TENANT_REVIEW.md).`);
  process.exit(0);
}
