// benchmark.ts — Constitution 7 §105 / §107: the ONLY shape in which figures from several tenants may be shown to a
// tenant ("salons like yours average …"). Aggregates only — count, mean, median, quartiles — never a single tenant's
// value, never the list, and nothing at all below a minimum cohort (k-anonymity: with 2 peers, "the average" plus your
// own figure reveals the other salon's). The viewer's own value is EXCLUDED from its cohort before aggregating.
//
// Today no tenant-facing report compares salons (measured Sep 28 2026: the only "peer" comparisons — money-protection
// baselines — are staff within one tenant). This is the rule any future benchmark must use; the tenant-isolation static
// test already refuses an unscoped cross-tenant query in tenant-facing code outside its reviewed allowlist.
export const MIN_BENCHMARK_COHORT = 5;

export type Benchmark =
  | { suppressed: true; reason: 'cohort_too_small'; cohortSize: number; minCohort: number }
  | { suppressed: false; cohortSize: number; mean: number; median: number; p25: number; p75: number };

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const round = (n: number, dp: number) => { const f = 10 ** dp; return Math.round(n * f) / f; };

/**
 * @param perTenant one figure per tenant (tenantId → value); non-finite values are ignored
 * @param viewerTenantId the tenant who will SEE the benchmark — its own figure never counts toward its cohort
 */
export function privacySafeBenchmark(perTenant: ReadonlyMap<string, number> | Record<string, number>, viewerTenantId: string | null,
    opts: { minCohort?: number; decimals?: number } = {}): Benchmark {
  const minCohort = Math.max(MIN_BENCHMARK_COHORT, opts.minCohort ?? MIN_BENCHMARK_COHORT);   // a caller can raise the floor, never lower it
  const entries = perTenant instanceof Map ? [...perTenant.entries()] : Object.entries(perTenant);
  const values = entries.filter(([id, v]) => id !== viewerTenantId && Number.isFinite(v)).map(([, v]) => v).sort((a, b) => a - b);
  if (values.length < minCohort) return { suppressed: true, reason: 'cohort_too_small', cohortSize: values.length, minCohort };
  const dp = opts.decimals ?? 2;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { suppressed: false, cohortSize: values.length, mean: round(mean, dp), median: round(quantile(values, 0.5), dp), p25: round(quantile(values, 0.25), dp), p75: round(quantile(values, 0.75), dp) };
}
