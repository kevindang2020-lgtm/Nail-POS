// anomaly-detect.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { AnomalyDetectService, ANOMALY_MODEL_VERSION } from './anomaly-detect.service';
import { AiForecastError, InMemoryAppointmentSource, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[], start = '2026-01-04'): SeriesPoint[] => {
  const d0 = new Date(start + 'T00:00:00.000Z').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [10, 12, 14, 16, 20, 30, 40][i % 7]);
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: SeriesPoint[]) {
  const src = new InMemoryAppointmentSource();
  src.seed('T1', 'B1', rows);
  src.seed('T2', 'B1', series(weekly(56)));
  return { svc: new AnomalyDetectService(src), src };
}

describe('gate', () => {
  it('requires reports.view', async () => {
    await expect(svc(series(weekly(56))).svc.getAnomalies(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('detection', () => {
  it('flags a recent drop with neutral framing + model version', async () => {
    const v = weekly(56); v[v.length - 1] = 0;
    const r = await svc(series(v)).svc.getAnomalies(ctx());
    expect(r.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(r.modelVersion).toBe(ANOMALY_MODEL_VERSION);
    expect(r.disclaimer).toMatch(/not verified problems/i);
  });
});

describe('isolation', () => {
  it('reads only ctx tenant history', async () => {
    const { svc: s, src } = svc(series(weekly(56)));
    await s.getAnomalies(ctx({ tenantId: 'T1' }));
    expect(src.lastCtx!.tenantId).toBe('T1');
  });
});
