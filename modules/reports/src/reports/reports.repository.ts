// reports.repository.ts — persistence port + in-memory adapter for POS Reports.
// Everything (KPIs, summaries, tables) is COMPUTED from a tenant-scoped transaction list by the shared pure builders
// below, so server-side filters genuinely change the result (§11) and the in-memory and Postgres adapters produce
// identical math. A different tenant sees its own (empty) data — isolation.
// ASYNC: the port is async (the Postgres/Kysely adapter awaits real queries; the in-memory adapter is trivially async).
import type { ServiceLineFact } from './service-revenue';
import type { ReportTicketFact } from './report-tickets';
import { taxCents as taxOf } from '@aipowersalon/money';
import {
  POSReportsFullState, ReportFilters, ReportsDateRange, SalesKpis, SalesTrend, PaymentsSummary, TipsSummary,
  TaxSummary, DiscountSurchargeSummary, QueueSummary, TransactionRow, completedPercent,
} from './reports.dto';

export interface Tx {
  id: string; at: string; customerId: string; customer: string; customerType: 'new' | 'returning' | 'vip';
  technicianId: string; technician: string; service: string; category: string; paymentMethod: string;
  bookingSource: string; grossCents: number; discountCents: number; surchargeCents: number; taxCents: number;
  tipCents: number; status: 'completed' | 'refunded';
  /** The payment's ticket (Oct 2 2026: the POS Transactions screen refunds by ticket — Decision 20). */
  ticketId?: string | null;
  /** Team Tips P0 (Nov 13 2026): this row carries its ticket's own figures (tip / tax / discount / sales) — the ticket's earliest
   *  collected row. Absent (in-memory demo rows) → every row carries its own. */
  carrier?: boolean;
  /** when the payment was recorded (ISO) — the newest-first order of the paged transactions list (Nov 10 2026) */
  occurredAt?: string;
  /** Wave 4 PILOT (Oct 13 2026): the TICKET's sales (service + retail lines, before discounts) and its retail part,
   *  carried on ONE payment row per ticket. Absent (in-memory demo rows) → the payment amount is the sale, as before. */
  salesCents?: number; productCents?: number;
}

export interface ReportsContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface ReportsRepositoryPort {
  /** serviceLines: the period's service-line facts (batch 9 guide 2) — the Kysely adapter fills it; the in-memory one does not */
  query(ctx: ReportsContext, filters: ReportFilters): Promise<{ state: POSReportsFullState; rows: TransactionRow[]; serviceLines?: { lines: ServiceLineFact[]; discountByTicket: Record<string, number>; refundByTicket: Record<string, number> }; tickets?: ReportTicketFact[]; returningIds?: string[] }>;
  exportRows(ctx: ReportsContext, type: string, filters: ReportFilters): Promise<{ headers: string[]; rows: (string | number)[][] }>;
}

export function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

export function applyFilters(rows: Tx[], f: ReportFilters, seedBranch: string): Tx[] {
  // a single seeded/served branch; if a different branch is requested there is no data for it (branch isolation)
  if (f.branchId && f.branchId !== seedBranch) return [];
  const from = f.from || daysAgo(7);
  const to = f.to || daysAgo(0);
  return rows.filter((r) => {
    if (r.at < from || r.at > to) return false;
    if (f.technicianId && r.technicianId !== f.technicianId) return false;
    if (f.paymentMethod && r.paymentMethod !== f.paymentMethod) return false;
    if (f.serviceCategory && r.category !== f.serviceCategory) return false;
    if (f.bookingSource && r.bookingSource !== f.bookingSource) return false;
    if (f.customerType && r.customerType !== f.customerType) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.search) { const q = f.search.toLowerCase(); if (![r.customer, r.service, r.technician].some((x) => x.toLowerCase().includes(q))) return false; }
    return true;
  });
}

function sum(rows: Tx[], pick: (t: Tx) => number): number { return rows.reduce((s, r) => s + pick(r), 0); }

// ---- shared pure builders (used by BOTH the in-memory and Kysely adapters) ----

