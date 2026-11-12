#!/usr/bin/env node
// run-tests.mjs — Constitution 13 Phase 11: the test suites run in CI on every push, read at the FILE level.
//
//   node tooling/ci/run-tests.mjs api       the API's vitest suite
//   node tooling/ci/run-tests.mjs modules   every modules/<m> with a vitest config
//   node tooling/ci/run-tests.mjs apps      every frontend app with a vitest config
//   node tooling/ci/run-tests.mjs packages  every packages/<p> with a vitest config
//
// Until now CI ran the security lane and the architecture test only; the ~10,000 API, module and app tests ran by hand.
// A test FILE that fails to load drops its tests from "Tests N passed" instead of failing them — two such files hid for
// several commits in this arc — so this fails on any "FAIL" file line, not just on a failed test.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = process.argv[2];
const dirs = target === 'api' ? [join(ROOT, 'apps', 'api')]
  : target === 'modules' ? readdirSync(join(ROOT, 'modules')).map((m) => join(ROOT, 'modules', m))
  : target === 'apps' ? readdirSync(join(ROOT, 'apps')).filter((a) => a !== 'api').map((a) => join(ROOT, 'apps', a))
  // Oct 6 2026: the foundation packages' own tests (single-flight refresh, realtime client, tenant context, …) never ran
  // in CI — one had been failing since Constitution 7 added `restriction` to the context and nobody saw it.
  : target === 'packages' ? readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p))
  : null;
if (!dirs) { console.error('usage: run-tests.mjs api|modules|apps|packages'); process.exit(2); }

const failed = [];
for (const d of dirs) {
  if (!['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js'].some((c) => existsSync(join(d, c)))) continue;
  // TZ=UTC: the server code assumes the process runs in UTC (as production and CI do) — membership renewal dates,
  // reminder dates and the billing catch-up use local-time Date methods, and node-postgres/PGlite read DATE columns as
  // local midnight. On a machine set to another zone (a developer in New York) seven tests (six module, one app)
  // failed for that reason alone; run the suites in the zone the code is deployed in (DUAL_SCREEN_DISPLAY_AUDIT.md D).
  const r = spawnSync('npx', ['vitest', 'run'], { cwd: d, encoding: 'utf8', timeout: 2_700_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, TZ: 'UTC' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const files = (out.match(/^\s*Test Files[^\n]*/m) || ['(no summary)'])[0].trim();
  const tests = (out.match(/^\s*Tests\s[^\n]*/m) || [''])[0].trim();
  const fileFails = [...new Set(out.split('\n').filter((l) => /^ FAIL /.test(l)).map((l) => l.trim().slice(0, 160)))];
  const ok = r.status === 0 && fileFails.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${d.slice(ROOT.length + 1)}: ${files} | ${tests}`);
  if (!ok) { failed.push(d.slice(ROOT.length + 1)); for (const l of fileFails.slice(0, 10)) console.log('      ' + l); }
}
console.log(failed.length ? `\n${failed.length} FAILED: ${failed.join(', ')}` : '\nall suites passed');
process.exit(failed.length ? 1 : 0);
