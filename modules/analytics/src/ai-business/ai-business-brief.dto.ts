// ai-business-brief.dto.ts — the owner/manager daily brief contract (spec §11). Pure types + pure watch-rule builder.
// The brief COMPOSES existing report sections (sales + bookings + queue) into one briefing; it never recomputes them
// and never fabricates a section — an unauthorized or unmodeled section is marked unavailable, not invented (§9, §24).
import type { DatePreset, SalesKpis, BookingsOverview, QueueSummary } from '@aipowersalon/reports';
import type { FreshnessClass } from './ai-business-metrics';

/** Revenue section: present only when the caller holds financial permission; otherwise explicitly restricted. */
export type BriefRevenue =
  | { available: true; netSalesCents: number; grossSalesCents: number; averageTicketCents: number; ticketsCount: number; customersCount: number; refundsCents: number; discountsCents: number }
  | { available: false; reason: 'restricted_financial' };

export interface BriefAppointments {
  totalBookings: number;
  /** shares of totalBookings; null = nothing booked (N/A) — batch 9 guide 5: these are real appointment outcomes now */
  completed: number; completedPercent: number | null;
  cancelled: number; cancelledPercent: number | null;
  noShow: number; noShowPercent: number | null;
}
export interface BriefQueue {
  averageWaitMinutes: number; longestWaitMinutes: number; walkIns: number; skipped: number; peakWindow: string;
}

export type WatchSeverity = 'info' | 'watch';
export interface WatchItem {
  code: string;
  severity: WatchSeverity;
  message: string;
  metric?: string;     // metric id this relates to (for drilldown)
  value?: number;      // the observed value that tripped the rule
  threshold?: number;  // the threshold it crossed (shown so nothing is a black box)
}

export interface DailyBrief {
  preset: DatePreset;
  generatedAt: string;
  partialCurrentPeriod: boolean;   // true for 'today' (§10 — partial-day labeling)
  revenue: BriefRevenue;
  appointments: BriefAppointments;
  queue: BriefQueue;
  watch: WatchItem[];
  limitedData: boolean;            // true when sample size is below the minimum for percent-based signals (§16)
  freshnessClass: FreshnessClass;
  drilldowns: { revenue: string; appointments: string; queue: string };
  notes: string[];
}

/** Configurable thresholds for watch signals. Defaults here; a later settings slice makes them tenant-configurable. */
export interface BriefThresholds {
  minSampleBookings: number;   // below this, suppress percent-based watch items and flag limitedData (§16)
  noShowPercent: number;
  cancelledPercent: number;
  longestWaitMinutes: number;
}
export const DEFAULT_BRIEF_THRESHOLDS: BriefThresholds = {
  minSampleBookings: 10, noShowPercent: 15, cancelledPercent: 20, longestWaitMinutes: 25,
};

/** Pure, deterministic watch-rule evaluation. Only fires on measured values crossing an explicit threshold; every
 *  item carries its value + threshold so nothing is a hidden judgement. Percent rules are suppressed under the minimum
 *  sample size to avoid alarming conclusions from a handful of appointments (§16, §17). */
export function deriveWatchItems(a: BriefAppointments, q: BriefQueue, t: BriefThresholds = DEFAULT_BRIEF_THRESHOLDS): { watch: WatchItem[]; limitedData: boolean } {
  const watch: WatchItem[] = [];
  const limitedData = a.totalBookings < t.minSampleBookings;

  if (!limitedData) {
    if (a.noShowPercent != null && a.noShowPercent >= t.noShowPercent) watch.push({
      code: 'no_show_rate', severity: 'watch', metric: 'no_shows', value: a.noShowPercent, threshold: t.noShowPercent,
      message: `No-show rate is ${a.noShowPercent}% (${a.noShow} of ${a.totalBookings}).`,
    });
    if (a.cancelledPercent != null && a.cancelledPercent >= t.cancelledPercent) watch.push({
      code: 'cancellation_rate', severity: 'watch', metric: 'cancellations', value: a.cancelledPercent, threshold: t.cancelledPercent,
      message: `Cancellation rate is ${a.cancelledPercent}% (${a.cancelled} of ${a.totalBookings}).`,
    });
  }
  // Queue waits are absolute, not rate-based — safe to report regardless of booking sample size.
  if (q.longestWaitMinutes >= t.longestWaitMinutes) watch.push({
    code: 'long_wait', severity: 'watch', metric: 'longest_wait', value: q.longestWaitMinutes, threshold: t.longestWaitMinutes,
    message: `Longest wait reached ${q.longestWaitMinutes} minutes${q.peakWindow ? ` (peak ${q.peakWindow})` : ''}.`,
  });
  if (q.skipped > 0) watch.push({
    code: 'queue_skips', severity: 'info', metric: 'queue_skipped', value: q.skipped, threshold: 0,
    message: `${q.skipped} customer(s) were skipped in the queue.`,
  });

  return { watch, limitedData };
}
