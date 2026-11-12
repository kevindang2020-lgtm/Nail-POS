// revenue-forecast.vitest.spec.ts — revenue domain over a fake financial source.
import { describe, it, expect } from 'vitest';
import { RevenueForecastService } from './revenue-forecast.service';
import { AiForecastError, InMemoryRevenueSource, type AiForecastContext, type RevenueSeriesSource, type RevenueSourceTotals } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[]): SeriesPoint[] => {
  const d0 = new Date('2026-01-01').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weeklyRevenue = (n: number) => Array.from({ length: n }, (_, i) => [20000, 24000, 28000, 30000, 55000, 70000, 12000][i % 7]);
const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: SeriesPoint[]) {
  const src = new InMemoryRevenueSource();
  src.seed('T1', 'B1', rows);
  src.seed('T2', 'B1', series(weeklyRevenue(60)).map((p) => ({ ...p, value: p.value * 100 })));
  return { svc: new RevenueForecastService(src), src };
}

// A source that enforces the financial gate exactly like ReportsService.requireFinancial.
class FinancialGatedSource implements RevenueSeriesSource {
  constructor(private rows: SeriesPoint[]) {}
  async getDailyRevenue(ctx: AiForecastContext): Promise<SeriesPoint[]> {
    if (!ctx.permissions.includes('pos.reports.financial_view')) { const e = new Error('Missing pos.reports.financial_view'); e.name = 'ForbiddenError'; throw e; }
    return this.rows;
  }
}

describe('gates', () => {
  it('requires reports.view', async () => {
    await expect(svc(series(weeklyRevenue(60))).svc.getRevenueForecast(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
  it('maps a ForbiddenError from the financial source to INSUFFICIENT_PERMISSION', async () => {
    const s = new RevenueForecastService(new FinancialGatedSource(series(weeklyRevenue(60))));
    await expect(s.getRevenueForecast(ctx({ permissions: ['reports.view'] }))).rejects.toMatchObject({ code: 'INSUFFICIENT_PERMISSION', status: 403 });
    // with the financial permission it succeeds
    const ok = await s.getRevenueForecast(ctx({ permissions: ['reports.view', 'pos.reports.financial_view'] }), 7);
    expect(ok.horizon).toHaveLength(7);
  });
});

describe('forecast output (cents)', () => {
  it('returns integer-cent horizon with intervals + total + disclaimer', async () => {
    const f = await svc(series(weeklyRevenue(60))).svc.getRevenueForecast(ctx(), 7);
    expect(f.currencyUnit).toBe('cents');
    for (const h of f.horizon) {
      expect(Number.isInteger(h.pointCents)).toBe(true);
      expect(h.upperCents).toBeGreaterThanOrEqual(h.pointCents);
      expect(h.lowerCents).toBeGreaterThanOrEqual(0);
    }
    expect(f.forecastTotalCents).toBe(f.horizon.reduce((a, h) => a + h.pointCents, 0));
    expect(f.disclaimer).toMatch(/not guaranteed income/i);
  });
  it('refuses to guess with insufficient history', async () => {
    await expect(svc(series(weeklyRevenue(10))).svc.getRevenueForecast(ctx())).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
  });
});

describe('isolation', () => {
  it('reads only ctx tenant/branch and is not influenced by T2 revenue', async () => {
    const { svc: s, src } = svc(series(weeklyRevenue(60)));
    const f = await s.getRevenueForecast(ctx({ tenantId: 'T1' }), 3);
    expect(src.lastCtx!.tenantId).toBe('T1');
    expect(f.horizon.every((h) => h.pointCents < 1_000_000)).toBe(true); // T2 was ×100
  });
});

// extras (AI Analytics Forecasting 06): Source-to-Report — the trained history beside the canonical report's OWN totals for the
// same days; the service never recomputes a revenue figure, it reads the report and says whether the two agree.
class ReportBackedSource extends InMemoryRevenueSource {
  public asked: { from: string; to: string } | null = null;
  constructor(private totals: RevenueSourceTotals | Error) { super(); }
  async getSalesTotals(_ctx: AiForecastContext, from: string, to: string): Promise<RevenueSourceTotals> {
    this.asked = { from, to };
    if (this.totals instanceof Error) throw this.totals;
    return this.totals;
  }
}
describe('Source-to-Report reconciliation (extras AI Analytics Forecasting 06)', () => {
  const rows = series(weeklyRevenue(60));
  const sum = rows.reduce((a, p) => a + p.value, 0);
  it('asks the report for exactly the trained days and says they match, with the basis spelled out', async () => {
    const src = new ReportBackedSource({ grossSalesCents: sum, discountsCents: 5000, refundsCents: 8500, netSalesCents: sum - 5000, ticketsCount: 120 });
    src.seed('T1', 'B1', rows);
    const f = await new RevenueForecastService(src).getRevenueForecast(ctx(), 7);
    expect(src.asked).toEqual({ from: rows[0].date, to: rows[59].date });
    expect(f.source).toMatchObject({ from: rows[0].date, to: rows[59].date, days: 60, trainedTotalCents: sum, status: 'matches', differenceCents: 0, readOnly: true,
      report: { grossSalesCents: sum, discountsCents: 5000, refundsCents: 8500, netSalesCents: sum - 5000, ticketsCount: 120 },
      basis: { dateBasis: 'paid_day_branch_time_zone', discounts: 'not_subtracted', refunds: 'not_subtracted' } });
  });
  it('a report that disagrees is shown as a difference, never silently replaced', async () => {
    const src = new ReportBackedSource({ grossSalesCents: sum - 1234, discountsCents: 0, refundsCents: 0, netSalesCents: sum - 1234, ticketsCount: 10 });
    src.seed('T1', 'B1', rows);
    const f = await new RevenueForecastService(src).getRevenueForecast(ctx(), 7);
    expect(f.source).toMatchObject({ status: 'differs', differenceCents: 1234, trainedTotalCents: sum });
  });
  it('an unreadable report is "unavailable" with the reason — never a confident zero; the forecast itself still answers', async () => {
    const denied = Object.assign(new Error('Missing pos.reports.financial_view'), { name: 'ForbiddenError' });
    const a = new ReportBackedSource(denied); a.seed('T1', 'B1', rows);
    expect((await new RevenueForecastService(a).getRevenueForecast(ctx(), 7)).source).toMatchObject({ status: 'unavailable', unavailableReason: 'permission', report: null, differenceCents: null });
    const b = new ReportBackedSource(new Error('db down')); b.seed('T1', 'B1', rows);
    const fb = await new RevenueForecastService(b).getRevenueForecast(ctx(), 7);
    expect(fb.source).toMatchObject({ status: 'unavailable', unavailableReason: 'error' }); expect(fb.horizon).toHaveLength(7);
    expect((await svc(rows).svc.getRevenueForecast(ctx(), 7)).source).toMatchObject({ status: 'unavailable', unavailableReason: 'not_supported' });
  });
});
