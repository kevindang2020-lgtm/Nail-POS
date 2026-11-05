// forecast-core.vitest.spec.ts — the numerical engine. Deterministic; validates methods, interval widening, honest
// confidence/data-quality, and that accuracy only comes from backtesting.
import { describe, it, expect } from 'vitest';
import {
  movingAveragePoints, seasonalNaivePoints, holtLinearPoints, residualSigma,
  classifyDataQuality, classifyConfidence, forecast, backtest, selectModel,
  type SeriesPoint,
} from './forecast-core';

const series = (values: number[], start = '2026-01-01'): SeriesPoint[] => {
  const d0 = new Date(start).getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const flat = (v: number, n: number) => Array.from({ length: n }, () => v);
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [10, 12, 14, 16, 30, 40, 8][i % 7]);
const trending = (n: number) => Array.from({ length: n }, (_, i) => 100 + 2 * i);

describe('point methods', () => {
  it('moving average flat-extrapolates the recent mean', () => {
    expect(movingAveragePoints([10, 10, 10, 10], 3, 4)).toEqual([10, 10, 10]);
  });
  it('seasonal-naive repeats one period back', () => {
    const v = weekly(14);
    const f = seasonalNaivePoints(v, 7, 7);
    expect(f).toEqual([10, 12, 14, 16, 30, 40, 8]);
  });
  it('holt linear projects the trend upward', () => {
    const f = holtLinearPoints(trending(20), 3);
    expect(f[0]).toBeGreaterThan(135);   // continues the +2/step trend past ~138
    expect(f[2]).toBeGreaterThan(f[0]);
  });
});

describe('forecast intervals', () => {
  it('widen with horizon step and never go negative', () => {
    const s = series(trending(28)); // trend → moving-average has nonzero residual → real interval width
    const out = forecast(s, 'moving_average', 5, { intervalLevel: 0.8 });
    expect(out.horizon).toHaveLength(5);
    for (const h of out.horizon) { expect(h.lower).toBeGreaterThanOrEqual(0); expect(h.upper).toBeGreaterThanOrEqual(h.point); }
    const spread = (h: any) => h.upper - h.lower;
    expect(spread(out.horizon[4])).toBeGreaterThan(spread(out.horizon[0]));
  });
  it('residualSigma is ~0 for a perfectly flat series', () => {
    expect(residualSigma('moving_average', flat(10, 30))).toBeCloseTo(0, 5);
  });
});

describe('data quality + confidence', () => {
  it('classifies history length honestly', () => {
    expect(classifyDataQuality(series(flat(5, 3)))).toBe('insufficient_data');
    expect(classifyDataQuality(series(flat(5, 14)))).toBe('limited_history');
    expect(classifyDataQuality(series(weekly(60)))).toBe('healthy');
  });
  it('flags mostly-zero series as partial', () => {
    const mostlyZero = series([...flat(0, 20), ...flat(5, 8)]);
    expect(classifyDataQuality(mostlyZero)).toBe('partial_data');
  });
  it('never claims high confidence without long, clean history + good backtest + short horizon', () => {
    expect(classifyConfidence(5, 7, 0.05, 'insufficient_data')).toBe('insufficient_data');
    expect(classifyConfidence(60, 7, 0.10, 'healthy')).toBe('high');
    expect(classifyConfidence(60, 90, 0.10, 'healthy')).toBe('low');   // long horizon caps it
    expect(classifyConfidence(30, 7, 0.25, 'healthy')).toBe('moderate');
    expect(classifyConfidence(60, 7, null, 'healthy')).toBe('low');    // no backtest → not high
  });
});

describe('backtest (rolling origin)', () => {
  it('is near-perfect on a flat series', () => {
    const m = backtest(series(flat(20, 40)), 'moving_average', { minTrain: 14, step: 1 })!;
    expect(m.wape).toBeCloseTo(0, 2);
    expect(m.folds).toBeGreaterThan(20);
  });
  it('rewards seasonal-naive on strongly weekly data', () => {
    const s = series(weekly(56));
    const sn = backtest(s, 'seasonal_naive', { minTrain: 21, step: 1, period: 7 })!;
    const ma = backtest(s, 'moving_average', { minTrain: 21, step: 1 })!;
    expect(sn.wape).toBeLessThan(ma.wape);
  });
  it('returns null when history is too short to score', () => {
    expect(backtest(series(flat(5, 10)), 'moving_average', { minTrain: 14 })).toBeNull();
  });
});

describe('model selection', () => {
  it('picks seasonal-naive for weekly data and explains why', () => {
    const sel = selectModel(series(weekly(56)), { minTrain: 21, step: 1, period: 7 });
    expect(sel.selected).toBe('seasonal_naive');
    expect(sel.reason).toMatch(/WAPE/);
    expect(sel.candidates.length).toBeGreaterThanOrEqual(2);
  });
  it('falls back to moving average when it cannot backtest', () => {
    const sel = selectModel(series(flat(5, 8)), { minTrain: 14 });
    expect(sel.selected).toBe('moving_average');
    expect(sel.reason).toMatch(/fallback/i);
  });
});
