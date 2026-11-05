// lint-ratchet.mjs — Constitution 7 §303 "Lint passes" / Constitution 12: lint is a GATE, not a suggestion.
//
// `npm run lint` ran with --max-warnings=99999 and was in no gate, so nothing could fail it. This runs eslint over every
// app and FAILS when:
//   • there is any lint ERROR (measured 9 on Sep 28 2026; all fixed in the commit that added this gate), or
//   • any rule has MORE warnings than its baseline (tooling/ci/lint-baseline.json).
// BUILD_PLAN Phase 14: `npm run lint` (root) now runs THIS ratchet, so a new warning fails the command a developer runs,
// not only the gate (`npm run lint:fix` stays plain eslint --fix).
// Fewer warnings pass and print a reminder to shrink the baseline (`--update` rewrites it; only ever smaller).
// BASELINE RESET (Sep 29 2026, developer-tree merge): the incoming 1,187-file branch carried 247 unused-variable and
// 84 hook-dependency warnings. 123 unused import specifiers were removed mechanically and the one lint error fixed;
// the remaining 124 unused locals and 84 exhaustive-deps warnings are in the developer's screens and are NOT safe to fix
// blindly (removing an assigned local can drop a side effect; adding hook deps can cause re-render loops). The baseline
// was set to those counts once, explicitly, and the ratchet resumes from there — it may only shrink again.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = join(ROOT, 'tooling', 'ci', 'lint-baseline.json');
const r = spawnSync('npx', ['eslint', 'apps/*/src', '--format', 'json'], { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024, timeout: 290_000 });
let report;
try { report = JSON.parse(r.stdout || '[]'); } catch { console.error('lint-ratchet: eslint produced no JSON report\n' + (r.stderr || '').slice(-800)); process.exit(1); }

const errors = [];
const counts = {};
for (const f of report) for (const m of f.messages) {
  const rule = m.ruleId || '(parse)';
  if (m.severity === 2) errors.push(`${f.filePath.replace(ROOT + '/', '')}:${m.line} ${rule} — ${m.message}`);
  else counts[rule] = (counts[rule] || 0) + 1;
}
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
if (process.argv.includes('--update')) {
  const next = {};
  for (const [k, v] of Object.entries(counts)) next[k] = Math.min(v, base[k] ?? v);
  writeFileSync(BASE, JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + '\n');
  console.log('lint baseline written (never larger than before)');
}
const grew = Object.entries(counts).filter(([k, v]) => v > (base[k] ?? 0)).map(([k, v]) => `${k}: ${v} (baseline ${base[k] ?? 0})`);
const shrank = Object.entries(base).filter(([k, v]) => (counts[k] ?? 0) < v).map(([k, v]) => `${k}: ${counts[k] ?? 0} (baseline ${v})`);
if (errors.length) console.log(`lint ERRORS (${errors.length}):\n  ` + errors.slice(0, 20).join('\n  '));
if (grew.length) console.log('lint warnings GREW past the baseline:\n  ' + grew.join('\n  '));
if (shrank.length) console.log('lint warnings shrank — run with --update to lock it in:\n  ' + shrank.join('\n  '));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`lint: ${errors.length} errors, ${total} warnings`);
process.exit(errors.length || grew.length ? 1 : 0);
