// reports.service.ts — tenant POS Reports. Resolves everything from the authenticated session context;
// enforces role/permission; applies filters via the repository (server-side); writes audit logs; never fakes data.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every read awaits the repo.
import {
  POSReportsFullState, ReportFilters, ExportFormat, toCsv,
} from './reports.dto';
import { ReportsContext, ReportsRepositoryPort } from './reports.repository';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';

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
  async export(ctx: ReportsContext, type: string, format: ExportFormat, filters: ReportFilters = {}): Promise<{ format: ExportFormat; filename: string; csv?: string; disabledReason?: string }> {
    this.assertView(ctx);
    if (!hasPermission(ctx as any, 'pos.reports.export')) throw new ForbiddenError('Missing pos.reports.export');
    if (['sales', 'payments', 'tips', 'tax', 'transactions'].includes(type)) this.requireFinancial(ctx);
    if (format === 'pdf' || format === 'excel') {
      this.log(ctx, 'pos_reports_exported', 'pos_report_export', type, { format, status: 'not_configured' });
      return { format, filename: '', disabledReason: 'Export is not configured yet.' };
    }
    const { headers, rows } = await this.repo.exportRows(ctx, type, filters);
    const csv = toCsv(headers, rows);
    this.log(ctx, 'pos_reports_exported', 'pos_report_export', type, { format, rows: rows.length, filters });
    return { format: 'csv', filename: `pos-${type}-${filters.from || 'start'}-${filters.to || 'end'}.csv`, csv };
  }
}
