#!/usr/bin/env node
// check-migration-safety.mjs — B-15 (Oct 20 2026): expand → backfill → contract is a rule of DEPLOYMENT.md that no gate
// enforced; 541/542 copied and DROPped in one release and 542 dropped three audit tables with no empty check.
//
// Every DESTRUCTIVE statement in apps/api/db/migrations/*.sql must be reviewed in apps/api/db/migration-safety.allowlist.json
// with a reason, per migration file, count-capped (the ratchet of every other allowlist gate: a reviewed entry covering
// more statements than recorded fails, a stale one fails under --strict). What counts as destructive:
//   D1  DROP TABLE                       — and the SAME FILE must prove the table is empty or archived before the drop
//                                          (a DO block that RAISEs on `count(*)` / `EXISTS` of that table, or an
//                                          INSERT … SELECT FROM that table into another) unless the entry attests
//                                          `archived: true` (archived outside the file) or `provenEmpty: true` (the
//                                          reason says how it is known — for the pre-gate drops: no database that ran
//                                          them ever held a row, nothing being hosted)
//   D2  DROP COLUMN                      — the contract step; must not sit in the file that adds its replacement (D6)
//   D3  RENAME COLUMN / RENAME TO        — breaks every reader at once; expand + backfill + contract instead
//   D4  ALTER COLUMN … SET NOT NULL      — fails on a row the backfill missed; must follow a backfill in an earlier release
//   D5  ALTER COLUMN … TYPE              — rewrites the table under a lock
//   D6  copy-and-drop in ONE file        — a file that CREATEs / ADDs the replacement AND DROPs the source (541)
//   D7  TRUNCATE, DELETE FROM <t>; with no WHERE, ADD COLUMN … NOT NULL without a DEFAULT (fails on a non-empty table)
// Pre-gate migrations (≤ 666) are reviewed in the allowlist as the Oct 20 2026 baseline: no production database exists yet
// (HOSTING A — nothing is hosted), so none of them has ever run against data that matters; the entries say so and the
// count only shrinks. A NEW migration with a destructive statement fails until it is reviewed — that review is the point.
//   node apps/api/scripts/check-migration-safety.mjs            gate (exit 1 on any problem)
//   node apps/api/scripts/check-migration-safety.mjs --strict   also fail on stale allowlist entries
//   node apps/api/scripts/check-migration-safety.mjs --list     every destructive statement, allowlisted or not
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const HERE = resolve(new URL('.', import.meta.url).pathname);
export const MIGRATIONS = join(HERE, '../db/migrations');
export const ALLOWLIST = join(HERE, '../db/migration-safety.allowlist.json');

