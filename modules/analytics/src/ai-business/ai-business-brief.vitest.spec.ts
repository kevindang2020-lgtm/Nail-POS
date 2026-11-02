// ai-business-brief.vitest.spec.ts — slice 3: the owner/manager daily brief (§11).
// Fake BriefSource mirrors ReportsService: getBooking/getQueue are operational; getSales throws ForbiddenError when
// the ctx lacks pos.reports.financial_view. Verifies composition, honest financial degradation, sample-size
// suppression of rate-based watch items, threshold behavior, and tenant isolation.
import { ForbiddenError, type ReportsContext, type ReportFilters, type SalesKpis, type SalesTrend, type BookingsOverview, type QueueSummary } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessBriefService, type BriefSource } from './ai-business-brief.service';
import { deriveWatchItems, DEFAULT_BRIEF_THRESHOLDS } from './ai-business-brief.dto';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const kpis = (o: Partial<SalesKpis>): SalesKpis => ({ grossSalesCents: 0, netSalesCents: 0, serviceSalesCents: 0, productSalesCents: 0, tipsCents: 0, taxCollectedCents: 0, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, ticketsCount: 0, customersCount: 0, averageTicketCents: 0, ...o });
const booking = (o: Partial<BookingsOverview>): BookingsOverview => ({ totalBookings: 0, completed: 0, completedPercent: 0, cancelled: 0, cancelledPercent: 0, noShow: 0, noShowPercent: 0, ...o });
const queue = (o: Partial<QueueSummary>): QueueSummary => ({ averageWaitMinutes: 0, longestWaitMinutes: 0, walkIns: 0, skipped: 0, peakWindow: '', byTechnician: [], ...o });
const trend: SalesTrend = { points: [] };

class FakeBriefSource implements BriefSource {
  lastCtx: ReportsContext | null = null;
  constructor(private b: BookingsOverview, private q: QueueSummary, private k: SalesKpis) {}
  async getSales(ctx: ReportsContext, _f?: ReportFilters) {
    if (!ctx.permissions.includes('pos.reports.financial_view')) throw new ForbiddenError('Missing pos.reports.financial_view');
    return { kpis: this.k, trend };
  }
  async getBooking(ctx: ReportsContext, _f?: ReportFilters) { this.lastCtx = ctx; if (!ctx.permissions.includes('pos.reports.view')) throw new ForbiddenError('view'); return this.b; }
  async getQueue(_ctx: ReportsContext, _f?: ReportFilters) { return this.q; }
}

const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view', 'pos.reports.financial_view'], ...o });

describe('deriveWatchItems (pure rules, §16/§17)', () => {
  it('suppresses percent rules under the minimum sample size and flags limitedData', () => {
    const { watch, limitedData } = deriveWatchItems(booking({ totalBookings: 4, noShow: 2, noShowPercent: 50 }), queue({}));
    expect(limitedData).toBe(true);
    expect(watch.find((w) => w.code === 'no_show_rate')).toBeUndefined(); // not fired on 4 bookings
  });

  it('fires no-show + cancellation watch when above threshold with enough sample', () => {
    const { watch, limitedData } = deriveWatchItems(booking({ totalBookings: 40, noShow: 8, noShowPercent: 20, cancelled: 10, cancelledPercent: 25 }), queue({}));
    expect(limitedData).toBe(false);
    expect(watch.find((w) => w.code === 'no_show_rate')?.threshold).toBe(DEFAULT_BRIEF_THRESHOLDS.noShowPercent);
    expect(watch.find((w) => w.code === 'cancellation_rate')).toBeTruthy();
  });

  it('reports long waits and skips regardless of booking sample size', () => {
    const { watch } = deriveWatchItems(booking({ totalBookings: 2 }), queue({ longestWaitMinutes: 30, skipped: 3, peakWindow: '2\u20134pm' }));
    expect(watch.find((w) => w.code === 'long_wait')?.value).toBe(30);
    expect(watch.find((w) => w.code === 'queue_skips')?.value).toBe(3);
  });
});

describe('getDailyBrief composition', () => {
  const src = new FakeBriefSource(
    booking({ totalBookings: 40, completed: 34, completedPercent: 85, cancelled: 3, cancelledPercent: 8, noShow: 3, noShowPercent: 7 }),
    queue({ averageWaitMinutes: 9, longestWaitMinutes: 12, walkIns: 5, skipped: 0, peakWindow: '5\u20136pm' }),
    kpis({ netSalesCents: 84200, grossSalesCents: 90000, averageTicketCents: 2100, ticketsCount: 40, customersCount: 38, refundsCents: 500, discountsCents: 1200 }),
  );
  const svc = new AiBusinessBriefService(src);

  it('returns all three sections with real numbers and drilldowns', async () => {
    const b = await svc.getDailyBrief(CTX(), 'today');
    expect(b.revenue.available).toBe(true);
    if (b.revenue.available) expect(b.revenue.netSalesCents).toBe(84200);
    expect(b.appointments.completed).toBe(34);
    expect(b.queue.averageWaitMinutes).toBe(9);
    expect(b.drilldowns.revenue).toBe('/tenant/reports/sales');
    expect(b.drilldowns.appointments).toBe('/tenant/reports/appointments');
  });

  it('labels the partial current day', async () => {
    const b = await svc.getDailyBrief(CTX(), 'today');
    expect(b.partialCurrentPeriod).toBe(true);
    expect(b.notes.some((n) => /partial/i.test(n))).toBe(true);
  });

  it('rejects an invalid preset', async () => {
    try { await svc.getDailyBrief(CTX(), 'nope'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });
});

describe('honest financial degradation', () => {
  const src = new FakeBriefSource(booking({ totalBookings: 20, completed: 18 }), queue({}), kpis({ netSalesCents: 99999 }));
  const svc = new AiBusinessBriefService(src);

  it('returns operational sections and marks revenue restricted when financial permission is absent', async () => {
    const b = await svc.getDailyBrief(CTX({ permissions: ['ai.use', 'pos.reports.view'] }), 'today');
    expect(b.revenue.available).toBe(false);
    if (!b.revenue.available) expect(b.revenue.reason).toBe('restricted_financial');
    expect(b.appointments.completed).toBe(18); // operational data still present
    expect(b.notes.some((n) => /financial-view/i.test(n))).toBe(true);
  });
});

describe('tenant isolation', () => {
  const src = new FakeBriefSource(booking({ totalBookings: 3 }), queue({}), kpis({ netSalesCents: 1 }));
  const svc = new AiBusinessBriefService(src);
  it('builds the ReportsContext from the trusted ctx tenantId', async () => {
    await svc.getDailyBrief(CTX({ tenantId: 'tXYZ' }), 'week');
    expect(src.lastCtx?.tenantId).toBe('tXYZ');
  });
});
