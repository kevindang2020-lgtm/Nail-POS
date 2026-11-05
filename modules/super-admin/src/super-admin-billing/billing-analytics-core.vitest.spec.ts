import { describe, it, expect } from 'vitest';
import { recoveredRate, trialConversionRate, weeklyFailedRecovered } from './billing-analytics-core';

describe('recoveredRate', () => {
  it('computes a percentage and is zero with no eligible failures', () => {
    expect(recoveredRate(10, 7).rate).toBe(70);
    expect(recoveredRate(0, 0)).toEqual({ rate: 0, numerator: 0, denominator: 0 });
  });
});

describe('trialConversionRate', () => {
  it('computes conversion and guards an empty cohort', () => {
    expect(trialConversionRate(50, 14).rate).toBe(28);
    expect(trialConversionRate(0, 0).rate).toBe(0);
  });
});

describe('weeklyFailedRecovered', () => {
  it('buckets rows into the last N weeks', () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const rows = [
      { at: '2026-05-29T00:00:00Z', failed: 2, recovered: 1 },
      { at: '2026-05-20T00:00:00Z', failed: 1, recovered: 1 },
    ];
    const b = weeklyFailedRecovered(rows, 5, now);
    expect(b).toHaveLength(5);
    expect(b[4]).toEqual({ week: 'Week 5', failed: 2, recovered: 1 });
  });
});
