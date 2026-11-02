#!/usr/bin/env node
// run-race-tests.mjs — the real-PostgreSQL concurrency tests (*.postgres-race.vitest.spec.ts) in CI.
//
// WHY: PGlite is one session, so it cannot show a race — a missing row lock passes there. These 27+ files race real
// connections against real Postgres (deterministic gates: hold a table lock, let N callers pile up, release) and are
// the ONLY tests that prove "two stations, one payment", "one hold per session", "one redemption" and friends. Until
// Oct 4 2026 none of them ran in CI: they skip unless PG_RACE_URL is set, and no workflow set it. That is how the
// gift-card / split double-debit went unseen.
//
// HOW: discovers every race file under apps/api/src and modules/*/src, runs each package's files with vitest, and
// FAILS — never passes quietly — when:
//   • PG_RACE_URL is not set (the whole lane would otherwise "pass" by skipping everything);
//   • any file fails, or any test inside these files is SKIPPED (a skipped race test is an unproven claim);
//   • no race file is found (a moved directory must not turn the lane green).
// Requires a MIGRATED database at PG_RACE_URL (CI: `npm run db:migrate` with DATABASE_URL pointing at it first).
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.PG_RACE_URL) { console.error('run-race-tests: PG_RACE_URL is not set — refusing to report a lane of skipped tests as passing.'); process.exit(1); }

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.postgres-race.vitest.spec.ts')) out.push(p);
  }
  return out;
}
const packages = [join(ROOT, 'apps', 'api'), ...readdirSync(join(ROOT, 'modules')).map((m) => join(ROOT, 'modules', m))]
  .filter((p) => existsSync(join(p, 'src')) && existsSync(join(p, 'vitest.config.ts')));
const plan = packages.map((pkg) => ({ pkg, files: walk(join(pkg, 'src')).map((f) => relative(pkg, f)) })).filter((x) => x.files.length);
const total = plan.reduce((a, x) => a + x.files.length, 0);
if (!total) { console.error('run-race-tests: found no *.postgres-race.vitest.spec.ts files — refusing to pass an empty lane.'); process.exit(1); }

let failed = false; let files = 0, tests = 0, skipped = 0;
for (const { pkg, files: f } of plan) {
  // --no-file-parallelism (Oct 22 2026, sixth run): every file of a package shares ONE real database, and platform-wide
  // jobs under test scan it whole — payment-attempt-sweep's sweep (its fake processor answering "no such refund") picked
  // up refund-race's lost refund mid-test and parked it for review, so refund-race's own ten sweepers settled nothing.
  // In production the sweep is single-owner (the scheduler lease); here the FILES are the concurrency, so they take turns.
  // Each file still races itself — that is the point of the lane.
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', ...f], { cwd: pkg, encoding: 'utf8', env: process.env });
  const out = (r.stdout || '') + (r.stderr || '');
  const tf = /Test Files\s+(.*)/.exec(out)?.[1] ?? '?'; const ts = /Tests\s+(.*)/.exec(out)?.[1] ?? '?';
  const nPassed = Number(/(\d+) passed/.exec(ts)?.[1] || 0); const nSkipped = Number(/(\d+) skipped/.exec(ts)?.[1] || 0);
  files += f.length; tests += nPassed; skipped += nSkipped;
  const bad = r.status !== 0 || nSkipped > 0 || nPassed === 0;
  console.log(`${bad ? 'FAIL' : 'PASS'}  ${relative(ROOT, pkg).padEnd(22)} files: ${tf}   tests: ${ts}`);
  if (bad) { failed = true; if (r.status !== 0) console.log(out.split('\n').filter((l) => /FAIL|×|Error|expected/.test(l)).slice(0, 15).join('\n')); }
}
console.log(`\nrace lane: ${files} files, ${tests} tests passed, ${skipped} skipped across ${plan.length} packages`);
process.exit(failed ? 1 : 0);
