// GET /pos/reports/transactions/page — the Daily Summary's transaction list, one server page at a time
// (SUNMI batch 9, Nov 10 2026). Newest first (occurredAt desc, id desc); the search is scoped to the period + branch.
export interface ReportTransactionRow {
  id: string; ticketId?: string | null; at: string; occurredAt?: string; customer: string; technician: string; service: string;
  paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string;
}
export interface ReportTransactionPage { items: ReportTransactionRow[]; total: number; page: number; pageSize: number; q: string | null; from: string; to: string }
export const REPORT_TRANSACTION_PAGE_SIZES = [10, 25, 50, 100] as const;

// GET /pos/reports/service-revenue — Revenue by Service, shared by Daily Summary and the Services Report (batch 9 guide 2).
// Categories rank by sales (desc, stable); the line history is newest first; totals cover EVERY match, not one page.
export interface ServiceRevenueLine {
  id: string; ticketId: string; ticketNumber: string | null; occurredAt: string; serviceId: string | null; serviceName: string;
  category: string; unmapped: boolean; noLines?: boolean; technicianId: string | null; technician: string;
  /** '' when the viewer may not see customer names */
  customer: string; units: number; grossCents: number;
}
export interface ServiceRevenueCategoryRow { key: string; name: string; units: number; grossCents: number; lines: number; percentOfTop: number; unmapped: boolean }
export interface ServiceRevenueReport {
  period: { from: string; to: string; timezone: string | null };
  basis: 'paid_ticket_service_lines';
  asOf: string;
  filters: { q: string | null; category: string | null; technician?: string | null };
  /** the whole filtered set (search + category) */
  totals: { grossCents: number; units: number; lines: number; tickets: number; averageCents: number | null; ticketDiscountCents: number; refundedCents: number };
  /** search applied, category NOT applied — so every bar stays visible while one is selected */
  categories: ServiceRevenueCategoryRow[];
  history: { items: ServiceRevenueLine[]; total: number; page: number; pageSize: number };
  customersVisible: boolean;
}
export const SERVICE_REVENUE_PAGE_SIZES = [25, 50, 100] as const;

// GET /pos/reports/tickets/page — Sales Report Ticket Explorer (batch 9 guide 4): one row per PAID ticket of the period,
// newest first; each money part its own figure; refunds beside the ticket. Financial permission required.
export interface ReportTicketRow {
  ticketId: string; ticketNumber: string | null; occurredAt: string; customer: string; services: string[]; technicians: string[]; methods: string[];
  salesCents: number; discountCents: number; netCents: number; taxCents: number; tipCents: number; surchargeCents: number;
  chargedCents: number; refundedCents: number; status: 'paid' | 'refunded' | 'partially_refunded';
}
export interface ReportTicketPage { items: ReportTicketRow[]; total: number; page: number; pageSize: number; q: string | null; from: string; to: string; timezone: string | null }

// state.trend — the Revenue & Appointments Trend (batch 9 guide 3): every bucket of the period, oldest → newest
export type TrendGroupBy = 'hour' | 'day' | 'week' | 'month';
export interface TrendBucket { key: string; from: string; to: string; revenueCents: number; tickets: number }
export interface TrendCompare { from: string; to: string; revenueCents: number; tickets: number; revenueChangePercent: number | null; ticketsChangePercent: number | null }
export interface RevenueTrend { groupBy: TrendGroupBy; groupByOptions: TrendGroupBy[]; timezone: string; buckets: TrendBucket[]; totalRevenueCents: number; totalTickets: number; compare?: TrendCompare | null }

// GET /pos/reports/customers/page — Customers Report list (batch 9 guide 7): the period's KNOWN customers with a paid visit,
// most recent visit first. Phone: last 4 digits only. Money only with the financial permission (null otherwise).
export interface ReportCustomerRow { customerId: string; customer: string; phoneLast4: string | null; type: 'new' | 'returning'; visits: number; lastVisitAt: string; netSalesCents: number | null }
export interface ReportCustomerPage { items: ReportCustomerRow[]; total: number; page: number; pageSize: number; q: string | null; type: 'all' | 'new' | 'returning'; from: string; to: string; timezone: string | null; moneyVisible: boolean }
