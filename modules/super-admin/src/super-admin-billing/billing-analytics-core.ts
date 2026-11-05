// billing-analytics-core.ts — pure metric formulas with documented denominators. No I/O.

export interface RateResult { rate: number; numerator: number; denominator: number }

// Payment recovery rate: previously-failed obligations that were later recovered ÷ eligible failed obligations.
// A recovery MUST be tied to a prior failed obligation (the caller only passes attempts carrying recovered_from_status),
// so an unrelated new payment is never counted as a recovery.
export function recoveredRate(eligibleFailed: number, recovered: number): RateResult {
  if (eligibleFailed <= 0) return { rate: 0, numerator: 0, denominator: 0 };
  return { rate: Math.round((recovered / eligibleFailed) * 1000) / 10, numerator: recovered, denominator: eligibleFailed };
}

// Trial → paid conversion: tenants that converted to a paid subscription during the window ÷ eligible trials that
// reached a conversion decision in that window. Unrelated cohorts are not mixed (caller scopes the window).
export function trialConversionRate(eligibleTrials: number, converted: number): RateResult {
  if (eligibleTrials <= 0) return { rate: 0, numerator: 0, denominator: 0 };
  return { rate: Math.round((converted / eligibleTrials) * 1000) / 10, numerator: converted, denominator: eligibleTrials };
}

// Bucket dated rows into the last `weeks` ISO-week buckets ending today. Each row: { at: Date-ish, failed, recovered }.
export function weeklyFailedRecovered(rows: { at: string | Date; failed: number; recovered: number }[], weeks = 5, now = new Date()): { week: string; failed: number; recovered: number }[] {
  const buckets: { week: string; failed: number; recovered: number }[] = [];
  const msWeek = 7 * 86400000;
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * msWeek);
    const start = new Date(end.getTime() - msWeek);
    const label = `Week ${weeks - i}`;
    let failed = 0, recovered = 0;
    for (const r of rows) {
      const t = new Date(r.at).getTime();
      if (t > start.getTime() && t <= end.getTime()) { failed += r.failed || 0; recovered += r.recovered || 0; }
    }
    buckets.push({ week: label, failed, recovered });
  }
  return buckets;
}
