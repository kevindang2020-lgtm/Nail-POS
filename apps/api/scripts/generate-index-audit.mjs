#!/usr/bin/env node
// generate-index-audit.mjs — §7 of the enterprise-DB spec: redundancy audit over ALL indexes, generated from
// the live catalog (431 migrations → PGlite/PG16 → pg_indexes). REPORT-ONLY by policy: dropping an index is a
// measured production decision (pg_stat_user_indexes.idx_scan), never an audit side-effect.
// Regenerate: cd apps/api && node scripts/generate-index-audit.mjs > ../../DB_INDEX_AUDIT.md
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules
const { PGlite } = await import('@electric-sql/pglite');
const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));

const rows = (await db.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`)).rows;
function parse(def) {
  const unique = /^CREATE UNIQUE INDEX/.test(def);
  const method = (def.match(/USING (\w+)/) || [, 'btree'])[1];
  const m = def.match(/USING \w+ \((.*?)\)(?: WHERE (.*))?$/s);
  const cols = m ? m[1].split(/,(?![^()]*\))/).map((c) => c.trim()) : [];
  const where = m && m[2] ? m[2].trim() : '';
  return { unique, method, cols, where };
}
const idx = rows.map((r) => ({ ...r, ...parse(r.indexdef) }));
const byTable = new Map();
for (const i of idx) { if (!byTable.has(i.tablename)) byTable.set(i.tablename, []); byTable.get(i.tablename).push(i); }

const exactDups = [], prefixCands = [];
for (const [t, list] of byTable) {
  for (let a = 0; a < list.length; a++) for (let b = 0; b < list.length; b++) {
    if (a === b) continue;
    const A = list[a], B = list[b];
    if (A.method !== B.method) continue;
    const sameCols = A.cols.join('|') === B.cols.join('|');
    if (a < b && sameCols && A.where === B.where && A.unique === B.unique) exactDups.push({ t, keep: A.indexname, dup: B.indexname, cols: A.cols.join(', ') });
    // Prefix candidate: A strictly shorter, is the leading prefix of B, A not unique (policy indexes stay),
    // and A has no partial predicate that B lacks.
    if (!A.unique && A.cols.length < B.cols.length && B.cols.slice(0, A.cols.length).join('|') === A.cols.join('|') && (A.where === '' || A.where === B.where)) {
      prefixCands.push({ t, narrow: A.indexname, covering: B.indexname, ncols: A.cols.join(', '), ccols: B.cols.join(', '), note: A.where && A.where === B.where ? 'same partial predicate' : (A.where ? '' : B.where ? 'covering is PARTIAL — verify predicate covers the narrow index’s queries before any decision' : '') });
    }
  }
}
const today = new Date().toISOString().slice(0, 10);
let out = `# DB_INDEX_AUDIT.md\n\n**GENERATED FROM THE LIVE CATALOG — do not hand-edit.** Regenerate:\n\`cd apps/api && node scripts/generate-index-audit.mjs > ../../DB_INDEX_AUDIT.md\`\n\nGenerated ${today}. **${idx.length} indexes across ${byTable.size} tables** (includes primary keys and\nconstraint-backed indexes). Policy: **REPORT-ONLY.** Unique/partial-unique indexes are business POLICY in this\nschema (SID dedupe, open-findings dedupe — see DATABASE_ARCHITECTURE.md §5) and are never flagged. Any drop is\na production decision measured with \`pg_stat_user_indexes.idx_scan\` — never an audit side-effect.\n\n## Exact duplicates (${exactDups.length})\n`;
out += exactDups.length ? `\n| Table | Keep | Redundant duplicate | Columns |\n| --- | --- | --- | --- |\n` + exactDups.map((d) => `| ${d.t} | ${d.keep} | ${d.dup} | ${d.cols} |\n`).join('') : `\nNone. Every index definition is unique.\n`;
out += `\n## Prefix-covered candidates (${prefixCands.length}) — candidates, not verdicts\nA narrower non-unique btree whose key columns are the leading prefix of a wider index on the same table. The\nwider index can usually serve the narrower one's scans; the narrower one may still win on size/cache. Decide\nper-index in production with usage stats.\n`;
out += prefixCands.length ? `\n| Table | Narrow (candidate) | Covered by | Narrow cols | Covering cols | Note |\n| --- | --- | --- | --- | --- | --- |\n` + prefixCands.map((c) => `| ${c.t} | ${c.narrow} | ${c.covering} | ${c.ncols} | ${c.ccols} | ${c.note} |\n`).join('') : `\nNone found.\n`;
out += `\n## How to act on this (developer)\n1. In production, snapshot \`pg_stat_user_indexes\` after ≥2 weeks of real traffic. 2. For each candidate with\nnear-zero \`idx_scan\`, test the drop on a replica/staging with the app's slow-query log watched. 3. Ship each\ndrop as its own migration with the measurement in the migration comment. 4. Never touch unique/partial-unique\nindexes without a product decision — they encode business rules, not performance.\n`;
process.stdout.write(out);
