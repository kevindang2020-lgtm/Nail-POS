// seasonal-trend.core.ts — detects recurring seasonality from a tenant's OWN historical series (no generic industry
// assumptions). Computes day-of-week factors (relative to the series mean) and, when enough history exists, monthly
// factors — each with the sample size behind it. Confidence degrades honestly with short history / thin samples. Pure; no
// DB, no fabricated data. A factor of 1.0 means "average day/month"; >1 busier, <1 slower.
import type { SeriesPoint } from './forecast-core';

export type TrendConfidence = 'high' | 'moderate' | 'low' | 'insufficient_data';

export interface SeasonalFactor { key: string; label: string; factor: number; sampleSize: number }
export interface SeasonalResult {
  dayOfWeek: { factors: SeasonalFactor[]; peak: SeasonalFactor | null; trough: SeasonalFactor | null; confidence: TrendConfidence };
  monthly: { factors: SeasonalFactor[]; peak: SeasonalFactor | null; trough: SeasonalFactor | null; confidence: TrendConfidence };
  historyLength: number;
  evidence: string;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function factorsFor(series: SeriesPoint[], keyOf: (d: Date) => number, labels: string[]): SeasonalFactor[] {
  const overall = mean(series.map((p) => p.value));
  if (overall <= 0) return [];
  const groups = new Map<number, number[]>();
  for (const p of series) {
    const d = new Date(p.date + 'T00:00:00.000Z');
    const k = keyOf(d);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p.value);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, vals]) => ({ key: String(k), label: labels[k], factor: round3(mean(vals) / overall), sampleSize: vals.length }));
}

const peakOf = (fs: SeasonalFactor[]) => (fs.length ? fs.reduce((a, b) => (b.factor > a.factor ? b : a)) : null);
const troughOf = (fs: SeasonalFactor[]) => (fs.length ? fs.reduce((a, b) => (b.factor < a.factor ? b : a)) : null);

function dowConfidence(series: SeriesPoint[], factors: SeasonalFactor[]): TrendConfidence {
  const weeks = series.length / 7;
  const minSample = factors.length ? Math.min(...factors.map((f) => f.sampleSize)) : 0;
  if (series.length < 14 || factors.length < 7) return 'insufficient_data';
  if (weeks >= 8 && minSample >= 6) return 'high';
  if (weeks >= 4 && minSample >= 3) return 'moderate';
  return 'low';
}

function monthlyConfidence(series: SeriesPoint[], factors: SeasonalFactor[]): TrendConfidence {
  const spanDays = series.length;
  const minSample = factors.length ? Math.min(...factors.map((f) => f.sampleSize)) : 0;
  if (spanDays < 300 || factors.length < 6) return 'insufficient_data'; // need ~a year to speak to monthly seasonality
  if (factors.length >= 12 && minSample >= 20) return 'moderate';
  return 'low';
}

export function detectSeasonality(series: SeriesPoint[]): SeasonalResult {
  const dowFactors = factorsFor(series, (d) => d.getUTCDay(), DOW);
  const monFactors = factorsFor(series, (d) => d.getUTCMonth(), MON);
  const dowConf = dowConfidence(series, dowFactors);
  const monConf = monthlyConfidence(series, monFactors);

  return {
    dayOfWeek: {
      factors: dowConf === 'insufficient_data' ? [] : dowFactors,
      peak: dowConf === 'insufficient_data' ? null : peakOf(dowFactors),
      trough: dowConf === 'insufficient_data' ? null : troughOf(dowFactors),
      confidence: dowConf,
    },
    monthly: {
      factors: monConf === 'insufficient_data' ? [] : monFactors,
      peak: monConf === 'insufficient_data' ? null : peakOf(monFactors),
      trough: monConf === 'insufficient_data' ? null : troughOf(monFactors),
      confidence: monConf,
    },
    historyLength: series.length,
    evidence: `Based on ${series.length} day(s) of this branch's own history.`,
  };
}
