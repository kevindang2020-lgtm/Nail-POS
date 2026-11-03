// ai-business-revenue.vitest.spec.ts — slice 2: revenue summary + change explanation.
// Uses a fake RevenueSource so the tool is tested in isolation. The fake mirrors the REAL ReportsService contract:
// it returns per-tenant SalesKpis and throws ForbiddenError when the ctx lacks pos.reports.financial_view (exactly as
// ReportsService.requireFinancial does), so permission propagation and cross-tenant isolation are exercised honestly.
import { ForbiddenError, previousPeriodRange, type ReportsContext, type ReportFilters, type SalesKpis, type SalesTrend } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessRevenueService, type RevenueSource } from './ai-business-revenue.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const kpis = (over: Partial<SalesKpis>): SalesKpis => ({
  grossSalesCents: 0, netSalesCents: 0, serviceSalesCents: 0, productSalesCents: 0,
  tipsCents: 0, taxCollectedCents: 0, cardSurchargeCents: 0, discountsCents: 0,
  refundsCents: 0, ticketsCount: 0, customersCount: 0, averageTicketCents: 0, ...over,
});
const emptyTrend: SalesTrend = { points: [] };

// Per-tenant + per-preset canned data. Records the last ReportsContext it was called with (isolation assertions).
class FakeReports implements RevenueSource {
  lastCtx: ReportsContext | null = null;
  constructor(private data: Record<string, Record<string, SalesKpis>>) {}
  async getSales(ctx: ReportsContext, f?: ReportFilters) {
    this.lastCtx = ctx;
    if (!ctx.permissions.includes('pos.reports.financial_view')) throw new ForbiddenError('Missing pos.reports.financial_view');
    const preset = (f?.period === 'previous' ? 'prev:' : '') + (f?.preset ?? 'today');
    const byPreset = this.data[ctx.tenantId] || {};
    return { kpis: byPreset[preset] ?? kpis({}), trend: emptyTrend };
  }
}

const CTX = (over: Partial<AiBusinessContext> = {}): AiBusinessContext => ({
  tenantId: 'tenantA', branchId: 'b1', userId: 'u1', role: 'OWNER',
  permissions: ['ai.use', 'pos.reports.view', 'pos.reports.financial_view'], ...over,
});