/**
 * Attribute each ticket's card surcharge to exactly ONE card payment row, returning paymentId -> surchargeCents. A split
 * tender has several payment rows for one ticket but a single ticket-level surcharge; crediting every row would double the
 * reported "card surcharge collected". So the surcharge lands on the first non-refund card row of each ticket and 0 on the
 * rest. Pure + exported so the no-double-count property is unit-tested directly. (Revenue is independent of this — gross
 * already includes the surcharge inside amount_cents; surchargeCents is a display-only breakout.)
 */
export function attributeCardSurcharge(
  rows: { id: string; ticketId: string | null; isCard: boolean; isRefund: boolean }[],
  ticketSurchargeCents: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const credited = new Set<string>();
  for (const r of rows) {
    const ts = r.ticketId ? Number(ticketSurchargeCents[r.ticketId] || 0) : 0;
    if (ts > 0 && r.isCard && r.ticketId && !r.isRefund && !credited.has(r.ticketId)) {
      out[r.id] = ts;
      credited.add(r.ticketId);
    } else {
      out[r.id] = 0;
    }
  }
  return out;
}

export function buildReportsState(all: Tx[], filters: ReportFilters, seedBranch: string): { state: POSReportsFullState; rows: TransactionRow[] } {
  const rows = applyFilters(all, filters, seedBranch);
  const completed = rows.filter((r) => r.status === 'completed');
  const refunded = rows.filter((r) => r.status === 'refunded');
  const gross = sum(completed, (r) => (r.salesCents ?? r.grossCents));          // sales, not everything collected (wave 4 PILOT)
  const products = sum(completed, (r) => r.productCents ?? 0);
  const discounts = sum(rows, (r) => r.discountCents);
  const refunds = sum(refunded, (r) => r.grossCents);
  const tips = sum(completed, (r) => r.tipCents);
  const tax = sum(completed, (r) => r.taxCents);
  const surcharge = sum(completed, (r) => r.surchargeCents);
  const tickets = new Set(completed.map((r) => r.ticketId ?? r.id)).size;   // tickets, not payment rows (a split is one ticket)
  // batch 9 guide 4 (Nov 10 2026): KNOWN customers of PAID tickets — a walk-in (no customer) is not a customer, and a refund
  // row is not a visit; it used to count both
  const customers = new Set(completed.map((r) => r.customerId).filter(Boolean)).size;
  const net = gross - discounts;

  const range: ReportsDateRange = { from: filters.from || daysAgo(7), to: filters.to || daysAgo(0), preset: filters.preset || 'week' };
  const salesKpis: SalesKpis = {
    grossSalesCents: gross, netSalesCents: net, serviceSalesCents: gross - products, productSalesCents: products, tipsCents: tips,
    taxCollectedCents: tax, cardSurchargeCents: surcharge, discountsCents: discounts, refundsCents: refunds,
    ticketsCount: tickets, customersCount: customers, averageTicketCents: tickets ? Math.round(gross / tickets) : 0,
  };
  const byDay = new Map<string, { g: number; n: number }>();
  for (const r of completed) { const k = r.at; const c = byDay.get(k) || { g: 0, n: 0 }; const g = r.salesCents ?? r.grossCents; c.g += g; c.n += g - r.discountCents; byDay.set(k, c); }
  const ticketsByDay = new Map<string, Set<string>>();
  for (const r of completed) { const set = ticketsByDay.get(r.at) || new Set<string>(); set.add(r.ticketId ?? r.id); ticketsByDay.set(r.at, set); }
  const salesTrend: SalesTrend = { points: [...byDay.entries()].sort().map(([label, v]) => ({ label, grossSalesCents: v.g, netSalesCents: v.n })) };

  const payments: PaymentsSummary = {
    cardCents: sum(completed.filter((r) => r.paymentMethod === 'card'), (r) => r.grossCents),
    cashCents: sum(completed.filter((r) => r.paymentMethod === 'cash'), (r) => r.grossCents),
    giftCardCents: sum(completed.filter((r) => r.paymentMethod === 'giftCard'), (r) => r.grossCents),
    splitCount: 0, refundsCents: refunds, cardSurchargeCents: surcharge, processorStatus: 'unknown',   // the Kysely adapter fills the salon's real gateway status (no invented "stub")
  };
  // batch 9 guide 13 (Nov 10 2026): EVERY collected method — cash to technician, rewards, deposits … used to fall out of
  // "Total Collected" (only card / cash / gift card were summed) — and a REAL split count (it was a constant 0):
  // tickets paid with two or more collected payment rows
  const byMethod: Record<string, number> = {};
  for (const r of completed) byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] ?? 0) + (r.grossCents || 0);
  const legsByTicket = new Map<string, number>();
  for (const r of completed) if (r.ticketId) legsByTicket.set(r.ticketId, (legsByTicket.get(r.ticketId) ?? 0) + 1);
  payments.byMethod = byMethod;
  payments.otherCents = Object.entries(byMethod).filter(([m]) => m !== 'card' && m !== 'cash' && m !== 'giftCard').reduce((a, [, v]) => a + v, 0);
  payments.collectedCents = Object.values(byMethod).reduce((a, v) => a + v, 0);
  payments.splitCount = [...legsByTicket.values()].filter((n) => n > 1).length;
  const techMap = new Map<string, { name: string; tips: number }>();
  for (const r of completed) { const c = techMap.get(r.technicianId) || { name: r.technician, tips: 0 }; c.tips += r.tipCents; techMap.set(r.technicianId, c); }
  const tipsSummary: TipsSummary = {
    totalCents: tips, cardTipsCents: sum(completed.filter((r) => r.paymentMethod === 'card'), (r) => r.tipCents),
    cashTipsCents: sum(completed.filter((r) => r.paymentMethod === 'cash'), (r) => r.tipCents),
    tipPercentAvg: gross ? Math.round((tips / gross) * 1000) / 10 : 0, noTipCount: completed.filter((r) => r.tipCents === 0).length,
    managerApprovalCount: 0, byTechnician: [...techMap.entries()].map(([technicianId, v]) => ({ technicianId, name: v.name, tipsCents: v.tips })),
  };
  const taxSummary: TaxSummary = {
    taxableSalesCents: gross - discounts, exemptSalesCents: 0, taxCollectedCents: tax, taxRatePercent: gross - discounts > 0 ? Math.round((tax / (gross - discounts)) * 100000) / 1000 : 0,   // effective rate (the adapter uses the salon's setting); was a fixed 7.75
    byCategory: [...new Set(completed.map((r) => r.category))].map((category) => ({ category, taxCents: sum(completed.filter((r) => r.category === category), (r) => r.taxCents) })), adjustmentsCents: 0,
  };
  const discountSurcharge: DiscountSurchargeSummary = {
    discountCents: discounts, discountCount: rows.filter((r) => r.discountCents > 0).length, topReason: '',   // no per-discount reason in the rows — never an invented "Promo"
    cardSurchargeCents: surcharge, surchargePercent: 0, cashDiscountCents: 0,   // the adapter fills the salon's configured %; was a fixed 3
  };
  const queue: QueueSummary = {
    // wave 4 PILOT: these were invented (12 / 34 min, "5–7 PM", 10 min per technician) — the payment rows carry no wait data
    averageWaitMinutes: 0, longestWaitMinutes: 0, walkIns: rows.filter((r) => r.bookingSource === 'walk_in').length,
    skipped: 0, peakWindow: '', byTechnician: [],
  };

  const txRows: TransactionRow[] = rows.map((r) => ({
    id: r.id, ticketId: r.ticketId ?? null, at: r.at, occurredAt: r.occurredAt, customer: r.customer, technician: r.technician, service: r.service, paymentMethod: r.paymentMethod,
    grossCents: r.grossCents, tipCents: r.tipCents, taxCents: r.taxCents, netCents: r.grossCents - r.discountCents, status: r.status,
  }));

  const totalBookings = rows.length;
  const state: POSReportsFullState = {
    kpis: {
      totalRevenueCents: gross, revenueTrendPercent: 0,   // no previous-period read: no invented trend
      totalBookings, bookingsTrendPercent: 0,
      completedServices: tickets, completedServicesTrendPercent: 0,
      newCustomers: rows.filter((r) => r.customerType === 'new').length, newCustomersTrendPercent: 0,
      averageRating: null, averageRatingDelta: 0, /* filled from reviews by the adapter; null = N/A */ noShowRatePercent: null, noShowRateDeltaPercent: 0,   // filled from appointments by the adapter
    },
    revenueOverview: { totalRevenueCents: gross, trendPercent: 0, previousRangeLabel: 'prev. period', points: salesTrend.points.map((p) => ({ label: p.label, date: p.label, revenueCents: p.grossSalesCents })) },
    bookingsOverview: { basis: 'paid_tickets', totalBookings, completed: tickets, completedPercent: completedPercent(tickets, totalBookings), cancelled: 0, cancelledPercent: 0, noShow: 0, noShowPercent: 0 },
    // Nov 10 2026 (Daily Summary guide §12): SALES basis (service + retail lines, before tax / tip / surcharge) — the same basis as
    // the Sales cards; it used the charged amount (incl. tax + surcharge), so 'Top service by revenue' read $104.99 against $96 sales
    revenueByService: [...new Set(completed.map((r) => r.category))].map((cat) => { const cr = completed.filter((r) => r.category === cat); const rev = sum(cr, (r) => (r.salesCents ?? r.grossCents)); return { serviceId: cat, serviceName: cat, revenueCents: rev, serviceCount: new Set(cr.map((r) => r.ticketId ?? r.id)).size, percentOfTop: 0 }; }).sort((a, b) => b.revenueCents - a.revenueCents),
    topTechnicians: [...techMap.entries()].map(([technicianId, v], i) => ({ technicianId, rank: i + 1, name: v.name, roleLabel: 'Technician', revenueCents: sum(completed.filter((r) => r.technicianId === technicianId), (r) => (r.salesCents ?? r.grossCents)), completedServices: new Set(completed.filter((r) => r.technicianId === technicianId).map((r) => r.ticketId ?? r.id)).size })).sort((a, b) => b.revenueCents - a.revenueCents).map((t, i) => ({ ...t, rank: i + 1 })),
    appointmentsTrend: { points: salesTrend.points.map((p) => ({ label: p.label, date: p.label, bookings: ticketsByDay.get(p.label)?.size ?? 0, completed: ticketsByDay.get(p.label)?.size ?? 0 })) },
    customerInsights: { newCustomers: rows.filter((r) => r.customerType === 'new').length, newCustomersTrendPercent: 0, returningCustomers: rows.filter((r) => r.customerType === 'returning').length, returningCustomersTrendPercent: 0, retentionRatePercent: null, retentionRateTrendPercent: 0 },   // filled by the adapter from the prior-period cohort
    availableReports: [
      { reportKey: 'sales', label: 'Sales', exportFormats: ['csv'] },
      { reportKey: 'services', label: 'Services', exportFormats: ['csv'] },
      { reportKey: 'technician_performance', label: 'Technicians', exportFormats: ['csv'] },
      { reportKey: 'customer', label: 'Customers', exportFormats: ['csv'] },
    ],
    dateRange: range, salesKpis, salesTrend, payments, tips: tipsSummary, tax: taxSummary, discountSurcharge, queue, transactions: txRows,
  };
  return { state, rows: txRows };
}

