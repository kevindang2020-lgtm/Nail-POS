// reports.dto.ts — AIPowerSalon POS Reports contracts.
// Endpoints derive tenantId/branchId from the authenticated session — never from the client (§3).
// Super Admin all-tenant reports are a separate surface (/super-admin/reports); NOT this module.

export type ReportKey =
  | "sales" | "bookings" | "services" | "technician_performance"
  | "customer" | "inventory" | "commission" | "no_show";
export type ExportFormat = "pdf" | "excel" | "csv";

// ---- §8 KPIs ----
export interface ReportKpis {
  totalRevenueCents: number;
  revenueTrendPercent: number;
  totalBookings: number;
  bookingsTrendPercent: number;
  completedServices: number;
  completedServicesTrendPercent: number;
  newCustomers: number;
  newCustomersTrendPercent: number;
  averageRating: number;
  averageRatingDelta: number;
  noShowRatePercent: number;
  noShowRateDeltaPercent: number;
}

// ---- §9 revenue overview ----
export interface RevenueOverview {
  totalRevenueCents: number;
  trendPercent: number;
  previousRangeLabel: string;
  points: { label: string; date: string; revenueCents: number }[];
}

// ---- §10 bookings overview ----
export interface BookingsOverview {
  totalBookings: number;
  completed: number; completedPercent: number;
  cancelled: number; cancelledPercent: number;
  noShow: number; noShowPercent: number;
}

// ---- §11 revenue by service ----
export interface RevenueByServiceItem {
  serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number;
}

// ---- §12 top technicians ----
export interface TopTechnicianRevenue {
  technicianId: string; rank: number; name: string; roleLabel: string; avatarUrl?: string; revenueCents: number; completedServices: number;
}

// ---- §13 appointments trend ----
export interface AppointmentsTrend {
  points: { label: string; date: string; bookings: number; completed: number }[];
}

// ---- §14 customer insights ----
export interface CustomerInsights {
  newCustomers: number; newCustomersTrendPercent: number;
  returningCustomers: number; returningCustomersTrendPercent: number;
  retentionRatePercent: number; retentionRateTrendPercent: number;
}

// ---- §15 reports list + export ----
export interface AvailableReport { reportKey: ReportKey; label: string; description?: string; exportFormats: ExportFormat[]; }
export interface ExportReportRequest { reportKey: string; startDate: string; endDate: string; format: ExportFormat; }
export interface ReportExportAudit {
  tenantId: string; branchId: string; userId: string; role: string;
  reportKey: string; format: ExportFormat; startDate: string; endDate: string; createdAt: string;
}

// ---- §16 mobile summary ----
export interface MobileReportSummary {
  rangeLabel: string;
  revenueCents: number; revenueTrendPercent: number;
  bookings: number; bookingsTrendPercent: number;
  completed: number; completedTrendPercent: number;
  newCustomers: number; newCustomersTrendPercent: number;
  revenueTrend: { label: string; revenueCents: number }[];
}

// ---- §17 consolidated state ----
export interface POSReportsState {
  kpis: ReportKpis;
  revenueOverview: RevenueOverview;
  bookingsOverview: BookingsOverview;
  revenueByService: RevenueByServiceItem[];
  topTechnicians: TopTechnicianRevenue[];
  appointmentsTrend: AppointmentsTrend;
  customerInsights: CustomerInsights;
  availableReports: AvailableReport[];
}

// ===== pure calculation helpers (§19, unit-testable) =====

