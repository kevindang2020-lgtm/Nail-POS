import { describe, it, expect } from 'vitest';
import { buildTrend, type SnapshotLike } from './campaign-trend-core';

describe('campaign-trend engine', () => {
  it('returns NotConnected when there are no snapshots', () => {
    expect(buildTrend([])).toEqual({ available: false, points: [] });
  });

  it('computes per-day rates with consistent denominators, sorted ascending', () => {
    const snaps: SnapshotLike[] = [
      { snapshotDate: '2026-05-02', attempted: 1000, delivered: 950, opened: 300, clicked: 80 },
      { snapshotDate: '2026-05-01', attempted: 1000, delivered: 974, opened: 320, clicked: 90 },
    ];
    const t = buildTrend(snaps);
    expect(t.available).toBe(true);
    expect(t.points[0].date).toBe('2026-05-01');       // sorted ascending
    expect(t.points[0].deliveryRate).toBe(97.4);
    expect(t.points[0].openRate).toBe(Math.round((320 / 974) * 1000) / 10);
    expect(t.points[1].deliveryRate).toBe(95);
  });

  it('yields null rates for a day with no delivery', () => {
    const t = buildTrend([{ snapshotDate: '2026-05-01', attempted: 0, delivered: 0, opened: 0, clicked: 0 }]);
    expect(t.points[0].deliveryRate).toBeNull();
    expect(t.points[0].openRate).toBeNull();
  });
});
