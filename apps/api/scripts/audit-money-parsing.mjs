/* audit-money-parsing.mjs — the gate that keeps money out of floating point on the way in.
 *
 * == WHY THIS EXISTS =======================================================================================
 *
 * Every screen that takes a dollar amount has to turn "12.34" into 1234 cents. Until Jul 27, 2026, twenty-nine
 * of them did it with `Math.round(parseFloat(x) * 100)`, and that is wrong in three separate ways:
 *
 *   • It ACCEPTS what it should reject. `parseFloat('1e3')` is 1000. `parseFloat('12.345')` is 12.345 → 1235
 *     cents, silently inventing a third decimal place the person never typed. `parseFloat('12abc')` is 12.
 *   • It produces NaN on genuinely invalid text, and several sites sent that NaN straight to the API.
 *   • Fixing it carelessly is its own bug: replacing the float path with `?? 0` makes invalid input read as
 *     $0.00, which SILENTLY BYPASSES the very validity guards ("Enter a valid amount", "Invalid locked price")
 *     that the NaN used to trip. That regression happened during the migration and was caught by an owner-app
 *     test; two more instances were then found by inspection.
 *
 * The single correct parser is `parseDollarsToCents` — regex-validated, integer math, `null` on anything invalid.
 * It lives in packages/ui for pos-web and is mirrored at `src/lib/money-input.ts` in the four apps that do not
 * depend on that package.
 *
 * == WHAT IT CHECKS ========================================================================================
 *
 *   parseFloat(...) * 100        — any float→cents conversion in frontend source
 *   parseDollarsToCents(x) ?? 0  — ONLY where the surrounding lines also contain a validity guard, because that
 *                                  is the shape that silently turns rejected input into a zero-dollar record
 *
 * Percent fields are untouched by design: the parser speaks cents, and a percentage is not money.
 * At a guarded site use `?? NaN` (so the existing guard fires) or a `== null` check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'manager-pay-web', 'customer-display'];  // manager-pay + display added Jul 29 — they were invisible to this gate (found via a live window.prompt)
const ROOT = resolve(process.cwd(), '..');
// Constitution 13: code moved into packages/ must not leave the gate's view — scan every package's src too.
for (const p of (await import('node:fs')).readdirSync(resolve(ROOT, '..', 'packages'))) APPS.push(`../packages/${p}`);
const IS_TEST = /\.(test|spec)\.[tj]sx?$/;
const FLOAT_MONEY = /parseFloat\s*\([^;]{0,120}?\)\s*(?:\|\|\s*0\s*\)?\s*)?\*\s*100/g;
const GUARDED_ZERO = /parseDollarsToCents\s*\([^)]*\)\s*\?\?\s*0/g;
const GUARD_WORDS = /isNaN|Number\.isInteger|Invalid|invalid|valid amount|is required|Enter a/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(p, out); }
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const floatSites = [];
const guardedZeros = [];

for (const app of APPS) {
  for (const file of walk(join(ROOT, app, 'src'))) {
    if (IS_TEST.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    const lines = src.split('\n');

    FLOAT_MONEY.lastIndex = 0;
    let m;
    while ((m = FLOAT_MONEY.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      floatSites.push({ rel, line, text: (lines[line - 1] || '').trim().slice(0, 120) });
    }

    GUARDED_ZERO.lastIndex = 0;
    while ((m = GUARDED_ZERO.exec(src)) !== null) {
      // Look only at the code that follows: a guard BEFORE the parse cannot be bypassed by the parse.
      const after = src.slice(m.index, m.index + 300);
      if (!GUARD_WORDS.test(after)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      guardedZeros.push({ rel, line, text: (lines[line - 1] || '').trim().slice(0, 120) });
    }
  }
}

let failed = false;

if (floatSites.length) {
  failed = true;
  console.error(`\n❌ float money parsing (${floatSites.length}):\n`);
  for (const f of floatSites) console.error(`   ${f.rel}:${f.line}  →  ${f.text}`);
  console.error('\n   Use parseDollarsToCents(x) — it rejects "1e3", "12.345" and "12abc" instead of mangling them.\n');
}

if (guardedZeros.length) {
  failed = true;
  console.error(`\n❌ "?? 0" next to a validity guard (${guardedZeros.length}) — invalid input would become $0.00:\n`);
  for (const f of guardedZeros) console.error(`   ${f.rel}:${f.line}  →  ${f.text}`);
  console.error('\n   Use "?? NaN" (so the guard below still fires) or check for null explicitly.\n');
}

if (failed) process.exit(1);
console.log('✅ money parsing — no float conversions, no guard-bypassing defaults, across every frontend and shared package.');