export function trendPercent(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
export function noShowRate(noShow: number, totalScheduled: number): number {
  if (totalScheduled <= 0) return 0;
  return Math.round((noShow / totalScheduled) * 1000) / 10;
}
export function completedPercent(completed: number, totalBookings: number): number {
  if (totalBookings <= 0) return 0;
  return Math.round((completed / totalBookings) * 1000) / 10;
}
export function retentionRate(returningCustomers: number, totalActiveCustomers: number): number {
  if (totalActiveCustomers <= 0) return 0;
  return Math.round((returningCustomers / totalActiveCustomers) * 1000) / 10;
}

// §11/§12/§19 sum line-total snapshots grouped by a key (service_id or technician_id)
export interface RevenueLine { key: string; name: string; lineTotalCents: number; }
export function groupRevenueBy(lines: RevenueLine[]): { key: string; name: string; revenueCents: number; count: number }[] {
  const map = new Map<string, { key: string; name: string; revenueCents: number; count: number }>();
  for (const l of lines) {
    const cur = map.get(l.key) || { key: l.key, name: l.name, revenueCents: 0, count: 0 };
    cur.revenueCents += l.lineTotalCents;
    cur.count += 1;
    map.set(l.key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

// ===== §8/§10/§11 additions: filters, sales KPIs, per-report summaries, tables =====
export type DatePreset = "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom";

// server-side filters (§11) — applied in the repository, never only in the UI
export interface ReportFilters {
  from?: string; to?: string; preset?: DatePreset;
  /** server-side only (never a query param): read the EQUIVALENT PREVIOUS period of `preset` — same length, to the same point */
  period?: 'current' | 'previous';
  branchId?: string; technicianId?: string; serviceCategory?: string; service?: string;
  paymentMethod?: string; bookingSource?: string; customerType?: string; status?: string; search?: string;
}
export interface ReportsDateRange { from: string; to: string; preset: DatePreset; }

export interface SalesKpis {
  grossSalesCents: number; netSalesCents: number; serviceSalesCents: number; productSalesCents: number;
  tipsCents: number; taxCollectedCents: number; cardSurchargeCents: number; discountsCents: number;
  refundsCents: number; ticketsCount: number; customersCount: number; averageTicketCents: number;
}
export interface SalesTrend { points: { label: string; grossSalesCents: number; netSalesCents: number }[]; }

export interface PaymentsSummary {
  cardCents: number; cashCents: number; giftCardCents: number; splitCount: number;
  refundsCents: number; cardSurchargeCents: number; processorStatus: string;
}
export interface TipsSummary {
  totalCents: number; cardTipsCents: number; cashTipsCents: number; tipPercentAvg: number;
  noTipCount: number; managerApprovalCount: number; byTechnician: { technicianId: string; name: string; tipsCents: number }[];
}
export interface TaxSummary {
  taxableSalesCents: number; exemptSalesCents: number; taxCollectedCents: number; taxRatePercent: number;
  byCategory: { category: string; taxCents: number }[]; adjustmentsCents: number;
}
export interface DiscountSurchargeSummary {
  discountCents: number; discountCount: number; topReason: string;
  cardSurchargeCents: number; surchargePercent: number; cashDiscountCents: number;
}
export interface QueueSummary {
  averageWaitMinutes: number; longestWaitMinutes: number; walkIns: number; skipped: number;
  peakWindow: string; byTechnician: { technicianId: string; name: string; avgWaitMinutes: number }[];
}

export interface TransactionRow {
  id: string; ticketId?: string | null; at: string; customer: string; technician: string; service: string;
  paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string;
}
export interface PaymentRow { id: string; at: string; method: string; amountCents: number; surchargeCents: number; status: string; }

// Consolidated state actually returned by GET /pos/reports/state (extends the original contract).
export interface POSReportsFullState extends POSReportsState {
  dateRange: ReportsDateRange;
  salesKpis: SalesKpis;
  salesTrend: SalesTrend;
  payments: PaymentsSummary;
  tips: TipsSummary;
  tax: TaxSummary;
  discountSurcharge: DiscountSurchargeSummary;
  queue: QueueSummary;
  transactions: TransactionRow[];
}

// export helper (§12): build CSV from rows (no library); values are sanitized against CSV formula injection
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s;            // neutralize formula injection (CWE-1236)
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
