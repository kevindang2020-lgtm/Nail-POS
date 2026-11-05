// ai-dod-tests-predicate — Constitution 10 §304 "Tests pass" (scripts/audit-ai-dod.mjs), BUILD_PLAN Phase 15.
// The old predicate failed the line on ANY skipped test, so the real-Postgres race files in modules/ai (which skip unless
// PG_RACE_URL is set, and run in the race lane instead) kept a green suite at NOT DONE. The rule now: skips are allowed
// only in *.postgres-race.vitest.spec.ts files of a package the race lane runs; everything else that skips, fails, or
// collects nothing fails the line.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs script module, no types
import { judgeTestsPass, raceLaneCoversModule, RACE_SUFFIX } from '../../scripts/ai-dod-tests-predicate.mjs';

const ROOT = join(__dirname, '..', '..', '..', '..');
const file = (name: string, ...statuses: string[]) => ({
  name: `/repo/modules/ai/src/${name}`, status: statuses.includes('failed') ? 'failed' : 'passed',
  assertionResults: statuses.map((s, i) => ({ status: s, title: `t${i}`, fullName: `${name} t${i}` })),
});
const report = (...files: any[]) => ({ testResults: files });
const covered = { raceLaneCovers: true };

describe('audit-ai-dod "Tests pass" predicate', () => {
  it('passes a green suite with no skips', () => {
    expect(judgeTestsPass(report(file('a.vitest.spec.ts', 'passed', 'passed')), covered).ok).toBe(true);
  });

  it('passes when the ONLY skips are real-Postgres race files the race lane runs (the C10 case)', () => {
    const r = judgeTestsPass(report(
      file('a.vitest.spec.ts', 'passed'),
      file(`x/queue${RACE_SUFFIX}`, 'skipped', 'skipped'),
      file(`y/sched${RACE_SUFFIX}`, 'pending'),
    ), covered);
    expect(r).toMatchObject({ ok: true, passed: 1, raceSkipped: 3, raceFiles: 2 });
  });

  it('fails a skip outside a race file', () => {
    const r = judgeTestsPass(report(file('a.vitest.spec.ts', 'passed', 'skipped')), covered);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/skipped outside the race lane/);
  });

  it('fails a todo outside a race file', () => {
    expect(judgeTestsPass(report(file('a.vitest.spec.ts', 'passed', 'todo')), covered).ok).toBe(false);
  });

  it('fails race skips when the race lane does not run this package', () => {
    const r = judgeTestsPass(report(file('a.vitest.spec.ts', 'passed'), file(`q${RACE_SUFFIX}`, 'skipped')), { raceLaneCovers: false });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/race lane does not run this package/);
  });

  it('fails any failing test, even with race skips around it', () => {
    expect(judgeTestsPass(report(file('a.vitest.spec.ts', 'passed', 'failed'), file(`q${RACE_SUFFIX}`, 'skipped')), covered).ok).toBe(false);
  });

  it('fails a file that failed to load (no assertions, status failed)', () => {
    expect(judgeTestsPass(report(file('a.vitest.spec.ts', 'passed'), { name: '/repo/b.vitest.spec.ts', status: 'failed', assertionResults: [] }), covered).ok).toBe(false);
  });

  it('fails an empty run and a run where everything skipped (vacuous pass)', () => {
    expect(judgeTestsPass(report(), covered).ok).toBe(false);
    expect(judgeTestsPass({}, covered).ok).toBe(false);
    expect(judgeTestsPass(report(file(`q${RACE_SUFFIX}`, 'skipped')), covered).ok).toBe(false);
  });

  it('a file named like a race file only by prefix is not a race file', () => {
    expect(judgeTestsPass(report(file('a.vitest.spec.ts', 'passed'), file('postgres-race.helper.vitest.spec.ts', 'skipped')), covered).ok).toBe(false);
  });
});

describe('the race lane really covers modules/ai, and the script uses this predicate', () => {
  it('run-race-tests.mjs discovers modules/*, refuses skips, and modules/ai has a vitest config', () => {
    const runner = readFileSync(join(ROOT, 'tooling/ci/run-race-tests.mjs'), 'utf8');
    expect(raceLaneCoversModule(runner, existsSync(join(ROOT, 'modules/ai/vitest.config.ts')))).toBe(true);
    expect(raceLaneCoversModule(runner.replace('nSkipped > 0', 'false'), true)).toBe(false);
    expect(raceLaneCoversModule(runner, false)).toBe(false);
  });

  it('audit-ai-dod.mjs judges "Tests pass" with judgeTestsPass over a JSON report of modules/ai', () => {
    const src = readFileSync(join(ROOT, 'apps/api/scripts/audit-ai-dod.mjs'), 'utf8');
    const line = src.split('\n').find((l) => l.includes("['Tests pass'")) ?? '';
    expect(line).toMatch(/judgeTestsPass/);
    expect(src).toMatch(/--reporter=json/);
    expect(line).not.toMatch(/!\/skipped\//);
  });
});
