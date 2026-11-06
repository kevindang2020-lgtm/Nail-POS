// ai-business-appointments.service.ts — get_appointment_metrics (spec §13, §29).
// Reuses ReportsService.getBooking (the authoritative appointment funnel), getQueue (walk-ins), and
// getAppointmentsTrend (bookings-vs-completed time series). It exposes ONLY what the reports layer actually models —
// the booked→completed funnel with cancellation/no-show rates, walk-ins, and the trend. Lead-time, booking-source, and
// utilization are NOT modeled in the reports layer, so they are deliberately omitted rather than fabricated (§9, §13).
import { type ReportsContext, type ReportFilters, type DatePreset, type BookingsOverview, type QueueSummary, type AppointmentsTrend, ForbiddenError } from '@aipowersalon/reports';
import { getMetric, type FreshnessClass } from './ai-business-metrics';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext, presetAllowed, rangeFilters } from './ai-business.dto';
import { deriveWatchItems, DEFAULT_BRIEF_THRESHOLDS, type WatchItem, type BriefThresholds } from './ai-business-brief.dto';

export interface AppointmentSource {
  getBooking(ctx: ReportsContext, f?: ReportFilters): Promise<BookingsOverview>;
  getQueue(ctx: ReportsContext, f?: ReportFilters): Promise<QueueSummary>;
  getAppointmentsTrend(ctx: ReportsContext, f?: ReportFilters): Promise<AppointmentsTrend>;
}

export interface AppointmentMetrics {
  preset: DatePreset;
  partialCurrentPeriod: boolean;
  funnel: {
    totalBookings: number;
    completed: number; completedPercent: number;
    cancelled: number; cancelledPercent: number;
    noShow: number; noShowPercent: number;
    walkIns: number;
  };
  trend: { label: string; date: string; bookings: number; completed: number }[];
  busiestDay: { date: string; bookings: number } | null;   // derived from the trend; null when no data
  attention: WatchItem[];        // sample-size-guarded (§16) rate/queue flags reused from the brief rules
  limitedData: boolean;
  freshnessClass: FreshnessClass;
  drilldownRoute: string;
  notes: string[];
  modeledFields: string[];       // honest list of what IS modeled (so the UI/assistant never implies more)
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'];
const rctx = (c: AiBusinessContext): ReportsContext => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

export class AiBusinessAppointmentsService {
  constructor(
    private readonly reports: AppointmentSource,
    private readonly thresholds: BriefThresholds = DEFAULT_BRIEF_THRESHOLDS,
  ) {}

  async getAppointmentMetrics(ctx: AiBusinessContext, presetInput?: string): Promise<AppointmentMetrics> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    if (!presetAllowed(ctx, presetInput, VALID_PRESETS)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    const preset = (presetInput as DatePreset) ?? 'today';
    const filters: ReportFilters = { preset, ...rangeFilters(ctx, preset) };
    const c = rctx(ctx);

    let booking: BookingsOverview, queue: QueueSummary, trend: AppointmentsTrend;
    try {
      [booking, queue, trend] = await Promise.all([
        this.reports.getBooking(c, filters), this.reports.getQueue(c, filters), this.reports.getAppointmentsTrend(c, filters),
      ]);
    } catch (e) {
      if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
      throw e;
    }

    const appts = {
      totalBookings: booking.totalBookings,
      completed: booking.completed, completedPercent: booking.completedPercent,
      cancelled: booking.cancelled, cancelledPercent: booking.cancelledPercent,
      noShow: booking.noShow, noShowPercent: booking.noShowPercent,
    };
    // Reuse the brief's pure, sample-size-guarded rules — but keep only appointment/queue attention items.
    const { watch, limitedData } = deriveWatchItems(appts, queue, this.thresholds);

    const busiestDay = trend.points.length
      ? trend.points.reduce((best, p) => (p.bookings > best.bookings ? { date: p.date, bookings: p.bookings } : best), { date: trend.points[0].date, bookings: trend.points[0].bookings })
      : null;

    const m = getMetric('completed_appointments')!;
    const notes: string[] = [];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (limitedData) notes.push(`Only ${appts.totalBookings} booking(s) in this period \u2014 rate-based flags are suppressed to avoid over-reading a small sample.`);

    return {
      preset, partialCurrentPeriod: preset === 'today',
      funnel: { ...appts, walkIns: queue.walkIns },
      trend: trend.points,
      busiestDay,
      attention: watch, limitedData,
      freshnessClass: m.freshness,
      drilldownRoute: m.drilldownRoute,
      notes,
      modeledFields: ['totalBookings', 'completed', 'cancelled', 'noShow', 'walkIns', 'trend(bookings,completed)'],
    };
  }
}
