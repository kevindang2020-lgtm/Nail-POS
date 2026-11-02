import { describe, it, expect } from 'vitest';
import { computeTrend, formatDelta, KPI_POLARITY } from './billing-trend-core';

describe('computeTrend', () => {
  it('no baseline → neutral', () => {
    expect(computeTrend('activeSubscriptions', 100, null)).toEqual({ deltaPct: null, favorable: null });
  });
  it('an increase in an up_good KPI is favorable', () => {
    expect(computeTrend('mrrCents', 12000000, 10000000)).toEqual({ deltaPct: 20, favorable: true });
  });
  it('an increase in cancellations is UNfavorable (not colored green)', () => {
    expect(computeTrend('cancellationRequests', 12, 10).favorable).toBe(false);
    expect(computeTrend('failedPayments', 9, 13).favorable).toBe(true); // fewer failures is good
  });
  it('rising credits are neutral, never auto-green', () => {
    expect(computeTrend('creditsIssuedCents', 4326, 3800).favorable).toBeNull();
  });
  it('covers all 12 KPI keys', () => {
    expect(Object.keys(KPI_POLARITY)).toHaveLength(12);
  });
});

describe('formatDelta', () => {
  it('signs and em-dashes', () => {
    expect(formatDelta(22.4)).toBe('+22.4%');
    expect(formatDelta(-3)).toBe('-3%');
    expect(formatDelta(null)).toBe('—');
  });
});
