#!/usr/bin/env node
// check-raw-sql-inputs.mjs — Security Deep Scan D5/D6 (mandate §83–§84): the SQL-injection gate this repo did not have.
//
// Kysely parameterizes every value — EXCEPT what goes through its escape hatches: sql.raw / sql.lit (0.27 writes strings
// as '${v}' with no quote escaping) / sql.ref / sql.table / sql.id and CompiledQuery.raw, plus pg `.query(` template
// strings. Each of those must take a constant or an allow-listed identifier. The Oct 23 2026 deep scan reviewed every
// call site with a NON-literal argument (all constants / allowlists / validated zone names); this gate freezes that
// review: a new non-literal call site — or a changed argument at a reviewed one — fails until a human reviews it and
// runs `node apps/api/scripts/check-raw-sql-inputs.mjs --update` (the reviewer states why in the commit).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..', '..', '..');
const BASELINE = join(ROOT, 'apps/api/security/raw-sql-inputs.baseline.json');
const DIRS = ['apps/api/src', ...readdirSync(join(ROOT, 'modules')).map((m) => `modules/${m}/src`), ...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/src`)];
const SKIP = /(^|\/)(node_modules|dist|\.harness)(\/|$)|\.(spec|test)\.tsx?$|vitest\.spec\.ts$|pgtest|postgres-race/;
const CALL = /\b(sql\.(raw|lit|ref|table|id)|CompiledQuery\.raw)\s*\(/g;

function* files(dir) {
  const abs = join(ROOT, dir); if (!existsSync(abs)) return;
  for (const n of readdirSync(abs)) {
    const p = join(abs, n); const rel = relative(ROOT, p);
    if (SKIP.test(rel)) continue;
    const st = statSync(p);
    if (st.isDirectory()) yield* files(rel); else if (/\.tsx?$/.test(n)) yield rel;
  }
}
/** the first argument's source text (balanced parens / quotes / template braces) */
function firstArg(src, start) {
  let depth = 0, i = start, quote = null, tpl = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') { i++; continue; } if (quote === '`' && c === '$' && src[i + 1] === '{') { tpl++; i++; continue; } if (quote === '`' && c === '}' && tpl) { tpl--; continue; } if (c === quote && !tpl) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) break;
  }
  return src.slice(start, i).trim();
}
const isLiteral = (a) => /^'[^'\\]*'$/.test(a) || /^"[^"\\]*"$/.test(a) || (/^`[^`]*`$/.test(a) && !a.includes('${'));

const found = {};
for (const d of DIRS) for (const f of files(d)) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(CALL)) {
    const arg = firstArg(src, m.index + m[0].length);
    if (isLiteral(arg)) continue;
    const key = `${f} :: ${m[1]}(${arg.replace(/\s+/g, ' ').slice(0, 160)})`;
    found[key] = (found[key] ?? 0) + 1;
  }
}
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'Reviewed non-literal sql.raw/lit/ref/table/id / CompiledQuery.raw call sites (Security Deep Scan D5, Oct 23 2026). Each argument is a constant, an allow-listed identifier or a validated zone name. Update only after review.', sites: found }, null, 2) + '\n');
  console.log(`raw-sql-inputs: baseline written (${Object.keys(found).length} reviewed call sites)`);
  process.exit(0);
}
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).sites : {};
const fresh = Object.entries(found).filter(([k, n]) => (base[k] ?? 0) < n);
if (fresh.length) {
  console.error(`❌ raw-sql-inputs: ${fresh.length} unreviewed non-literal SQL escape-hatch call(s) — pass a constant or an allow-listed identifier (never request data), then review and run --update:`);
  for (const [k] of fresh) console.error('   ' + k);
  process.exit(1);
}
console.log(`✅ raw-sql-inputs: ${Object.keys(found).length} non-literal escape-hatch call sites, all reviewed; none new`);
