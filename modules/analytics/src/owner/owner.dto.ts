import { zonedParts as zparts } from '@aipowersalon/date-time';   // owned by @aipowersalon/date-time (Constitution 13 §87)
import type { OwnerDashboardState, OwnerAllowedBranch, OwnerContextResponse, OwnerSalonOverview, OwnerBranchPerformanceState, OwnerPeriod, OwnerBookingOverview, OwnerAppointmentListItem, OwnerTicketRow, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTopTechnician, OwnerStaffPerformanceState, OwnerStaffAttendance, OwnerTechnicianDetail, OwnerFinanceSummary, OwnerPaymentMethod, OwnerPaymentMix, OwnerReportInfo, OwnerReportExport, OwnerAlertSeverity, OwnerAlertStatus, OwnerAlert, OwnerAlertSummary, OwnerProfileCard, OwnerSettingsSnapshot, OwnerAuditEntry, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerLiveTechRow, OwnerLiveQueueRow, OwnerLiveTeamRow, OwnerPayrollPeriodStatus, OwnerPayrollPeriodSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerCustomerKpis, OwnerLoyaltyTier, OwnerLoyaltyOverview, OwnerTopSpender, OwnerInventoryStatusCounts, OwnerInventoryReorderItem, OwnerInventoryCategory, OwnerMarketingKpis, OwnerMarketingChannel, OwnerMarketingCampaign, OwnerPaymentMethodSlice, OwnerPaymentsSummary, OwnerPaymentTxn, OwnerPaymentRefund, OwnerApprovalItem } from '@aipowersalon/api-contracts/tenant';
export type { OwnerDashboardState, OwnerAllowedBranch, OwnerContextResponse, OwnerSalonOverview, OwnerBranchPerformanceState, OwnerPeriod, OwnerBookingOverview, OwnerAppointmentListItem, OwnerTicketRow, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTopTechnician, OwnerStaffPerformanceState, OwnerStaffAttendance, OwnerTechnicianDetail, OwnerFinanceSummary, OwnerPaymentMethod, OwnerPaymentMix, OwnerReportInfo, OwnerReportExport, OwnerAlertSeverity, OwnerAlertStatus, OwnerAlert, OwnerAlertSummary, OwnerProfileCard, OwnerSettingsSnapshot, OwnerAuditEntry, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerLiveTechRow, OwnerLiveQueueRow, OwnerLiveTeamRow, OwnerPayrollPeriodStatus, OwnerPayrollPeriodSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerCustomerKpis, OwnerLoyaltyTier, OwnerLoyaltyOverview, OwnerTopSpender, OwnerInventoryStatusCounts, OwnerInventoryReorderItem, OwnerInventoryCategory, OwnerMarketingKpis, OwnerMarketingChannel, OwnerMarketingCampaign, OwnerPaymentMethodSlice, OwnerPaymentsSummary, OwnerPaymentTxn, OwnerPaymentRefund, OwnerApprovalItem };   // owned by packages/api-contracts (Constitution 13 §13)
/* owner.dto.ts — Owner App contracts + pure date/percent helpers (no money as float; integer cents everywhere). */
export interface DateRange { fromIso: string; toIso: string; fromDate?: string; toDate?: string }

