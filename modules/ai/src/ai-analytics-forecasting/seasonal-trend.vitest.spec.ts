// seasonal-trend.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { SeasonalTrendService } from './seasonal-trend.service';
import { AiForecastError, InMemoryAppointmentSource, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[], start = '2026-01-04'): SeriesPoint[] => {
  const d0 = new Date(start + 'T00:00:00.000Z').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [8, 12, 14, 16, 20, 30, 40][i % 7]);
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: SeriesPoint[]) {
  const src = new InMemoryAppointmentSource();
  src.seed('T1', 'B1', rows);
  src.seed('T2', 'B1', series(weekly(56)).map((p) => ({ ...p, value: p.value * 10 })));
  return { svc: new SeasonalTrendService(src), src };
}

describe('gate', () => {
  it('requires reports.view', async () => {
    await expect(svc(series(weekly(56))).svc.getSeasonalTrends(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('detection', () => {
  it('surfaces day-of-week peak/trough with evidence + disclaimer', async () => {
    const r = await svc(series(weekly(56))).svc.getSeasonalTrends(ctx());
    expect(r.dayOfWeek.peak!.label).toBe('Saturday');
    expect(r.dayOfWeek.trough!.label).toBe('Sunday');
    expect(r.evidence).toMatch(/own history/i);
    expect(r.disclaimer).toMatch(/not generic industry assumptions/i);
  });
});

describe('isolation', () => {
  it('reads only ctx tenant history', async () => {
    const { svc: s, src } = svc(series(weekly(56)));
    await s.getSeasonalTrends(ctx({ tenantId: 'T1' }));
    expect(src.lastCtx!.tenantId).toBe('T1');
  });
});
