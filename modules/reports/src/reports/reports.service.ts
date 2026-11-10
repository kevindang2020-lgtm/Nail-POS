// reports.service.ts — tenant POS Reports. Resolves everything from the authenticated session context;
// enforces role/permission; applies filters via the repository (server-side); writes audit logs; never fakes data.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every read awaits the repo.
import {
  POSReportsFullState, ReportFilters, ExportFormat, toCsv,
  TransactionPage,
} from './reports.dto';
import { ReportsContext, ReportsRepositoryPort } from './reports.repository';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { rankCategories, totalsOf, matchLine, newestFirst, techKeyOf, NO_LINES, UNMAPPED, type ServiceLineFact } from './service-revenue';
import type { ServiceRevenueReport, ReportTicketPage, ReportCustomerPage } from '@aipowersalon/api-contracts/tenant';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }


export interface POSReportsAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string;
  entityType: 'pos_reports' | 'pos_report_detail' | 'pos_report_export' | 'pos_project_status';
  entityId?: string; metadata?: Record<string, unknown>; ipAddress?: string; userAgent?: string; createdAt: string;
}

type StateWithRestrictions = POSReportsFullState & { restrictedSections: string[] };

export class ReportsService {
  private audit: POSReportsAuditLog[] = [];
  constructor(private readonly repo: ReportsRepositoryPort) {}

  // ---- guards ----
  private assertTenantUser(ctx: ReportsContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Reports are not available for this role');
  }
  private assertView(ctx: ReportsContext) {
    this.assertTenantUser(ctx);
    if (!hasPermission(ctx as any, 'pos.reports.view')) throw new ForbiddenError('Missing pos.reports.view');
  }
  private canFinancial(ctx: ReportsContext): boolean {
    // BUILD_PLAN Phase 9: was FINANCIAL_ROLES (OWNER / MANAGER) OR an exact key match no session carried — the key now
    // resolves like the guard's (pos.reports.financial_view → reports.export: owners, managers, an accountant template).
    return hasPermission(ctx as any, 'pos.reports.financial_view');
  }
  private requireFinancial(ctx: ReportsContext) { this.assertView(ctx); if (!this.canFinancial(ctx)) throw new ForbiddenError('Missing pos.reports.financial_view'); }
  private log(ctx: ReportsContext, actionType: string, entityType: POSReportsAuditLog['entityType'], entityId?: string, metadata?: Record<string, unknown>) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSReportsAuditLog[] { return this.audit.slice(); }

  // ---- state ----
  async getState(ctx: ReportsContext, filters: ReportFilters = {}): Promise<StateWithRestrictions> {
    this.assertView(ctx);
    const { state } = await this.repo.query(ctx, filters);
    this.log(ctx, 'pos_reports_viewed', 'pos_reports', undefined, { filters });
    if (Object.keys(filters).length) this.log(ctx, 'pos_reports_filter_changed', 'pos_reports', undefined, { filters });

    const restrictedSections: string[] = [];
    if (!this.canFinancial(ctx)) {
      // strip financial figures for non-financial roles; keep operational sections (queue, bookings, counts)
      const zeroKpis = { ...state.salesKpis, grossSalesCents: 0, netSalesCents: 0, serviceSalesCents: 0, productSalesCents: 0, tipsCents: 0, taxCollectedCents: 0, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, averageTicketCents: 0 };
      state.salesKpis = zeroKpis;
      state.salesTrend = { points: [] };
      state.payments = { cardCents: 0, cashCents: 0, giftCardCents: 0, splitCount: 0, refundsCents: 0, cardSurchargeCents: 0, processorStatus: 'restricted' };
      state.tips = { totalCents: 0, cardTipsCents: 0, cashTipsCents: 0, tipPercentAvg: 0, noTipCount: 0, managerApprovalCount: 0, byTechnician: [] };
      state.tax = { taxableSalesCents: 0, exemptSalesCents: 0, taxCollectedCents: 0, taxRatePercent: 0, byCategory: [], adjustmentsCents: 0 };
      state.discountSurcharge = { discountCents: 0, discountCount: 0, topReason: '', cardSurchargeCents: 0, surchargePercent: 0, cashDiscountCents: 0 };
      state.transactions = state.transactions.map((t) => ({ ...t, grossCents: 0, tipCents: 0, taxCents: 0, netCents: 0 }));
      restrictedSections.push('salesKpis', 'salesTrend', 'payments', 'tips', 'tax', 'discountSurcharge', 'transactions');
    }
    return { ...state, restrictedSections };
  }

