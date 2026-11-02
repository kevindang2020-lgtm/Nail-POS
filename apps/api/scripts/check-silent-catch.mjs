#!/usr/bin/env node
// check-silent-catch.mjs — Oct 19 audit item ("booking-guard reads fail closed, plus check:silent-catch"), rebuilt Oct 21 2026.
//
// A guard decides whether money moves or a slot is taken. A guard READ whose error is swallowed into [] / null /
// undefined / false decides "nothing in the way" when the database said nothing at all — it fails OPEN: the POS booking
// conflict re-check answered "no appointments today" on a database error and let a double-booking through to the last
// line (the overlap constraint, which knows nothing of buffers). This gate FAILS on a swallowing catch in a GUARD file:
//
//   G1  `.catch(() => <empty>)` / `catch { }` / `catch { return <empty> }` in a file whose path says guard, conflict,
//       hold, slot, eligib or lock under modules/booking, modules/appointments, modules/workforce/src/eligibility,
//       modules/checkout/src/checkout/checkout-lock*, modules/payments/src/payments/payment-gateway.resolver.ts
//
// and RATCHETS the count everywhere else (silent-catch.baseline.json: per-file counts that may only shrink), so a new
// swallowed error in any module is a finding, and an old one that is removed lowers the baseline on the next --update.
// A guard-file exception lives in silent-catch.allowlist.json ({ file, line-text, reason }) — a release / refresh of a
// hold that is best-effort by design, say — and an entry that no longer matches FAILS.
// Run: npm run check:silent-catch (apps/api) — part of tooling/ci/run-gates.mjs. `--update` rewrites the baseline.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE = join(ROOT, 'apps/api/scripts/silent-catch.baseline.json');
const ALLOWLIST = join(ROOT, 'apps/api/scripts/silent-catch.allowlist.json');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);
const IS_TEST = /\.(test|spec)\.[cm]?[tj]sx?$|\.pgtest\.|\.postgres-race\.|test-support|testing/;
const GUARD_ROOTS = ['modules/booking/src', 'modules/appointments/src', 'modules/workforce/src/eligibility', 'modules/checkout/src/checkout/checkout-lock'];
const GUARD_NAME = /guard|conflict|hold|slot|eligib|lock/i;
/** repositories that mix guard reads with ordinary ones: only these METHODS are guard scope */
const GUARD_METHODS = {
  'modules/booking/src/booking/booking.kysely.repository.ts': /^\s+(private )?async (existingForConflict|existingForDate|lockedHoldCheck|holdsAt|create|update|reschedule)\(/,
  'modules/booking/src/customer-booking/customer-booking.kysely.repository.ts': /^\s+(private )?async (existingForDate|insertBookingAtomic|doInsertBookingAtomic|rescheduleAtomic|getService)\(/,
  'modules/payments/src/payments/payment-gateway.resolver.ts': /^\s+(private )?async (resolve|resolveTerminalConfig|build)\(/,
};
const METHOD_END = /^  \}/;
const SWALLOW = /\.catch\(\s*\(\s*(_?\w*)?\s*\)\s*=>\s*(undefined|null|\[\]|\{\}|false|0)\s*\)|catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^*]*\*\/\s*)?\}|catch\s*(\([^)]*\))?\s*\{\s*return\s*(undefined|null|\[\]|\{\}|false|0)?\s*;?\s*\}/;

function* files(dir) {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* files(p); else if (/\.ts$/.test(e) && !e.endsWith('.d.ts') && !IS_TEST.test(p)) yield p;
  }
}
const roots = [];
for (const base of ['modules']) for (const d of readdirSync(join(ROOT, base))) { const src = join(ROOT, base, d, 'src'); if (existsSync(src)) roots.push(src); }
roots.push(join(ROOT, 'apps/api/src'));

const update = process.argv.includes('--update');
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')).entries : [];
const used = new Set(); const guardFindings = []; const ratchetFindings = []; const counts = {};
for (const root of roots) for (const f of files(root)) {
  const rel = relative(ROOT, f);
  const lines = readFileSync(f, 'utf8').split('\n');
  const fileGuard = GUARD_ROOTS.some((g) => rel.startsWith(g)) && GUARD_NAME.test(rel.split('/').pop());
  const methodRule = GUARD_METHODS[rel];
  let n = 0; let inGuardMethod = false;
  lines.forEach((raw, i) => {
    if (methodRule) { if (methodRule.test(raw)) inGuardMethod = true; else if (METHOD_END.test(raw)) inGuardMethod = false; }
    const l = raw.replace(/\/\/.*$/, '');
    if (!SWALLOW.test(l)) return;
    n++;
    if (fileGuard || (methodRule && inGuardMethod)) {
      // an entry names the line's text, and optionally a `near` text that must appear within the 6 lines above (two identical lines in one file)
      const k = allow.findIndex((a) => a.file === rel && raw.includes(a.lineText) && (!a.near || lines.slice(Math.max(0, i - 6), i).some((x) => x.includes(a.near))));
      if (k >= 0) { used.add(k); return; }
      guardFindings.push(`${rel}:${i + 1}  ${raw.trim().slice(0, 140)}`);
    }
  });
  if (n) counts[rel] = n;
}
if (update) { writeFileSync(BASELINE, JSON.stringify(counts, null, 1) + '\n'); console.log(`silent-catch: baseline written — ${Object.values(counts).reduce((a, b) => a + b, 0)} swallowed catch(es) in ${Object.keys(counts).length} files`); process.exit(0); }
for (const [rel, n] of Object.entries(counts)) { const b = base[rel] ?? 0; if (n > b) ratchetFindings.push(`${rel}: ${n} swallowed catch(es), baseline ${b}`); }
const stale = allow.filter((_, k) => !used.has(k)).map((a) => `${a.file} — "${a.lineText}" no longer matches; remove it`);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (guardFindings.length || ratchetFindings.length || stale.length) {
  if (guardFindings.length) { console.error(`\n❌ ${guardFindings.length} swallowed error(s) in GUARD code (a guard read that fails open):\n`); for (const x of guardFindings) console.error('   ' + x); }
  if (ratchetFindings.length) { console.error(`\n❌ new swallowed catch(es) above the baseline (remove them, or node apps/api/scripts/check-silent-catch.mjs --update after review):\n`); for (const x of ratchetFindings) console.error('   ' + x); }
  if (stale.length) { console.error('\n❌ stale allowlist entries:\n'); for (const x of stale) console.error('   ' + x); }
  process.exit(1);
}
console.log(`✅ silent-catch — guard code swallows nothing (${allow.length} reviewed); ${total} swallowed catch(es) elsewhere, none above the baseline`);
