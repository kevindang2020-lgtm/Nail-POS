// appointment-forecast.vitest.spec.ts — appointment domain over a fake authoritative source.
import { describe, it, expect } from 'vitest';
import { AppointmentForecastService } from './appointment-forecast.service';
import { AiForecastError, InMemoryAppointmentSource, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[]): SeriesPoint[] => {
  const d0 = new Date('2026-01-01').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [10, 12, 14, 16, 30, 40, 8][i % 7]);

const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: SeriesPoint[], tenant = 'T1', branch = 'B1') {
  const src = new InMemoryAppointmentSource();
  src.seed(tenant, branch, rows);
  src.seed('T2', 'B1', series(weekly(60)).map((p) => ({ ...p, value: p.value + 999 })));
  return { svc: new AppointmentForecastService(src), src };
}

describe('permission gate', () => {
  it('requires reports.view', async () => {
    await expect(svc(series(weekly(60))).svc.getAppointmentForecast(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('insufficient history', () => {
  it('refuses to guess with < 14 days', async () => {
    await expect(svc(series(weekly(10))).svc.getAppointmentForecast(ctx(), 7)).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
  });
});

describe('forecast output', () => {
  it('returns dated horizon with intervals, backtested accuracy, and a disclaimer', async () => {
    const { svc: s } = svc(series(weekly(60)));
    const f = await s.getAppointmentForecast(ctx(), 7);
    expect(f.horizon).toHaveLength(7);
    expect(f.horizon[0].date).toBe('2026-03-02'); // day after last of 60 (2026-01-01 + 59 = 2026-02-29; +1)
    for (const h of f.horizon) { expect(h.upper).toBeGreaterThanOrEqual(h.point); expect(h.lower).toBeGreaterThanOrEqual(0); }
    expect(f.accuracy).not.toBeNull();
    expect(f.accuracy!.folds).toBeGreaterThan(0);
    expect(f.method).toBe('seasonal_naive'); // weekly data
    expect(f.disclaimer).toMatch(/not a guaranteed outcome/i);
  });

  it('rejects an out-of-range horizon', async () => {
    await expect(svc(series(weekly(60))).svc.getAppointmentForecast(ctx(), 400)).rejects.toMatchObject({ code: 'INVALID_HORIZON' });
  });
});

describe('tenant isolation', () => {
  it('reads only the ctx tenant/branch history', async () => {
    const { svc: s, src } = svc(series(weekly(60)));
    await s.getAppointmentForecast(ctx({ tenantId: 'T1' }), 7);
    expect(src.lastCtx!.tenantId).toBe('T1');
    // T2's inflated series must never influence T1's forecast points
    const f = await s.getAppointmentForecast(ctx({ tenantId: 'T1' }), 3);
    expect(f.horizon.every((h) => h.point < 500)).toBe(true);
  });
});
