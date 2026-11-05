// anomaly-detect.core.ts — flags recent business anomalies (sudden drops/spikes) by comparing recent actuals against a
// day-of-week seasonal BASELINE built from the tenant's own history, scored as a z-score against the residual spread.
// Deliberately NEUTRAL: it reports "actual vs expected range" with possible operational explanations and a severity — it
// never asserts fraud or employee misconduct, and it never triggers an action. Pure; no DB, no fabricated data.
import type { SeriesPoint } from './forecast-core';

export type AnomalySeverity = 'informational' | 'low' | 'moderate' | 'high' | 'critical';
export type AnomalyConfidence = 'high' | 'moderate' | 'low' | 'insufficient_data';

export interface Anomaly {
  date: string;
  actual: number;
  expected: number;
  lower: number;
  upper: number;
  deviation: number;       // actual − expected
  zScore: number;
  direction: 'drop' | 'spike';
  severity: AnomalySeverity;
  possibleExplanations: string[];
}
export interface AnomalyResult {
  anomalies: Anomaly[];
  confidence: AnomalyConfidence;
  historyLength: number;
  windowDays: number;
  note: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stddev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Neutral, non-accusatory explanations — the human verifies before acting.
const DROP = ['a temporary or holiday closure', 'reduced staffing or availability', 'a booking-channel issue', 'a delay in reported data', 'a genuine dip in demand'];
const SPIKE = ['a promotion or local event', 'a large group booking', 'walk-in surge', 'duplicate or reprocessed records', 'a genuine increase in demand'];

function severityFor(z: number): AnomalySeverity {
  const a = Math.abs(z);
  if (a >= 4) return 'critical';
  if (a >= 3) return 'high';
  if (a >= 2.5) return 'moderate';
  if (a >= 2) return 'low';
  return 'informational';
}

export function detectAnomalies(series: SeriesPoint[], windowDays = 14, z = 2): AnomalyResult {
  const n = series.length;
  const confidence: AnomalyConfidence =
    n < 21 ? 'insufficient_data' : n >= 84 ? 'high' : n >= 42 ? 'moderate' : 'low';
  if (confidence === 'insufficient_data') {
    return { anomalies: [], confidence, historyLength: n, windowDays, note: 'Not enough history to detect anomalies reliably (need at least 21 days).' };
  }

  // Day-of-week seasonal baseline + residual spread across the whole history.
  const byDow = new Map<number, number[]>();
  for (const p of series) {
    const d = new Date(p.date + 'T00:00:00.000Z').getUTCDay();
    (byDow.get(d) ?? byDow.set(d, []).get(d)!).push(p.value);
  }
  const dowMean = new Map<number, number>();
  for (const [d, vals] of byDow) dowMean.set(d, mean(vals));
  const residuals = series.map((p) => p.value - (dowMean.get(new Date(p.date + 'T00:00:00.000Z').getUTCDay()) ?? 0));
  const sigma = stddev(residuals);

  const anomalies: Anomaly[] = [];
  if (sigma > 0) {
    for (const p of series.slice(-windowDays)) {
      const dow = new Date(p.date + 'T00:00:00.000Z').getUTCDay();
      const expected = dowMean.get(dow) ?? 0;
      const zi = (p.value - expected) / sigma;
      if (Math.abs(zi) >= z) {
        const direction = zi < 0 ? 'drop' : 'spike';
        anomalies.push({
          date: p.date, actual: p.value, expected: r2(expected),
          lower: r2(Math.max(0, expected - z * sigma)), upper: r2(expected + z * sigma),
          deviation: r2(p.value - expected), zScore: r2(zi), direction, severity: severityFor(zi),
          possibleExplanations: direction === 'drop' ? DROP : SPIKE,
        });
      }
    }
  }
  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  return {
    anomalies, confidence, historyLength: n, windowDays,
    note: anomalies.length === 0 ? 'No anomalies detected in the recent window — recent activity is within the expected range.' : `${anomalies.length} point(s) fell outside the expected range in the last ${windowDays} days.`,
  };
}
