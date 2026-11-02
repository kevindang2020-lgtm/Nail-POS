// product-demand-forecast.vitest.spec.ts — product demand domain over fake demand + fake position (loop closed).
import { describe, it, expect } from 'vitest';
import { ProductDemandForecastService } from './product-demand-forecast.service';
import { AiForecastError, InMemoryProductDemandSource, type AiForecastContext, type ProductPositionProvider } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[]): SeriesPoint[] => {
  const d0 = new Date('2026-01-01').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const steady = (n: number, v = 5) => Array.from({ length: n }, () => v);
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['inventory.view'], ...o,
});

class FakePosition implements ProductPositionProvider {
  constructor(private pos: Record<string, { sellableOnHand: number; confirmedInbound: number; name: string | null } | null>) {}
  async getProductPosition(_ctx: AiForecastContext, productId: string) { return this.pos[productId] ?? null; }
}

function svc(demandSeries: SeriesPoint[], pos: { sellableOnHand: number; confirmedInbound: number; name: string | null } | null) {
  const src = new InMemoryProductDemandSource();
  src.seed('T1', 'B1', 'p1', demandSeries);
  src.seed('T2', 'B1', 'p1', series(steady(60, 999)));
  return { svc: new ProductDemandForecastService(src, new FakePosition({ p1: pos })), src };
}

describe('gate', () => {
  it('requires inventory.view', async () => {
    await expect(svc(series(steady(60)), { sellableOnHand: 10, confirmedInbound: 0, name: 'Acetone' }).svc.getProductForecast(ctx({ permissions: [] }), 'p1')).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('insufficient history', () => {
  it('refuses with < 14 days', async () => {
    await expect(svc(series(steady(10)), { sellableOnHand: 10, confirmedInbound: 0, name: 'x' }).svc.getProductForecast(ctx(), 'p1')).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
  });
});

describe('demand + position fusion', () => {
  it('projects a stockout when forecast demand exceeds available', async () => {
    // steady 5/day; available 20 + inbound 0 → runs out ~day 4-5 within a 14-day horizon
    const f = await svc(series(steady(60, 5)), { sellableOnHand: 20, confirmedInbound: 0, name: 'Acetone' }).svc.getProductForecast(ctx(), 'p1', 14);
    expect(f.horizon).toHaveLength(14);
    expect(f.position.projectedAvailable).toBe(20);
    expect(f.projectedStockoutDate).not.toBeNull();
    expect(f.forecastDemandOverHorizon).toBeGreaterThan(20);
    expect(f.suggestedOrderUnits).toBeGreaterThan(0);
    expect(f.daysOfCover).toBeCloseTo(4, 0);
  });

  it('no stockout + zero suggested order when inbound covers demand', async () => {
    const f = await svc(series(steady(60, 5)), { sellableOnHand: 50, confirmedInbound: 100, name: 'Acetone' }).svc.getProductForecast(ctx(), 'p1', 14);
    expect(f.projectedStockoutDate).toBeNull();
    expect(f.suggestedOrderUnits).toBe(0);
  });

  it('404s when the product has no position', async () => {
    await expect(svc(series(steady(60)), null).svc.getProductForecast(ctx(), 'p1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('isolation', () => {
  it('reads only ctx tenant demand', async () => {
    const { svc: s, src } = svc(series(steady(60, 5)), { sellableOnHand: 20, confirmedInbound: 0, name: 'x' });
    const f = await s.getProductForecast(ctx({ tenantId: 'T1' }), 'p1', 3);
    expect(src.lastCtx!.tenantId).toBe('T1');
    expect(f.horizon.every((h) => h.demand < 500)).toBe(true); // T2 was 999/day
  });
});
