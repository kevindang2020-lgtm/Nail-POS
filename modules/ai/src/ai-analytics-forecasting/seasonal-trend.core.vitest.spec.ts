// seasonal-trend.core.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { detectSeasonality } from './seasonal-trend.core';
import type { SeriesPoint } from './forecast-core';

// Build a series starting on a known weekday. 2026-01-04 is a Sunday.
const series = (values: number[], start = '2026-01-04'): SeriesPoint[] => {
  const d0 = new Date(start + 'T00:00:00.000Z').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
// Strong weekly pattern: Sun..Sat weights; Saturday busiest, Sunday slowest.
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [8, 12, 14, 16, 20, 30, 40][i % 7]);

describe('day-of-week detection', () => {
  it('finds Saturday peak and Sunday trough from the tenant history', () => {
    const r = detectSeasonality(series(weekly(56)));
    expect(r.dayOfWeek.confidence).toBe('high');
    expect(r.dayOfWeek.factors).toHaveLength(7);
    expect(r.dayOfWeek.peak!.label).toBe('Saturday');
    expect(r.dayOfWeek.trough!.label).toBe('Sunday');
    expect(r.dayOfWeek.peak!.factor).toBeGreaterThan(1);
    expect(r.dayOfWeek.trough!.factor).toBeLessThan(1);
  });

  it('is insufficient_data with under two weeks', () => {
    const r = detectSeasonality(series(weekly(10)));
    expect(r.dayOfWeek.confidence).toBe('insufficient_data');
    expect(r.dayOfWeek.factors).toEqual([]);
  });

  it('degrades to moderate around 4–8 weeks', () => {
    const r = detectSeasonality(series(weekly(35)));
    expect(['moderate', 'high']).toContain(r.dayOfWeek.confidence);
  });
});

describe('monthly detection', () => {
  it('is insufficient without ~a year of history', () => {
    const r = detectSeasonality(series(weekly(120)));
    expect(r.monthly.confidence).toBe('insufficient_data');
    expect(r.monthly.factors).toEqual([]);
  });

  it('reports monthly factors with ~a year of history', () => {
    const r = detectSeasonality(series(weekly(400)));
    expect(['low', 'moderate']).toContain(r.monthly.confidence);
    expect(r.monthly.factors.length).toBeGreaterThanOrEqual(6);
  });
});