export function buildExportRows(all: Tx[], type: string, filters: ReportFilters, seedBranch: string): { headers: string[]; rows: (string | number)[][] } {
  const { state } = buildReportsState(all, filters, seedBranch);
  if (type === 'sales') return { headers: ['Date', 'Gross', 'Net'], rows: state.salesTrend.points.map((p) => [p.label, p.grossSalesCents, p.netSalesCents]) };
  if (type === 'technicians') return { headers: ['Technician', 'Revenue', 'Services'], rows: state.topTechnicians.map((t) => [t.name, t.revenueCents, t.completedServices]) };
  // batch 9 guide 15: tax is recorded per ticket — the export gives taxable / exempt sales per category and the period's tax
  if (type === 'tax') return { headers: ['Category', 'Taxable sales (cents, before discounts)', 'Exempt sales (cents)', 'Tax collected (cents, whole period)'], rows: [...state.tax.byCategory.map((c) => [c.category, c.taxableCents ?? 'N/A', c.exemptCents ?? 'N/A', '']), ['All categories', state.tax.taxableSalesCents, state.tax.exemptSalesCents, state.tax.taxCollectedCents]] };
  if (type === 'customers') return { headers: ['Metric', 'Value'], rows: [['New Customers', state.customerInsights.newCustomers], ['Returning Customers', state.customerInsights.returningCustomers], ['Retention Rate (%)', state.customerInsights.retentionRatePercent ?? 'N/A']] };
  if (type === 'services') return { headers: ['Service Name', 'Revenue', 'Service Count'], rows: state.revenueByService.map((s) => [s.serviceName, s.revenueCents, s.serviceCount]) };
  if (type === 'payments') return { headers: ['Metric', 'Amount (Cents)'], rows: [['Card', state.payments.cardCents], ['Cash', state.payments.cashCents], ['Gift Card', state.payments.giftCardCents], ['Surcharges', state.payments.cardSurchargeCents], ['Refunds', state.payments.refundsCents]] };
  if (type === 'tips') return { headers: ['Technician', 'Tips (Cents)'], rows: state.tips.byTechnician.map((t) => [t.name, t.tipsCents]) };
  
  return { headers: ['Id', 'Date', 'Customer', 'Technician', 'Service', 'Method', 'Gross', 'Tip', 'Tax', 'Net', 'Status'], rows: state.transactions.map((r) => [r.id, r.at, r.customer, r.technician, r.service, r.paymentMethod, r.grossCents, r.tipCents, r.taxCents, r.netCents, r.status]) };
}