describe('getRevenueSummary', () => {
  const src = new FakeReports({
    tenantA: { today: kpis({ grossSalesCents: 100000, netSalesCents: 90000, serviceSalesCents: 70000, productSalesCents: 20000, tipsCents: 15000, taxCollectedCents: 6000, discountsCents: 5000, refundsCents: 3000, ticketsCount: 30, customersCount: 28, averageTicketCents: 3000 }) },
  });
  const svc = new AiBusinessRevenueService(src);

  it('returns explicit money terms with tips and tax held separate from net', async () => {
    const r = await svc.getRevenueSummary(CTX(), 'today');
    expect(r.netSalesCents).toBe(90000);
    expect(r.grossSalesCents).toBe(100000);
    expect(r.tipsCents).toBe(15000);        // present but NOT folded into net
    expect(r.taxCollectedCents).toBe(6000); // present but NOT folded into net
    expect(r.averageTicketCents).toBe(3000);
    expect(r.ticketsCount).toBe(30);
  });

  it('attaches net_sales evidence with the real drilldown route and partial-day flag for today', async () => {
    const r = await svc.getRevenueSummary(CTX(), 'today');
    expect(r.evidence.metricId).toBe('net_sales');
    expect(r.evidence.drilldownRoute).toBe('/tenant/reports/sales');
    expect(r.evidence.partialCurrentPeriod).toBe(true);
    expect(r.evidence.branchScope).toBe('server_derived');
  });

  it('rejects an unsupported preset with INVALID_DATE_RANGE', async () => {
    try { await svc.getRevenueSummary(CTX(), 'decade'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('propagates the reports financial-permission gate as INSUFFICIENT_PERMISSION', async () => {
    const noFin = CTX({ permissions: ['ai.use', 'pos.reports.view'] });
    try { await svc.getRevenueSummary(noFin, 'today'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION); }
  });
});

describe('explainRevenueChange — exact contribution bridge', () => {
  const src = new FakeReports({
    tenantA: {
      today: kpis({ netSalesCents: 84000, ticketsCount: 28, averageTicketCents: 3000, refundsCents: 1800, discountsCents: 2000 }),
      yesterday: kpis({ netSalesCents: 90000, ticketsCount: 30, averageTicketCents: 3000, refundsCents: 1000, discountsCents: 2000 }),
    },
  });
  const svc = new AiBusinessRevenueService(src);

  it('volume + rate effects sum EXACTLY to the net change', async () => {
    const r = await svc.explainRevenueChange(CTX(), 'today', 'yesterday');
    expect(r.changeCents).toBe(84000 - 90000); // -6000
    const confirmed = r.contributors.filter((c) => c.confidence === 'confirmed');
    const sum = confirmed.reduce((a, c) => a + c.deltaCents, 0);
    expect(sum).toBe(r.changeCents); // the bridge is exact — no unexplained residual, no invented cause
  });

  it('surfaces refund change as contextual (already inside net), not double-counted', async () => {
    const r = await svc.explainRevenueChange(CTX(), 'today', 'yesterday');
    const refunds = r.contributors.find((c) => c.factor.startsWith('Refunds'));
    expect(refunds?.confidence).toBe('contextual');
    // refunds rose 1000→1800 (+800), which pushes net DOWN → contextual delta is negative
    expect(refunds?.deltaCents).toBe(-800);
  });

  it('includes partial-day and correlation-not-causation caveats', async () => {
    const r = await svc.explainRevenueChange(CTX(), 'today', 'yesterday');
    expect(r.caveats.some((c) => /partial/i.test(c))).toBe(true);
    expect(r.caveats.some((c) => /causation/i.test(c))).toBe(true);
  });

  it('changePercent is null when the previous period is zero', async () => {
    const zeroSrc = new FakeReports({ tenantA: { month: kpis({ netSalesCents: 5000, ticketsCount: 2, averageTicketCents: 2500 }), quarter: kpis({ netSalesCents: 0, ticketsCount: 0, averageTicketCents: 0 }) } });
    const r = await new AiBusinessRevenueService(zeroSrc).explainRevenueChange(CTX(), 'month', 'quarter');
    expect(r.changePercent).toBeNull();
  });
});

describe('Nov 3 audit: the default comparison is the equivalent PREVIOUS period', () => {
  it('This Month with no comparison is compared with last month to date — never with itself', async () => {
    const src = new FakeReports({ tenantA: { month: kpis({ netSalesCents: 12000, ticketsCount: 4, averageTicketCents: 3000 }), 'prev:month': kpis({ netSalesCents: 10000, ticketsCount: 4, averageTicketCents: 2500 }) } });
    const r = await new AiBusinessRevenueService(src).explainRevenueChange(CTX(), 'month');
    expect(r.changeCents).toBe(2000);
    expect(r.evidence.compareWindow).toBe('previous');
    expect(r.evidence.comparePreset).toBe('month');
  });
  it('an explicit comparison equal to the current preset also means the previous one; a different preset is read as is', async () => {
    const src = new FakeReports({ tenantA: { week: kpis({ netSalesCents: 5000, ticketsCount: 2, averageTicketCents: 2500 }), 'prev:week': kpis({ netSalesCents: 4000, ticketsCount: 2, averageTicketCents: 2000 }), month: kpis({ netSalesCents: 9000, ticketsCount: 3, averageTicketCents: 3000 }) } });
    const svc = new AiBusinessRevenueService(src);
    expect((await svc.explainRevenueChange(CTX(), 'week', 'week')).changeCents).toBe(1000);
    const r = await svc.explainRevenueChange(CTX(), 'week', 'month');
    expect(r.changeCents).toBe(-4000); expect(r.evidence.compareWindow).toBe('current');
  });
});

describe('previousPeriodRange (salon-local days)', () => {
  const now = new Date('2026-03-31T15:00:00Z');   // Tue Mar 31 2026 in New York
  it('month to date → last month to the same day, clamped; week → last Monday to the same weekday; year → last year', () => {
    expect(previousPeriodRange('month', now, 'America/New_York')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriodRange('week', now, 'America/New_York')).toEqual({ from: '2026-03-23', to: '2026-03-24' });
    expect(previousPeriodRange('today', now, 'America/New_York')).toEqual({ from: '2026-03-30', to: '2026-03-30' });
    expect(previousPeriodRange('year', now, 'America/New_York')).toEqual({ from: '2025-01-01', to: '2025-03-31' });
    expect(previousPeriodRange('quarter', now, 'America/New_York')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });
});

describe('tenant isolation (spec §5, §52 security)', () => {
  const src = new FakeReports({
    tenantA: { today: kpis({ netSalesCents: 90000, ticketsCount: 30, averageTicketCents: 3000 }) },
    tenantB: { today: kpis({ netSalesCents: 12345, ticketsCount: 5, averageTicketCents: 2469 }) },
  });
  const svc = new AiBusinessRevenueService(src);

  it('each tenant only ever sees its own numbers', async () => {
    const a = await svc.getRevenueSummary(CTX({ tenantId: 'tenantA' }), 'today');
    const b = await svc.getRevenueSummary(CTX({ tenantId: 'tenantB' }), 'today');
    expect(a.netSalesCents).toBe(90000);
    expect(b.netSalesCents).toBe(12345);
    expect(b.netSalesCents).not.toBe(a.netSalesCents);
  });

  it('the ReportsContext is built from the trusted ctx tenantId (never widened)', async () => {
    await svc.getRevenueSummary(CTX({ tenantId: 'tenantB' }), 'today');
    expect(src.lastCtx?.tenantId).toBe('tenantB');
  });

  it('unauthenticated context is rejected before any data access', async () => {
    try { await svc.getRevenueSummary({ tenantId: '', branchId: '', userId: '', role: '', permissions: [] }, 'today'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION); }
  });
});