const RULES = [
  ['D1', /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[a-z_][a-z0-9_]*"?)/gi],
  ['D2', /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?[a-z_][a-z0-9_]*"?)/gi],
  ['D3', /\bRENAME\s+(?:COLUMN\s+("?[a-z_][a-z0-9_]*"?)\s+TO|TO\s+("?[a-z_][a-z0-9_]*"?))/gi],
  ['D4', /\bALTER\s+COLUMN\s+("?[a-z_][a-z0-9_]*"?)\s+SET\s+NOT\s+NULL/gi],
  ['D5', /\bALTER\s+COLUMN\s+("?[a-z_][a-z0-9_]*"?)\s+(?:SET\s+DATA\s+)?TYPE\b/gi],
  ['D7', /\bTRUNCATE\s+(?:TABLE\s+)?("?[a-z_][a-z0-9_]*"?)/gi],
  ['D7', /^\s*DELETE\s+FROM\s+("?[a-z_][a-z0-9_]*"?)\s*;/gim],
  ['D7', /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[a-z_][a-z0-9_]*"?)\s+(?:(?!DEFAULT|GENERATED|IDENTITY)[^,;])*\bNOT\s+NULL\b(?:(?!DEFAULT|GENERATED|IDENTITY)[^,;])*[,;]/gi],
];

/** SQL with comments stripped (a `-- DROP TABLE x` in prose is not a drop). */
function code(sql) { return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }

/** D1's proof: the file checks the table is empty (RAISE after count/EXISTS on it) or archives it (INSERT … SELECT FROM it). */
export function dropIsProven(sql, table) {
  const t = table.replace(/"/g, '');
  const before = sql.slice(0, sql.search(new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?"?${t}"?\\b`, 'i')));
  const emptyCheck = new RegExp(`(count\\(\\*\\)|EXISTS\\s*\\(|PERFORM\\s+1)[\\s\\S]{0,200}\\bFROM\\s+"?${t}"?\\b[\\s\\S]{0,400}\\bRAISE\\b`, 'i');
  const archive = new RegExp(`\\bINSERT\\s+INTO\\s+"?[a-z_][a-z0-9_]*"?[\\s\\S]{0,800}?\\bSELECT\\b[\\s\\S]{0,800}?\\bFROM\\s+"?${t}"?\\b`, 'i');
  return emptyCheck.test(before) || archive.test(before);
}

/** Every destructive statement in one migration file: [{ rule, object, line }]. */
export function scan(file, sql) {
  const c = code(sql);
  const out = [];
  for (const [rule, re] of RULES) {
    re.lastIndex = 0;
    for (const m of c.matchAll(re)) {
      const object = (m[1] ?? m[2] ?? '').replace(/"/g, '');
      const line = c.slice(0, m.index).split('\n').length;
      const o = { rule, object, line };
      if (rule === 'D1') o.proven = dropIsProven(c, object);
      out.push(o);
    }
  }
  // D6: the same file creates / adds something AND drops a table or column
  const creates = /\b(CREATE\s+TABLE|ADD\s+COLUMN)\b/i.test(c);
  if (creates && out.some((o) => o.rule === 'D1' || o.rule === 'D2')) out.push({ rule: 'D6', object: basename(file), line: 0 });
  return out;
}

export function scanAll(dir = MIGRATIONS) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const out = [];
  for (const f of files) for (const o of scan(f, readFileSync(join(dir, f), 'utf8'))) out.push({ file: f, ...o });
  return out;
}

export function loadAllowlist(path = ALLOWLIST) {
  if (!existsSync(path)) return {};
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return j.migrations ?? {};
}

/** Classify: problems (exit 1), stale (strict only). */
export function evaluate(findings, allow) {
  const problems = [];
  const used = new Map();
  for (const f of findings) {
    const entry = allow[f.file];
    const key = `${f.file}#${f.rule}`;
    if (!entry || !String(entry.reason ?? '').trim()) { problems.push(`${f.file}:${f.line}  ${f.rule} ${f.object || ''} — not reviewed (no allowlist entry with a reason)`); continue; }
    const cap = (entry.rules ?? {})[f.rule];
    if (cap == null) { problems.push(`${f.file}:${f.line}  ${f.rule} ${f.object || ''} — rule ${f.rule} not listed for this file (rules: ${Object.keys(entry.rules ?? {}).join(', ') || 'none'})`); continue; }
    used.set(key, (used.get(key) ?? 0) + 1);
    if (f.rule === 'D1' && !f.proven && !entry.archived && !entry.provenEmpty) problems.push(`${f.file}:${f.line}  D1 DROP TABLE ${f.object} — no empty check or archive before the drop in this file, and the entry attests neither "archived" nor "provenEmpty"`);
  }
  for (const [file, entry] of Object.entries(allow)) for (const [rule, cap] of Object.entries(entry.rules ?? {})) {
    const n = used.get(`${file}#${rule}`) ?? 0;
    if (n > cap) problems.push(`${file}  ${rule} — allowlist records ${cap}, found ${n} (a new destructive statement needs its own review)`);
  }
  const stale = [];
  for (const [file, entry] of Object.entries(allow)) {
    if (!existsSync(join(MIGRATIONS, file))) { stale.push(`${file} — no such migration`); continue; }
    for (const [rule, cap] of Object.entries(entry.rules ?? {})) { const n = used.get(`${file}#${rule}`) ?? 0; if (n < cap) stale.push(`${file}  ${rule} — records ${cap}, found ${n}`); }
  }
  return { problems, stale };
}

function main() {
  const strict = process.argv.includes('--strict'), list = process.argv.includes('--list');
  const findings = scanAll();
  const allow = loadAllowlist();
  if (list) for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.object}${f.rule === 'D1' ? (f.proven ? '  (proven)' : '  (NOT proven)') : ''}`);
  const r = evaluate(findings, allow);
  const files = new Set(findings.map((f) => f.file));
  console.log(`check:migration-safety: ${findings.length} destructive statement(s) in ${files.size} migration(s); allowlist ${Object.keys(allow).length} file(s)`);
  if (r.problems.length) { console.error('\nUNREVIEWED / UNPROVEN destructive migration statements:'); for (const p of r.problems) console.error('  ' + p);
    console.error('  Expand → backfill → contract (DEPLOYMENT.md): add the column, backfill in a release, contract in a LATER one; a DROP TABLE\n  proves the table is empty (or archives it) in the same file. A reviewed exception goes in apps/api/db/migration-safety.allowlist.json with its reason.'); }
  if (r.stale.length) { console.log(`\n${strict ? 'STALE' : 'note — stale'} allowlist entries (${r.stale.length}); remove / lower them:`); for (const s of r.stale) console.log('  ' + s); }
  const fail = r.problems.length > 0 || (strict && r.stale.length > 0);
  if (!fail) console.log('OK — every destructive migration statement is reviewed; every DROP TABLE is proven empty or archived.');
  process.exit(fail ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main();
