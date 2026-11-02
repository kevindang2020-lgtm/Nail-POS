// ai-dod-tests-predicate.mjs — the "Tests pass" line of audit-ai-dod.mjs (Constitution 10 §304), as a pure function so
// its rule is tested (src/common/ai-dod-tests-predicate.vitest.spec.ts). BUILD_PLAN Phase 15.
//
// The old predicate was `/Tests\s+\d+ passed/ && !/skipped/` over vitest's text output: ANY skipped test failed the
// line. modules/ai holds real-Postgres race files (*.postgres-race.vitest.spec.ts) that skip unless PG_RACE_URL is set —
// by design: PGlite cannot show a race, so they run in the race lane (tooling/ci/run-race-tests.mjs, `npm run
// ci:test:race` on every push), which itself FAILS on any skip. The line therefore read NOT DONE on a green suite.
//
// The rule now, over vitest's JSON report (--reporter=json):
//   • at least one test passed (a run that collects nothing is not a pass — Constitution 13 moved files once);
//   • no test and no file failed;
//   • a skipped / pending / todo test is allowed ONLY inside a *.postgres-race.vitest.spec.ts file, and only when the race
//     lane covers this package (it discovers modules/<m>/src and the package has a vitest config) — so the skip is
//     somebody else's run, not an unproven claim. A skip anywhere else still fails the line.
export const RACE_SUFFIX = '.postgres-race.vitest.spec.ts';

/**
 * @param {any} report vitest JSON report (jest-compatible shape: testResults[].name / status / assertionResults[].status)
 * @param {{ raceLaneCovers: boolean }} opts whether tooling/ci/run-race-tests.mjs runs this package's race files
 * @returns {{ ok: boolean, why: string, passed: number, raceSkipped: number, raceFiles: number }}
 */
export function judgeTestsPass(report, { raceLaneCovers }) {
  const files = Array.isArray(report?.testResults) ? report.testResults : [];
  let passed = 0, raceSkipped = 0; const raceFiles = new Set(); const badSkips = []; const failed = [];
  for (const f of files) {
    const name = String(f.name ?? '');
    const isRace = name.endsWith(RACE_SUFFIX);
    if (f.status === 'failed') failed.push(name);
    for (const a of f.assertionResults ?? []) {
      if (a.status === 'passed') passed++;
      else if (a.status === 'failed') failed.push(`${name} › ${a.fullName ?? a.title ?? '?'}`);
      else if (isRace) { raceSkipped++; raceFiles.add(name); }
      else badSkips.push(`${name} › ${a.fullName ?? a.title ?? '?'} (${a.status})`);
    }
  }
  const base = { passed, raceSkipped, raceFiles: raceFiles.size };
  if (!files.length || passed === 0) return { ok: false, why: 'no test ran (an empty run is not a pass)', ...base };
  if (failed.length) return { ok: false, why: `${failed.length} failing: ${failed.slice(0, 3).join('; ')}`, ...base };
  if (badSkips.length) return { ok: false, why: `${badSkips.length} skipped outside the race lane: ${badSkips.slice(0, 3).join('; ')}`, ...base };
  if (raceSkipped && !raceLaneCovers) return { ok: false, why: `${raceSkipped} race tests skipped and the race lane does not run this package`, ...base };
  return { ok: true, why: `${passed} passed; ${raceSkipped} real-Postgres race tests in ${raceFiles.size} files run in the race lane (ci:test:race), not here`, ...base };
}

/** does tooling/ci/run-race-tests.mjs (source text) discover race files in modules/<m>, and does <m> have a vitest config? */
export function raceLaneCoversModule(runnerSource, moduleHasVitestConfig) {
  return moduleHasVitestConfig
    && /readdirSync\(join\(ROOT, 'modules'\)\)/.test(runnerSource)
    && /\.postgres-race\.vitest\.spec\.ts/.test(runnerSource)
    && /nSkipped > 0/.test(runnerSource);   // the lane itself refuses skips — otherwise a skip there would be a skip everywhere
}