function seedFor(tenantId: string): Tx[] {
  if (tenantId !== 'luxe001') return []; // isolation: only the seeded tenant has data
  const DEMO_TAX_RATE_PERCENT = 7.75;   // the in-memory demo data's rate (New Jersey) — through the ONE tax helper
  const T = (id: string, dyAgo: number, cust: string, ctype: Tx['customerType'], tech: [string, string], svc: [string, string], pm: string, src: string, gross: number, disc: number, sur: number, tip: number, status: Tx['status'] = 'completed'): Tx => ({
    id, at: daysAgo(dyAgo), customerId: 'c_' + cust.toLowerCase().replace(/\s/g, ''), customer: cust, customerType: ctype,
    technicianId: tech[0], technician: tech[1], service: svc[1], category: svc[0], paymentMethod: pm, bookingSource: src,
    grossCents: gross, discountCents: disc, surchargeCents: sur, taxCents: taxOf(gross - disc, DEMO_TAX_RATE_PERCENT), tipCents: tip, status,
  });
  const mia: [string, string] = ['t_mia', 'Mia'], ava: [string, string] = ['t_ava', 'Ava'], leo: [string, string] = ['t_leo', 'Leo'];
  const gel: [string, string] = ['Manicure', 'Gel Manicure'], ped: [string, string] = ['Pedicure', 'Deluxe Pedicure'], full: [string, string] = ['Full Set', 'Acrylic Full Set'];
  return [
    T('tx1', 0, 'Grace Kim', 'returning', mia, gel, 'card', 'walk_in', 4500, 0, 135, 800),
    T('tx2', 0, 'Nora Patel', 'new', ava, ped, 'card', 'google', 6500, 500, 195, 1000),
    T('tx3', 1, 'Liv Chen', 'vip', leo, full, 'cash', 'customer_app', 8500, 0, 0, 1500),
    T('tx4', 1, 'Mara Diaz', 'returning', mia, gel, 'card', 'ai_phone', 4500, 0, 135, 700),
    T('tx5', 2, 'Ivy Park', 'returning', ava, ped, 'giftCard', 'website', 6500, 1000, 0, 900),
    T('tx6', 2, 'Zoe Ray', 'new', leo, gel, 'card', 'walk_in', 4500, 0, 135, 600),
    T('tx7', 3, 'Ada Lo', 'vip', mia, full, 'card', 'google', 8500, 500, 255, 1800),
    T('tx8', 4, 'Remy Sol', 'returning', ava, ped, 'cash', 'walk_in', 6500, 0, 0, 1100),
    T('tx9', 5, 'Tess Vu', 'returning', leo, gel, 'card', 'customer_app', 4500, 0, 135, 0),
    T('tx10', 6, 'Uma Roy', 'new', mia, full, 'card', 'ai_phone', 8500, 0, 255, 1600, 'refunded'),
  ];
}

export class InMemoryReportsRepository implements ReportsRepositoryPort {
  async query(ctx: ReportsContext, filters: ReportFilters) { return buildReportsState(seedFor(ctx.tenantId), filters, 'br_cherryhill'); }
  async exportRows(ctx: ReportsContext, type: string, filters: ReportFilters) { return buildExportRows(seedFor(ctx.tenantId), type, filters, 'br_cherryhill'); }
}
