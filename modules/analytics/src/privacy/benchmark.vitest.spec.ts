// Constitution 7 §107 — privacy-safe benchmarks.
import { describe, it, expect } from 'vitest';
import { privacySafeBenchmark, MIN_BENCHMARK_COHORT } from './benchmark';

const cohort = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, (i + 1) * 10]));

describe('privacySafeBenchmark', () => {
  it('below the minimum cohort nothing is revealed — not even a mean', () => {
    const b = privacySafeBenchmark(cohort(4), null);
    expect(b).toEqual({ suppressed: true, reason: 'cohort_too_small', cohortSize: 4, minCohort: MIN_BENCHMARK_COHORT });
    expect(JSON.stringify(b)).not.toMatch(/mean|median|t0/);
  });
  it("the viewer's own figure is excluded from its cohort, so 5 salons incl. me is a cohort of 4 → suppressed", () => {
    expect(privacySafeBenchmark(cohort(5), 't0')).toMatchObject({ suppressed: true, cohortSize: 4 });
    expect(privacySafeBenchmark(cohort(6), 't0')).toMatchObject({ suppressed: false, cohortSize: 5 });
  });
  it('returns aggregates only — no tenant ids and no individual values', () => {
    const b = privacySafeBenchmark(cohort(6), null) as any;
    expect(b).toEqual({ suppressed: false, cohortSize: 6, mean: 35, median: 35, p25: 22.5, p75: 47.5 });
    expect(Object.keys(b).sort()).toEqual(['cohortSize', 'mean', 'median', 'p25', 'p75', 'suppressed']);
  });
  it('a caller may raise the floor but never lower it; non-finite values do not count', () => {
    expect(privacySafeBenchmark(cohort(6), null, { minCohort: 2 })).toMatchObject({ suppressed: false });
    expect(privacySafeBenchmark(cohort(4), null, { minCohort: 2 })).toMatchObject({ suppressed: true, minCohort: 5 });
    expect(privacySafeBenchmark(cohort(6), null, { minCohort: 10 })).toMatchObject({ suppressed: true, minCohort: 10 });
    expect(privacySafeBenchmark({ ...cohort(4), x: NaN, y: Infinity }, null)).toMatchObject({ suppressed: true, cohortSize: 4 });
  });
});