// Owner gift-card liability & activity report. Outstanding is the CURRENT liability (remaining balances); issued/redeemed
// are period activity from the ledger. Decision-independent of revenue recognition (these are balances + value movements).
export interface OwnerGiftCardReport {
  range: { from: string; to: string };
  outstandingCents: number; activeCount: number; totalCards: number;
  issuedCents: number; issuedCount: number; redeemedCents: number; redeemedCount: number;
  generatedAt: string;
}
// Trend %: (curr-prev)/prev, 1 decimal. prev==0 → 100 if curr>0 else 0 (avoids divide-by-zero / Infinity).
export function pct(curr: number, prev: number): number {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}
// Monday-anchored week start (local). half-open [start, end).
// ---- timezone-aware day/week/period boundaries (IANA tz; defaults to UTC) ----
// UTC instant of tenant-local midnight for civil Y/M/D, robust across DST transitions (refines the offset once).
function zStartOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const offAt = (ms: number) => { const p = zparts(new Date(ms), timeZone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms; };
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const off1 = offAt(guess);
  let real = guess - off1;
  const off2 = offAt(real);
  if (off2 !== off1) real = guess - off2;
  return new Date(real);
}
const zSod = (instant: Date, tz: string): Date => { const p = zparts(instant, tz); return zStartOfDay(p.year, p.month, p.day, tz); };
// start-of-day `delta` civil days away, walking one day at a time so DST never accumulates error.
function zShiftDays(startUTC: Date, delta: number, tz: string): Date {
  let cur = startUTC;
  for (let i = 0; i < Math.abs(delta); i++) { const probe = delta > 0 ? new Date(cur.getTime() + 36 * 3600 * 1000) : new Date(cur.getTime() - 12 * 3600 * 1000); cur = zSod(probe, tz); }
  return cur;
}
// Tenant-local civil date (YYYY-MM-DD) of an instant. For UTC this equals instant.toISOString().slice(0,10).
export function civilDate(instant: Date, timeZone = 'UTC'): string { const p = zparts(instant, timeZone); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
// Build a DateRange carrying tenant-local date bounds (toDate = the last day actually included, i.e. civil date of toIso-1ms),
// so consumers filtering a DATE column (e.g. appt_date, which is salon-local) compare local-to-local instead of slicing UTC.
const dr = (from: Date, to: Date, tz: string): DateRange => ({ fromIso: from.toISOString(), toIso: to.toISOString(), fromDate: civilDate(from, tz), toDate: civilDate(new Date(to.getTime() - 1), tz) });

export function weekStart(d: Date, timeZone = 'UTC'): Date { const p = zparts(d, timeZone); const sod = zStartOfDay(p.year, p.month, p.day, timeZone); return zShiftDays(sod, -((p.weekday + 6) % 7), timeZone); }
export function ranges(now: Date, timeZone = 'UTC') {
  const todayFrom = zSod(now, timeZone); const tomorrow = zShiftDays(todayFrom, 1, timeZone);
  const yFrom = zShiftDays(todayFrom, -1, timeZone);
  const wkFrom = weekStart(now, timeZone); const priorWkFrom = zShiftDays(wkFrom, -7, timeZone);
  // prior-week comparison uses the same elapsed window length for comparability
  const elapsedMs = now.getTime() - wkFrom.getTime(); const priorWkTo = new Date(priorWkFrom.getTime() + elapsedMs);
  return {
    today: dr(todayFrom, tomorrow, timeZone),
    yesterday: dr(yFrom, todayFrom, timeZone),
    week: dr(wkFrom, now, timeZone),
    priorWeek: dr(priorWkFrom, priorWkTo, timeZone),
    weekDays: Array.from({ length: 7 }, (_, i) => { const f = zShiftDays(wkFrom, i, timeZone); const e = zShiftDays(wkFrom, i + 1, timeZone); return { date: civilDate(f, timeZone), ...dr(f, e, timeZone) }; }),
  };
}

// Current window [start, now) + a comparison window of equal elapsed length ending one period earlier.
export function periodRange(now: Date, period: OwnerPeriod, timeZone = 'UTC'): { from: DateRange; prev: DateRange } {
  if (period === 'today') {
    const s = zSod(now, timeZone); const to = zShiftDays(s, 1, timeZone); const y = zShiftDays(s, -1, timeZone);
    return { from: dr(s, to, timeZone), prev: dr(y, s, timeZone) };
  }
  const p = zparts(now, timeZone);
  let start: Date, prevStart: Date;
  if (period === 'week') { start = weekStart(now, timeZone); prevStart = zShiftDays(start, -7, timeZone); }
  else if (period === 'month') { start = zStartOfDay(p.year, p.month, 1, timeZone); const pm = p.month === 1 ? { y: p.year - 1, m: 12 } : { y: p.year, m: p.month - 1 }; prevStart = zStartOfDay(pm.y, pm.m, 1, timeZone); }
  else if (period === 'quarter') { const qm = Math.floor((p.month - 1) / 3) * 3 + 1; start = zStartOfDay(p.year, qm, 1, timeZone); const back = qm - 3 < 1; prevStart = zStartOfDay(back ? p.year - 1 : p.year, back ? qm + 9 : qm - 3, 1, timeZone); }
  else { start = zStartOfDay(p.year, 1, 1, timeZone); prevStart = zStartOfDay(p.year - 1, 1, 1, timeZone); }
  const elapsed = now.getTime() - start.getTime();
  return { from: dr(start, now, timeZone), prev: dr(prevStart, new Date(prevStart.getTime() + elapsed), timeZone) };
}

export function customPeriodRange(startDate: string, endDate: string, timeZone = 'UTC'): { from: DateRange; prev: DateRange } {
  let s: Date;
  let e: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const [y, m, d] = startDate.split('-').map(Number);
    s = zStartOfDay(y, m, d, timeZone);
  } else {
    s = new Date(startDate);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const [y, m, d] = endDate.split('-').map(Number);
    const endSod = zStartOfDay(y, m, d, timeZone);
    e = zShiftDays(endSod, 1, timeZone);
  } else {
    e = new Date(endDate);
  }
  if (s.getTime() > e.getTime()) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  const from = dr(s, e, timeZone);
  const elapsed = Math.max(1000, e.getTime() - s.getTime());
  const prevStart = new Date(s.getTime() - elapsed);
  const prevEnd = s;
  const prev = dr(prevStart, prevEnd, timeZone);
  return { from, prev };
}

