// ai-business-brief.service.ts — get_daily_operations_summary (spec §11).
// Composes THREE existing ReportsService sections into one briefing: sales (financial-gated), bookings and queue
// (operational, view-gated). No section is recomputed or invented. If the caller lacks financial permission the
// revenue section is returned as { available:false } rather than failing the whole brief — honest degradation (§9).
import { type ReportsContext, type ReportFilters, type DatePreset, type SalesKpis, type SalesTrend, type BookingsOverview, type QueueSummary, ForbiddenError } from '@aipowersalon/reports';
import { getMetric } from './ai-business-metrics';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import {
  deriveWatchItems, DEFAULT_BRIEF_THRESHOLDS,
  type DailyBrief, type BriefRevenue, type BriefThresholds,
} from './ai-business-brief.dto';

/** Structural port over the reused ReportsService (which satisfies it). Keeps the tool unit-testable + dependency
 *  one-way (ai-business → reports). getBooking/getQueue are operational (assertView); getSales is financial-gated. */
export interface BriefSource {
  getSales(ctx: ReportsContext, f?: ReportFilters): Promise<{ kpis: SalesKpis; trend: SalesTrend }>;
  getBooking(ctx: ReportsContext, f?: ReportFilters): Promise<BookingsOverview>;
  getQueue(ctx: ReportsContext, f?: ReportFilters): Promise<QueueSummary>;
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'];
const rctx = (c: AiBusinessContext): ReportsContext => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

export class AiBusinessBriefService {
  constructor(
    private readonly reports: BriefSource,
    private readonly thresholds: BriefThresholds = DEFAULT_BRIEF_THRESHOLDS,
  ) {}

  async getDailyBrief(ctx: AiBusinessContext, presetInput?: string): Promise<DailyBrief> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    if (presetInput != null && !VALID_PRESETS.includes(presetInput as DatePreset)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    const preset = (presetInput as DatePreset) ?? 'today';
    const filters: ReportFilters = { preset };
    const c = rctx(ctx);

    // Operational sections first — these define the brief; if the user can't even view reports, this throws (mapped
    // to 403 by the controller). Revenue is attempted separately and degraded on financial denial.
    let booking: BookingsOverview;
    let queue: QueueSummary;
    try {
      [booking, queue] = await Promise.all([this.reports.getBooking(c, filters), this.reports.getQueue(c, filters)]);
    } catch (e) {
      if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
      throw e;
    }

    const revenue: BriefRevenue = await this.reports.getSales(c, filters).then(({ kpis }) => ({
      available: true as const,
      netSalesCents: kpis.netSalesCents, grossSalesCents: kpis.grossSalesCents, averageTicketCents: kpis.averageTicketCents,
      ticketsCount: kpis.ticketsCount, customersCount: kpis.customersCount, refundsCents: kpis.refundsCents, discountsCents: kpis.discountsCents,
    })).catch((e) => {
      if (e instanceof ForbiddenError) return { available: false as const, reason: 'restricted_financial' as const };
      throw e;
    });

    const appointments = {
      totalBookings: booking.totalBookings,
      completed: booking.completed, completedPercent: booking.completedPercent,
      cancelled: booking.cancelled, cancelledPercent: booking.cancelledPercent,
      noShow: booking.noShow, noShowPercent: booking.noShowPercent,
    };
    const briefQueue = {
      averageWaitMinutes: queue.averageWaitMinutes, longestWaitMinutes: queue.longestWaitMinutes,
      walkIns: queue.walkIns, skipped: queue.skipped, peakWindow: queue.peakWindow,
    };
    const { watch, limitedData } = deriveWatchItems(appointments, briefQueue, this.thresholds);

    const notes: string[] = [];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (limitedData) notes.push(`Only ${appointments.totalBookings} booking(s) in this period \u2014 rate-based watch items are suppressed to avoid over-reading a small sample.`);
    if (revenue.available === false) notes.push('Revenue is hidden because you do not have financial-view permission.');

    return {
      preset, generatedAt: new Date().toISOString(), partialCurrentPeriod: preset === 'today',
      revenue, appointments, queue: briefQueue, watch, limitedData,
      freshnessClass: getMetric('completed_appointments')!.freshness,
      drilldowns: {
        revenue: getMetric('net_sales')!.drilldownRoute,
        appointments: getMetric('completed_appointments')!.drilldownRoute,
        queue: '/tenant/reports/appointments',
      },
      notes,
    };
  }
}
