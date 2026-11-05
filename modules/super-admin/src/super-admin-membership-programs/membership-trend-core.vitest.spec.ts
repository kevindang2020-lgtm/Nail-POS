import { describe, it, expect } from 'vitest';
import { computeTrend, formatDelta, KPI_POLARITY } from './membership-trend-core';

describe('computeTrend', () => {
  it('returns a neutral trend when there is no baseline', () => {
    expect(computeTrend('activeMembers', 100, null)).toEqual({ deltaPct: null, favorable: null });
    expect(computeTrend('activeMembers', 100, 0)).toEqual({ deltaPct: null, favorable: null });
  });
  it('an increase in an up_good KPI is favorable', () => {
    const t = computeTrend('activeMembers', 110, 100);
    expect(t.deltaPct).toBe(10); expect(t.favorable).toBe(true);
  });
  it('an increase in an up_bad KPI is UNfavorable (does not color every increase green)', () => {
    const t = computeTrend('cancelledMembers', 120, 100);
    expect(t.deltaPct).toBe(20); expect(t.favorable).toBe(false);
    const f = computeTrend('failedPayments', 90, 100);
    expect(f.deltaPct).toBe(-10); expect(f.favorable).toBe(true); // fewer failures is good
  });
  it('a neutral KPI has no favorability', () => {
    expect(computeTrend('unusedCredits', 120, 100).favorable).toBeNull();
  });
  it('covers all 15 KPI keys with a polarity', () => {
    expect(Object.keys(KPI_POLARITY)).toHaveLength(15);
  });
});

describe('formatDelta', () => {
  it('formats signed percentages and em-dash for null', () => {
    expect(formatDelta(12.6)).toBe('+12.6%');
    expect(formatDelta(-8.4)).toBe('-8.4%');
    expect(formatDelta(null)).toBe('—');
  });
});
