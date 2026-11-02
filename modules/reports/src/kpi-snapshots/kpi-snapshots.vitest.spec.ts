import { describe, it, expect } from 'vitest';
import { buildKpiTrends } from './kpi-snapshots';

describe('buildKpiTrends', () => {
  it('returns null trends for every metric when there is no prior snapshot', () => {
    const t = buildKpiTrends({ completed: 27, tips: 124800 }, null);
    expect(t.completed).toEqual({ deltaPercent: null, direction: 'up' });
    expect(t.tips).toEqual({ deltaPercent: null, direction: 'up' });
  });

  it('computes percent change and direction vs prior', () => {
    const t = buildKpiTrends({ completed: 27, tips: 124800, accuracy: 97 }, { completed: 23, tips: 103000, accuracy: 94.6 });
    // (27-23)/23 = 17.39% up
    expect(t.completed).toEqual({ deltaPercent: 17.4, direction: 'up' });
    // (124800-103000)/103000 = 21.16% up
    expect(t.tips).toEqual({ deltaPercent: 21.2, direction: 'up' });
    expect(t.accuracy.direction).toBe('up');
  });

  it('marks a decrease as direction "down"', () => {
    const t = buildKpiTrends({ duration: 52 }, { duration: 56 });
    expect(t.duration).toEqual({ deltaPercent: 7.1, direction: 'down' }); // (56-52)/56
  });

  it('reports null magnitude (but still a direction) when prior is zero', () => {
    const t = buildKpiTrends({ ready: 8 }, { ready: 0 });
    expect(t.ready).toEqual({ deltaPercent: null, direction: 'up' });
  });
});