  // ---- per-section getters (financial ones require financial permission) ----
  async getKpis(ctx: ReportsContext, f: ReportFilters = {}) { return (await this.getState(ctx, f)).salesKpis; }
  async getSales(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); const { state } = await this.repo.query(ctx, f); return { kpis: state.salesKpis, trend: state.salesTrend }; }
  async getRevenueTrend(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.salesTrend; }
  async getRevenueOverview(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.revenueOverview; }
  async getServices(ctx: ReportsContext, f: ReportFilters = {}) { this.assertView(ctx); return (await this.repo.query(ctx, f)).state.revenueByService; }
  async getTechnicians(ctx: ReportsContext, f: ReportFilters = {}) {
    this.assertView(ctx);
    if (!this.canFinancial(ctx) && !ctx.permissions?.includes('pos.reports.technician_view')) throw new ForbiddenError('Missing pos.reports.technician_view');
    return (await this.repo.query(ctx, f)).state.topTechnicians;
  }
  async getCustomers(ctx: ReportsContext, f: ReportFilters = {}) {
    this.assertView(ctx);
    if (!this.canFinancial(ctx) && !ctx.permissions?.includes('pos.reports.customer_view')) throw new ForbiddenError('Missing pos.reports.customer_view');
    return (await this.repo.query(ctx, f)).state.customerInsights;
  }
  async getPayments(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.payments; }
  async getTips(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.tips; }
  async getTax(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.tax; }
  async getDiscounts(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.discountSurcharge; }
  async getSurcharge(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); const d = (await this.repo.query(ctx, f)).state.discountSurcharge; return { cardSurchargeCents: d.cardSurchargeCents, surchargePercent: d.surchargePercent, cashDiscountCents: d.cashDiscountCents }; }
  async getBooking(ctx: ReportsContext, f: ReportFilters = {}) { this.assertView(ctx); return (await this.repo.query(ctx, f)).state.bookingsOverview; }
  async getQueue(ctx: ReportsContext, f: ReportFilters = {}) { this.assertView(ctx); return (await this.repo.query(ctx, f)).state.queue; }
  async getAppointmentsTrend(ctx: ReportsContext, f: ReportFilters = {}) { this.assertView(ctx); return (await this.repo.query(ctx, f)).state.appointmentsTrend; }
  async getTransactions(ctx: ReportsContext, f: ReportFilters = {}) { this.requireFinancial(ctx); return (await this.repo.query(ctx, f)).state.transactions; }

  /** Daily Summary guide §8–§9 (Nov 10 2026): one page of the period's payment rows, NEWEST FIRST (recorded time, then id),
   *  with a search over customer, service, technician, method, status and ticket / payment reference. The server answers the
   *  page; the screen never receives the whole period to hide most of it. Same scope and permission as the transactions read. */
  async getTransactionsPage(ctx: ReportsContext, f: ReportFilters = {}, q?: string, pageIn?: number, sizeIn?: number): Promise<TransactionPage> {
    this.requireFinancial(ctx);
    const { state } = await this.repo.query(ctx, f);
    const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const needle = fold(q).trim().slice(0, 80);
    const digits = needle.replace(/\D/g, '');
    const all = state.transactions.filter((t) => !needle || [t.customer, t.service, t.technician, t.paymentMethod, t.status, t.id, t.ticketId].some((v) => fold(v).includes(needle))
      || (digits.length >= 4 && [t.id, t.ticketId].some((v) => String(v ?? '').replace(/\D/g, '').includes(digits))));
    all.sort((a, b) => (String(b.occurredAt ?? b.at) < String(a.occurredAt ?? a.at) ? -1 : String(b.occurredAt ?? b.at) > String(a.occurredAt ?? a.at) ? 1 : b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
    const pageSize = [10, 25, 50, 100].includes(Number(sizeIn)) ? Number(sizeIn) : 25;
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(pageIn) || 1)), pages);
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize, q: needle || null, from: state.dateRange.from, to: state.dateRange.to };
  }

  /** batch 9 guide 2 (Nov 10 2026): Revenue by Service — the shared line-level calculation (service-revenue.ts) for the
   *  Daily Summary card and the Services Report. Search + category filter the lines; totals cover every match; the line
   *  history is one server page, newest first. Customer names and phone matching only with the financial permission. */
  async getServiceRevenue(ctx: ReportsContext, f: ReportFilters = {}, opts: { q?: string; category?: string; technician?: string; page?: number; pageSize?: number } = {}): Promise<ServiceRevenueReport> {
    this.assertView(ctx);
    const out = await this.repo.query(ctx, f);
    const facts = out.serviceLines ?? { lines: [] as ServiceLineFact[], discountByTicket: {}, refundByTicket: {} };
    const canCust = this.canFinancial(ctx);
    const q = String(opts.q ?? '').trim().slice(0, 80);
    const category = String(opts.category ?? '').trim().slice(0, 120) || null;
    const searched = facts.lines.filter((l) => matchLine(l, q, canCust));
    const keyOf = (l: ServiceLineFact) => (l.noLines ? NO_LINES : l.unmapped ? UNMAPPED : l.category);
    // batch 9 guide 6: one technician's lines (the Technicians Report drill-down) — the same keys as the leaderboard
    const technician = String(opts.technician ?? '').trim().slice(0, 64) || null;
    const byTech = technician ? searched.filter((l) => techKeyOf(l) === technician) : searched;
    const filtered = category ? byTech.filter((l) => keyOf(l) === category) : byTech;
    const sorted = [...filtered].sort(newestFirst);
    const pageSize = [25, 50, 100].includes(Number(opts.pageSize)) ? Number(opts.pageSize) : 25;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(opts.page) || 1)), pages);
    const items = sorted.slice((page - 1) * pageSize, page * pageSize).map(({ phoneDigits: _p, customerId: _c, ...l }) => ({ ...l, customer: canCust ? l.customer : '' }));
    return {
      period: { from: out.state.dateRange.from, to: out.state.dateRange.to, timezone: out.state.dateRange.timezone ?? null },
      basis: 'paid_ticket_service_lines', asOf: new Date().toISOString(), filters: { q: q || null, category, technician },
      totals: totalsOf(filtered, facts.discountByTicket, facts.refundByTicket), categories: rankCategories(byTech),
      history: { items, total: sorted.length, page, pageSize }, customersVisible: canCust,
    };
  }

  private async serviceLineRows(ctx: ReportsContext, f: ReportFilters, extra: { q?: string; category?: string }) {
    const first = await this.getServiceRevenue(ctx, f, { ...extra, pageSize: 100 });
    const all = [...first.history.items];
    for (let p = 2; p <= Math.ceil(first.history.total / 100); p++) all.push(...(await this.getServiceRevenue(ctx, f, { ...extra, page: p, pageSize: 100 })).history.items);
    const cat = (l: { category: string; unmapped: boolean; noLines?: boolean }) => (l.noLines ? 'No service lines recorded' : l.unmapped ? 'Unmapped / historical' : l.category);
    return {
      headers: ['Paid at (UTC)', 'Ticket', 'Service', 'Category', 'Technician', ...(first.customersVisible ? ['Customer'] : []), 'Units', 'Sales before discounts (cents)'],
      rows: all.map((l) => [l.occurredAt, l.ticketNumber ?? l.ticketId, l.serviceName, cat(l), l.technician, ...(first.customersVisible ? [l.customer] : []), l.units, l.grossCents]),
    };
  }

  /** batch 9 guide 4 (Nov 10 2026): the Sales Report Ticket Explorer — one row per paid ticket of the period, newest first
   *  (first payment time, then ticket id), searched over customer / formatted phone / technician / service / ticket # /
   *  method. Financial permission (customer + money per ticket). The phone is matched, never returned. */
  async getTicketsPage(ctx: ReportsContext, f: ReportFilters = {}, q?: string, pageIn?: number, sizeIn?: number): Promise<ReportTicketPage> {
    this.requireFinancial(ctx);
    const out = await this.repo.query(ctx, f);
    const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const needle = fold(q).trim().slice(0, 80);
    const digits = needle.replace(/\D/g, '');
    const all = (out.tickets ?? []).filter((t) => !needle
      || [t.customer, t.ticketNumber, t.ticketId, ...t.services, ...t.technicians, ...t.methods].some((v) => fold(v).includes(needle))
      || (digits.length >= 4 && (String(t.ticketNumber ?? '').replace(/\D/g, '') === digits || (!!t.phoneDigits && t.phoneDigits.endsWith(digits.length > 10 ? digits.slice(-10) : digits)))));
    all.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.ticketId < b.ticketId ? 1 : a.ticketId > b.ticketId ? -1 : 0));
    const pageSize = [10, 25, 50, 100].includes(Number(sizeIn)) ? Number(sizeIn) : 25;
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(pageIn) || 1)), pages);
    const items = all.slice((page - 1) * pageSize, page * pageSize).map(({ phoneDigits: _p, customerId: _c, ...t }) => t);
    return { items, total: all.length, page, pageSize, q: needle || null, from: out.state.dateRange.from, to: out.state.dateRange.to, timezone: out.state.dateRange.timezone ?? null };
  }

  /** batch 9 guide 7 (Nov 10 2026): the Customers Report list — the period's KNOWN customers with a paid visit (the same
   *  population as the cards), new or returning by the same rule, most recent visit first; search over name / ticket # /
   *  formatted phone (matched, only the last 4 digits returned); net sales only with the financial permission. */
  async getCustomersPage(ctx: ReportsContext, f: ReportFilters = {}, opts: { q?: string; type?: string; page?: number; pageSize?: number } = {}): Promise<ReportCustomerPage> {
    this.assertView(ctx);
    if (!this.canFinancial(ctx) && !ctx.permissions?.includes('pos.reports.customer_view')) throw new ForbiddenError('Missing pos.reports.customer_view');
    const out = await this.repo.query(ctx, f);
    const ret = new Set(out.returningIds ?? []);
    const money = this.canFinancial(ctx);
    const by = new Map<string, { customerId: string; customer: string; phone: string; visits: number; lastVisitAt: string; net: number; tickets: string[] }>();
    for (const t of out.tickets ?? []) {
      if (!t.customerId) continue;
      const c = by.get(t.customerId) ?? { customerId: t.customerId, customer: t.customer, phone: t.phoneDigits ?? '', visits: 0, lastVisitAt: t.occurredAt, net: 0, tickets: [] };
      c.visits += 1; c.net += t.netCents; if (t.occurredAt > c.lastVisitAt) c.lastVisitAt = t.occurredAt; if (t.ticketNumber) c.tickets.push(t.ticketNumber);
      by.set(t.customerId, c);
    }
    const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const needle = fold(opts.q).trim().slice(0, 80); const digits = needle.replace(/\D/g, '');
    const type = opts.type === 'new' || opts.type === 'returning' ? opts.type : 'all';
    const all = [...by.values()]
      .map((c) => ({ ...c, type: (ret.has(c.customerId) ? 'returning' : 'new') as 'new' | 'returning' }))
      .filter((c) => type === 'all' || c.type === type)
      .filter((c) => !needle || fold(c.customer).includes(needle) || c.tickets.some((n) => fold(n) === needle)
        || (digits.length >= 4 && !!c.phone && c.phone.endsWith(digits.length > 10 ? digits.slice(-10) : digits)))
      .sort((a, b) => (a.lastVisitAt < b.lastVisitAt ? 1 : a.lastVisitAt > b.lastVisitAt ? -1 : a.customerId < b.customerId ? 1 : -1));
    const pageSize = [10, 25, 50, 100].includes(Number(opts.pageSize)) ? Number(opts.pageSize) : 25;
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(Number(opts.page) || 1)), pages);
    const items = all.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
      customerId: c.customerId, customer: c.customer, phoneLast4: c.phone.length >= 4 ? c.phone.slice(-4) : null, type: c.type, visits: c.visits, lastVisitAt: c.lastVisitAt, netSalesCents: money ? c.net : null }));
    return { items, total: all.length, page, pageSize, q: needle || null, type, from: out.state.dateRange.from, to: out.state.dateRange.to, timezone: out.state.dateRange.timezone ?? null, moneyVisible: money };
  }

  // ---- detail (drawer) ----
  async detail(ctx: ReportsContext, kind: string, id: string) {
    this.assertView(ctx);
    this.log(ctx, 'pos_reports_detail_opened', 'pos_report_detail', id, { kind });
    if (kind === 'transaction') {
      const row = (await this.repo.query(ctx, {})).state.transactions.find((t) => t.id === id);
      if (!row) return { configured: true, found: false, message: 'No matching transaction.' };
      if (!this.canFinancial(ctx)) return { configured: true, found: true, restricted: true };
      return { configured: true, found: true, row };
    }
    return { configured: false, message: 'This report detail view is not configured yet.' };
  }

  // ---- export ----
  async export(ctx: ReportsContext, type: string, format: ExportFormat, filters: ReportFilters = {}, extra: { q?: string; category?: string } = {}): Promise<{ format: ExportFormat; filename: string; csv?: string; disabledReason?: string }> {
    this.assertView(ctx);
    if (!hasPermission(ctx as any, 'pos.reports.export')) throw new ForbiddenError('Missing pos.reports.export');
    if (['sales', 'payments', 'tips', 'tax', 'transactions'].includes(type)) this.requireFinancial(ctx);
    if (format === 'pdf' || format === 'excel') {
      this.log(ctx, 'pos_reports_exported', 'pos_report_export', type, { format, status: 'not_configured' });
      return { format, filename: '', disabledReason: 'Export is not configured yet.' };
    }
    // batch 9 guide 2 §15: Revenue by Service lines — the WHOLE filtered set (search + category), never just one page;
    // customer column only with the financial permission
    const { headers, rows } = type === 'service_lines' ? await this.serviceLineRows(ctx, filters, extra) : await this.repo.exportRows(ctx, type, filters);
    const csv = toCsv(headers, rows);
    this.log(ctx, 'pos_reports_exported', 'pos_report_export', type, { format, rows: rows.length, filters });
    return { format: 'csv', filename: `pos-${type}-${filters.from || 'start'}-${filters.to || 'end'}.csv`, csv };
  }
}
