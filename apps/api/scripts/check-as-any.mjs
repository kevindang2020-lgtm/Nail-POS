#!/usr/bin/env node
// check-as-any.mjs — Oct 14 build plan §234 ("`as any` ratchet"), rebuilt Oct 21 2026. Every `as any` is a type the
// compiler no longer checks — kysely.types drift, a renamed column, a wrong payload shape, all invisible until run time.
// 5,037 of them on Oct 21 2026 across modules/*/src, apps/*/src and packages/*/src (product code; specs, pgtests and race
// specs excluded). This gate RATCHETS: the per-file baseline (as-any.baseline.json) may only shrink — a file with more
// `as any` than its baseline fails; one with fewer lowers the baseline on the next `--update`. A new file starts at 0.
// Run: npm run check:as-any (apps/api) — part of tooling/ci/run-gates.mjs. `--update` rewrites the baseline from the tree.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE = join(ROOT, 'apps/api/scripts/as-any.baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', 'ios', 'android']);
const IS_TEST = /\.(test|spec)\.[cm]?[tj]sx?$|\.pgtest\.|\.postgres-race\.|test-support|\/testing\//;
const AS_ANY = /\bas\s+any\b/g;

function* files(dir) {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* files(p); else if (/\.tsx?$/.test(e) && !e.endsWith('.d.ts') && !IS_TEST.test(p)) yield p;
  }
}
const roots = [];
for (const base of ['modules', 'apps', 'packages']) for (const d of readdirSync(join(ROOT, base))) { const src = join(ROOT, base, d, 'src'); if (existsSync(src)) roots.push(src); }
const counts = {};
for (const root of roots) for (const f of files(root)) {
  const n = (readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '').match(AS_ANY) || []).length;
  if (n) counts[relative(ROOT, f)] = n;
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (process.argv.includes('--update')) { writeFileSync(BASELINE, JSON.stringify(counts, null, 1) + '\n'); console.log(`as-any: baseline written — ${total} in ${Object.keys(counts).length} files`); process.exit(0); }
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const worse = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => `${f}: ${n} (baseline ${base[f] ?? 0})`);
const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
if (worse.length) {
  console.error(`\n❌ as-any ratchet: ${worse.length} file(s) above their baseline — type the value, or (after review) node apps/api/scripts/check-as-any.mjs --update:\n`);
  for (const w of worse) console.error('   ' + w);
  process.exit(1);
}
console.log(`✅ as-any ratchet — ${total} \`as any\` in product code (baseline ${baseTotal}); no file above its baseline`);