export interface OwnerBranchListItem { branchId: string; branchName: string; status: string; city: string | null; address?: string | null; state?: string | null; hasSwitchPin?: boolean }
export interface OwnerBranchDetail {
  branchId: string; branchName: string; status: string;
  period: { from: string; to: string };
  revenueCents: number; revenueTrendPercent: number; bookingCount: number; averageTicketCents: number;
  tipsCents: number; newClients: number; activeTechnicians: number; scheduledTechnicians: number;
}

// ---- Module 3: Booking Overview ----
export type OwnerBookingPeriod = 'today' | 'week';
// percentage of a total, 1 decimal; total==0 → 0 (never NaN).
export function pctOf(count: number, total: number): number { return total > 0 ? Math.round((count / total) * 1000) / 10 : 0; }
export interface OwnerAppointmentDetail extends OwnerAppointmentListItem {
  customerPhone: string | null; durationMinutes: number; depositStatus: string; isVip: boolean; notes: string | null; services: unknown;
}

export interface OwnerTechnicianEarnings { technicianId: string; period: { from: string; to: string }; salesCents: number; commissionCents: number; tipsCents: number; totalEstimateCents: number }

// CSV helper: quote fields containing comma/quote/newline; join rows with CRLF.
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}



// ---- Expenses (operating costs → real net profit = revenue − commission − expenses) ----
export const EXPENSE_CATEGORIES = ['rent', 'supplies', 'utilities', 'payroll', 'marketing', 'equipment', 'maintenance', 'insurance', 'software', 'other'] as const;
export type OwnerExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export interface OwnerTicketList { tickets: OwnerTicketRow[]; total: number; page: number; pageSize: number; }
export interface OwnerTicketHistory { ticket: OwnerTicketDetail; lines: OwnerTicketLine[]; revisions: OwnerTicketRevision[]; }
export interface OwnerTicketFilters { branchId?: string; status?: string; search?: string; dateFrom?: string; dateTo?: string; tz?: string; page?: number; pageSize?: number; }

export interface OwnerLiveOperations {
  branchId: string | null;
  counts: { waiting: number; serving: number; completedToday: number };
  techQueue: OwnerLiveTechRow[];
  liveQueue: OwnerLiveQueueRow[];
  /** Every technician in scope with the authoritative live state (workforce audit #28; Oct 12 2026 merge). */
  team: OwnerLiveTeamRow[];
  todaySoFar: { servicesDone: number; walkIns: number };
  signals: { readyForCheckout: number; delayedAppointments: number };
  generatedAt: string;
}

export interface OwnerPayrollList { periods: OwnerPayrollPeriodSummary[]; kpis: OwnerPayrollKpis }
export interface OwnerPayrollPeriodDetail {
  period: OwnerPayrollPeriodSummary;
  totals: { grossSalesCents: number; commissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number; guaranteeTopupCents: number; adjustmentCents: number; payableCents: number; technicianCount: number };
  lines: OwnerPayrollLine[];
}

export interface OwnerCustomersOverview {
  range: { from: string; to: string };
  kpis: OwnerCustomerKpis;
  loyalty: OwnerLoyaltyOverview;
  topSpenders: OwnerTopSpender[];
  generatedAt: string;
}

export interface OwnerInventoryOverview {
  totalProducts: number;          // catalog size (non-archived tenant products)
  stockPositions: number;         // product×branch stock rows in scope
  statusCounts: OwnerInventoryStatusCounts;
  needsReorderCount: number;      // low + critical + out_of_stock
  stockValueCents: number | null; // sum(cost_cents × on-hand) — cost basis; null if not permitted
  retailValueCents: number | null;
  brandsCount: number; vendorsCount: number; categoriesCount: number;
  topCategories: OwnerInventoryCategory[];
  reorderList: OwnerInventoryReorderItem[];
  generatedAt: string;
}

export interface OwnerMarketingOverview {
  kpis: OwnerMarketingKpis;
  channels: OwnerMarketingChannel[];
  topCampaigns: OwnerMarketingCampaign[];
  generatedAt: string;
}

export interface OwnerPaymentsOverview {
  range: { from: string; to: string };
  summary: OwnerPaymentsSummary;
  transactions: OwnerPaymentTxn[];
  refunds: OwnerPaymentRefund[];
  generatedAt: string;
}

export interface OwnerApprovals {
  items: OwnerApprovalItem[];
  counts: { payrollToApprove: number; payrollToLock: number; openAlerts: number };
  generatedAt: string;
}

// ── Home "Needs Attention" strip: a single lightweight aggregate of the cross-module signals the owner should act on —
// pending payroll approvals (finance-gated), low/out-of-stock counts (reusing the canonical inventory status), and open
// operational alerts (alerts-gated). Each count degrades to 0 when the user lacks the relevant permission. ──
export interface OwnerAttention {
  payrollToApprove: number; payrollToLock: number;
  lowStock: number; outOfStock: number;
  openAlerts: number;
  generatedAt: string;
}
