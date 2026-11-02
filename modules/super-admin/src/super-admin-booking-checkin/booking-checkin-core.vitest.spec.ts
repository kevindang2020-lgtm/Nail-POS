// booking-checkin-core.vitest.spec.ts — locks the formulas + business-semantic trend coloring.
import { describe, it, expect } from 'vitest';
import { pct, trend, kpiSemantic, waitStatus, avgSeconds, fmtDuration, uptimePct, reconciles, shares, stagePct, DEFAULT_WAIT_THRESHOLDS } from './booking-checkin-core';

describe('pct / stagePct', () => {
  it('is safe at zero denominator', () => { expect(pct(5, 0)).toBe(0); expect(stagePct(3, 0)).toBe(0); });
  it('rounds to one decimal', () => { expect(pct(1862, 6568)).toBe(28.3); });
});

describe('trend', () => {
  it('signs the delta and classifies direction', () => {
    expect(trend(112, 100)).toEqual({ deltaPct: 12, direction: 'up' });
    expect(trend(90, 100)).toEqual({ deltaPct: -10, direction: 'down' });
    expect(trend(100, 100)).toEqual({ deltaPct: 0, direction: 'flat' });
  });
  it('handles a zero baseline', () => { expect(trend(5, 0)).toEqual({ deltaPct: 100, direction: 'up' }); });
});

describe('kpiSemantic (business meaning, not raw direction)', () => {
  it('up is good for ordinary counts', () => { expect(kpiSemantic('online_bookings', 'up')).toBe('good'); });
  it('up is bad for failures/duplicates/unmatched/api/pending', () => {
    for (const k of ['failed_check_ins', 'duplicate_check_ins', 'unmatched_customers', 'booking_api_failures', 'pending_confirmations'])
      expect(kpiSemantic(k, 'up')).toBe('bad');
  });
  it('down is good for average check-in time (faster)', () => {
    expect(kpiSemantic('avg_check_in_time', 'down')).toBe('good');
    expect(kpiSemantic('avg_check_in_time', 'up')).toBe('bad');
  });
  it('flat is neutral', () => { expect(kpiSemantic('failed_check_ins', 'flat')).toBe('neutral'); });
});

describe('waitStatus', () => {
  it('buckets against ascending thresholds', () => {
    const t = DEFAULT_WAIT_THRESHOLDS;
    expect(waitStatus(300, t)).toBe('good');       // 5m
    expect(waitStatus(372, t)).toBe('acceptable');  // 6m12s
    expect(waitStatus(535, t)).toBe('at_risk');     // 8m55s
    expect(waitStatus(632, t)).toBe('at_risk');     // 10m32s (< 11m poor)
    expect(waitStatus(738, t)).toBe('poor');        // 12m18s
    expect(waitStatus(900, t)).toBe('critical');
  });
});

describe('durations', () => {
  it('avgSeconds ignores invalid/negative and means the rest', () => { expect(avgSeconds([600, 400, -1, NaN])).toBe(500); });
  it('avgSeconds is 0 for empty', () => { expect(avgSeconds([])).toBe(0); });
  it('fmtDuration renders mm·ss', () => { expect(fmtDuration(512)).toBe('08m 32s'); });
});

describe('uptime / reconcile / shares', () => {
  it('uptimePct', () => { expect(uptimePct(703, 726)).toBe(96.8); });
  it('reconciles checks exact sum', () => { expect(reconciles([128, 312, 286], 726)).toBe(true); expect(reconciles([100, 312, 286], 726)).toBe(false); });
  it('shares sum to the total population', () => {
    const out = shares([{ count: 3 }, { count: 1 }]);
    expect(out.map((o) => o.pct)).toEqual([75, 25]);
  });
});
