// anomaly-detect.core.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { detectAnomalies } from './anomaly-detect.core';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[], start = '2026-01-04'): SeriesPoint[] => {
  const d0 = new Date(start + 'T00:00:00.000Z').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [10, 12, 14, 16, 20, 30, 40][i % 7]);

describe('detectAnomalies', () => {
  it('flags a sudden drop in the recent window with a drop direction + neutral explanations', () => {
    const v = weekly(56);
    v[v.length - 2] = 1; // near-zero on a normally busy day → drop
    const r = detectAnomalies(series(v));
    expect(r.anomalies.length).toBeGreaterThanOrEqual(1);
    const a = r.anomalies[0];
    expect(a.direction).toBe('drop');
    expect(['moderate', 'high', 'critical']).toContain(a.severity);
    expect(a.possibleExplanations.join(' ')).not.toMatch(/fraud|theft|misconduct|stealing/i);
  });

  it('flags a spike', () => {
    const v = weekly(56);
    v[v.length - 3] = 200;
    const r = detectAnomalies(series(v));
    expect(r.anomalies.some((a) => a.direction === 'spike')).toBe(true);
  });

  it('reports none for a clean seasonal series', () => {
    const r = detectAnomalies(series(weekly(56)));
    expect(r.anomalies).toEqual([]);
    expect(r.note).toMatch(/within the expected range/i);
  });

  it('is insufficient_data with too little history', () => {
    const r = detectAnomalies(series(weekly(14)));
    expect(r.confidence).toBe('insufficient_data');
    expect(r.anomalies).toEqual([]);
  });

  it('exposes an expected range around each anomaly', () => {
    const v = weekly(56); v[v.length - 1] = 0;
    const r = detectAnomalies(series(v));
    const a = r.anomalies[0];
    expect(a.lower).toBeLessThanOrEqual(a.expected);
    expect(a.upper).toBeGreaterThanOrEqual(a.expected);
    expect(a.lower).toBeGreaterThanOrEqual(0);
  });
});
