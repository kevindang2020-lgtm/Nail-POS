// ai-scheduling-stats.ts — PURE robust statistics + utilization + the controlled duration hierarchy. Two disciplines the
// spec insists on: (1) never rely on a plain average — use median/percentiles/trimmed-mean/variance and reject outliers,
// and only over VALID records (incomplete/test/canceled/corrupted/manually-incorrect are excluded); (2) historical
// duration is a SUGGESTION for review — it never auto-overrides approved configuration in the resolver.

// ── valid-record filtering ────────────────────────────────────────────────────
export interface DurationRecord { actualMin: number; completed: boolean; isTest?: boolean; canceled?: boolean; corrupted?: boolean; manuallyEdited?: boolean; }
/** Keep only durations we can trust: completed, real, non-canceled, non-corrupted, and physically plausible. */
export function validDurations(records: DurationRecord[], opts: { maxPlausibleMin?: number } = {}): number[] {
  const max = opts.maxPlausibleMin ?? 600;
  return records
    .filter((r) => r.completed && !r.isTest && !r.canceled && !r.corrupted && !r.manuallyEdited)
    .map((r) => r.actualMin)
    .filter((m) => Number.isFinite(m) && m > 0 && m <= max);
}

// ── robust statistics ─────────────────────────────────────────────────────────
export interface DurationStats { n: number; median: number; p25: number; p75: number; p90: number; trimmedMean: number; stddev: number; min: number; max: number; outliers: number[]; }
const percentile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

export function robustDurationStats(values: number[]): DurationStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return { n: 0, median: 0, p25: 0, p75: 0, p90: 0, trimmedMean: 0, stddev: 0, min: 0, max: 0, outliers: [] };
  const p25 = percentile(sorted, 0.25), p75 = percentile(sorted, 0.75);
  const iqr = p75 - p25;
  const lowFence = p25 - 1.5 * iqr, highFence = p75 + 1.5 * iqr;
  const outliers = sorted.filter((x) => x < lowFence || x > highFence);
  const inliers = sorted.filter((x) => x >= lowFence && x <= highFence);
  const trimmedMean = inliers.length ? Math.round(inliers.reduce((a, b) => a + b, 0) / inliers.length) : 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const stddev = Math.round(Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n));
  return { n, median: Math.round(percentile(sorted, 0.5)), p25: Math.round(p25), p75: Math.round(p75), p90: Math.round(percentile(sorted, 0.9)), trimmedMean, stddev, min: sorted[0], max: sorted[n - 1], outliers };
}

export type DurationAction = 'increase' | 'decrease' | 'add_buffer' | 'keep';
export interface DurationSuggestion { action: DurationAction; suggestedMin: number; reason: string; confidence: number; sampleSize: number; }
/** Advisory only — suggests a change for authorized review; never applied automatically. */
export function suggestDuration(currentMin: number, stats: DurationStats): DurationSuggestion {
  if (stats.n < 8) return { action: 'keep', suggestedMin: currentMin, reason: 'insufficient_sample', confidence: 0.3, sampleSize: stats.n };
  const target = stats.median;
  const highVariance = stats.stddev > target * 0.35;
  if (highVariance) return { action: 'add_buffer', suggestedMin: currentMin + Math.round(stats.p75 - target), reason: 'high_duration_variance', confidence: 0.6, sampleSize: stats.n };
  if (target > currentMin * 1.15) return { action: 'increase', suggestedMin: target, reason: 'services_run_longer_than_configured', confidence: 0.75, sampleSize: stats.n };
  if (target < currentMin * 0.85) return { action: 'decrease', suggestedMin: target, reason: 'services_run_shorter_than_configured', confidence: 0.7, sampleSize: stats.n };
  return { action: 'keep', suggestedMin: currentMin, reason: 'configured_duration_matches_history', confidence: 0.8, sampleSize: stats.n };
}

// ── utilization ───────────────────────────────────────────────────────────────
// Phase 7: the second utilization formula that lived here (booked ÷ eligible with its own risk flags) is gone. There is
// ONE rule — the workforce module's canonical computeUtilization — mirrored by ai-scheduling-day.ts utilizationPct.

// ── controlled duration hierarchy ─────────────────────────────────────────────
export type DurationSource = 'appointment_override' | 'technician_specific' | 'branch_specific' | 'tenant_template' | 'platform_fallback';
export interface DurationHierarchy { appointmentOverrideMin?: number | null; technicianSpecificMin?: number | null; branchSpecificMin?: number | null; tenantTemplateMin?: number | null; platformFallbackMin?: number; }
/** Resolve the EFFECTIVE duration by controlled precedence. Historical suggestion is deliberately NOT a source here —
 *  it surfaces via suggestDuration() for review and never silently overrides approved configuration. */
export function resolveDuration(h: DurationHierarchy): { durationMin: number; source: DurationSource } {
  if (h.appointmentOverrideMin != null) return { durationMin: h.appointmentOverrideMin, source: 'appointment_override' };
  if (h.technicianSpecificMin != null) return { durationMin: h.technicianSpecificMin, source: 'technician_specific' };
  if (h.branchSpecificMin != null) return { durationMin: h.branchSpecificMin, source: 'branch_specific' };
  if (h.tenantTemplateMin != null) return { durationMin: h.tenantTemplateMin, source: 'tenant_template' };
  return { durationMin: h.platformFallbackMin ?? 30, source: 'platform_fallback' };
}
