// forecast-run.vitest.spec.ts — recording + realized accuracy evaluation.
import { describe, it, expect, beforeEach } from 'vitest';
import { ForecastRunService, type RecordableForecast } from './forecast-run.service';
import { InMemoryForecastRunRepository } from './forecast-run.repository';
import { AiForecastError, type AiForecastContext } from './ai-analytics-forecasting.dto';

const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});
// Target dates in the PAST so they count as matured.
const fc = (): RecordableForecast => ({
  method: 'seasonal_naive', intervalLevel: 0.8, confidence: 'high', dataQuality: 'healthy', accuracy: { wape: 0.1 },
  horizon: [
    { step: 1, date: '2026-06-01', point: 20, lower: 15, upper: 25 },
    { step: 2, date: '2026-06-02', point: 22, lower: 17, upper: 27 },
  ],
});

let repo: InMemoryForecastRunRepository;
let svc: ForecastRunService;
beforeEach(() => { repo = new InMemoryForecastRunRepository(); svc = new ForecastRunService(repo); });

describe('recording', () => {
  it('records once and is idempotent within the same day', async () => {
    await svc.recordForecast(ctx(), 'appointments', fc());
    await svc.recordForecast(ctx(), 'appointments', fc()); // same day → skipped
    const matured = await repo.listUnrealizedMatured('T1', 'B1', 'appointments', '2026-12-31');
    expect(matured).toHaveLength(2); // 2 points, not 4
  });

  it('never throws even if the forecast shape is odd', async () => {
    await expect(svc.recordForecast(ctx(), 'revenue', { method: 'x', horizon: [] } as any)).resolves.toBeUndefined();
  });
});

describe('realized accuracy', () => {
  it('matches actuals to matured predictions and computes MAE/WAPE/coverage', async () => {
    await svc.recordForecast(ctx(), 'appointments', fc());
    const actuals = new Map<string, number>([['2026-06-01', 23], ['2026-06-02', 30]]); // errors 3 and 8; 23 in [15,25], 30 not in [17,27]
    const agg = await svc.evaluateAccuracy(ctx(), 'appointments', actuals);
    expect(agg.evaluated).toBe(2);
    expect(agg.mae).toBeCloseTo(5.5, 2);         // (3+8)/2
    expect(agg.coverage).toBeCloseTo(0.5, 2);    // 1 of 2 within interval
    expect(agg.modelVersion).toBe('forecast-v1');
  });

  it('leaves points unrealized when no actual is available', async () => {
    await svc.recordForecast(ctx(), 'appointments', fc());
    const agg = await svc.evaluateAccuracy(ctx(), 'appointments', new Map());
    expect(agg.evaluated).toBe(0);
    expect(agg.wape).toBeNull();
  });

  it('requires a data permission', async () => {
    await expect(svc.evaluateAccuracy(ctx({ permissions: [] }), 'appointments', new Map())).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('isolation', () => {
  it('T2 sees none of T1 recorded points', async () => {
    await svc.recordForecast(ctx({ tenantId: 'T1' }), 'appointments', fc());
    const agg = await svc.evaluateAccuracy(ctx({ tenantId: 'T2' }), 'appointments', new Map([['2026-06-01', 23]]));
    expect(agg.evaluated).toBe(0);
  });
});
