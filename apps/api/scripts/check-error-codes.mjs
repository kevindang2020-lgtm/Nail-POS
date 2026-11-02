#!/usr/bin/env node
// check-error-codes.mjs — Constitution 5 §30 (re-applied Oct 4 2026): "do not invent new arbitrary codes in every controller".
// A RATCHET: every error code thrown in an exception body (or sent in an `ok:false` / `success:false` JSON body) must be
// in the registry (packages/api-contracts/src/errors.ts) or in the frozen legacy baseline (codes that existed on Oct 4
// 2026 and still work). A NEW unregistered code fails; a baseline entry no longer used fails too, so the baseline only
// shrinks (run with --update after removing one). Add new codes to the registry.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const ROOT = new URL('../../../', import.meta.url).pathname;
const BASELINE = join(ROOT, 'tooling/ci/error-codes.baseline.json');
const registry = new Set([...readFileSync(join(ROOT, 'packages/api-contracts/src/errors.ts'), 'utf8').matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*\{\s*status:/gm)].map((m) => m[1]));
const SCAN = ['apps/api/src', 'modules'];
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === 'dist') continue; const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.(spec|test)\.ts$|vitest/.test(n)) files.push(p); } };
for (const s of SCAN) if (existsSync(join(ROOT, s))) walk(join(ROOT, s));
const ERRORISH = /(new\s+\w*(?:Exception|Error)\s*\(|\.json\(\s*\{[^}]*\b(?:ok|success)\s*:\s*false)/;
const used = new Map();   // code → first location
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!ERRORISH.test(line)) return;
    for (const m of line.matchAll(/\bcode\s*:\s*['"]([A-Za-z][A-Za-z0-9_.-]{1,60})['"]/g)) if (!used.has(m[1])) used.set(m[1], `${relative(ROOT, f)}:${i + 1}`);
  });
}
const unregistered = [...used.keys()].filter((c) => !registry.has(c)).sort();
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'Legacy error codes in use on Oct 4 2026 (Constitution 5 §30). This list only shrinks; new codes go in packages/api-contracts/src/errors.ts.', codes: unregistered }, null, 2) + '\n');
  console.log(`error-codes: baseline written (${unregistered.length} legacy codes; registry ${registry.size})`); process.exit(0);
}
const base = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).codes : []);
const fresh = unregistered.filter((c) => !base.has(c));
const stale = [...base].filter((c) => !used.has(c) || registry.has(c));
if (fresh.length || stale.length) {
  if (fresh.length) { console.log('error-codes: NEW unregistered codes (add them to packages/api-contracts/src/errors.ts):'); for (const c of fresh) console.log(`  ${c}  ${used.get(c)}`); }
  if (stale.length) { console.log('error-codes: baseline entries no longer used — run `node apps/api/scripts/check-error-codes.mjs --update` to shrink it:'); for (const c of stale) console.log(`  ${c}`); }
  process.exit(1);
}
console.log(`error-codes: ${used.size} codes in use — ${used.size - unregistered.length} registered, ${unregistered.length} legacy (frozen baseline); registry ${registry.size}`);
