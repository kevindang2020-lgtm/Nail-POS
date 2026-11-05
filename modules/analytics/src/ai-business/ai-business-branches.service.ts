// ai-business-branches.service.ts — compare_branches (spec §14, §30).
// Fans out over the caller's AUTHORIZED branches (resolved via BranchScopeResolver → owner_branch_access) and reads
// each branch's numbers from the existing ReportsService by constructing a ReportsContext with that branchId. It NEVER
// queries a branch outside the authorized set. Financial columns degrade to null when the caller lacks financial
// permission (§9). Totals are reported alongside normalized figures, explicitly labeled, so a smaller branch is not
// made to look worse merely for being smaller (§30).
import { type ReportsContext, type ReportFilters, type DatePreset, type SalesKpis, type SalesTrend, type BookingsOverview, ForbiddenError } from '@aipowersalon/reports';
import { getMetric } from './ai-business-metrics';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import type { BranchScopeResolver } from './ai-business-branch-scope';

export interface BranchCompareSource {
  getSales(ctx: ReportsContext, f?: ReportFilters): Promise<{ kpis: SalesKpis; trend: SalesTrend }>;
  getBooking(ctx: ReportsContext, f?: ReportFilters): Promise<BookingsOverview>;
}

export interface BranchComparisonRow {
  branchId: string;
  branchName: string;
  // totals (financials null when restricted)
  netSalesCents: number | null;
  averageTicketCents: number | null;
  ticketsCount: number | null;
  totalBookings: number;
  completed: number;
  cancelledPercent: number;
  noShowPercent: number;
  // normalized (null when the denominator or financials are unavailable)
  revenuePerCompletedAppointmentCents: number | null;
  completionRate: number; // completed / totalBookings, as a percent
}

export interface BranchComparison {
  preset: DatePreset;
  partialCurrentPeriod: boolean;
  financialsIncluded: boolean;         // false when the caller lacks pos.reports.financial_view
  branches: BranchComparisonRow[];
  branchCount: number;
  truncated: boolean;                  // true when authorized branches exceeded the fan-out cap
  drilldownRoute: string;
  notes: string[];
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'];
const MAX_BRANCHES = 20; // bound the interactive fan-out; larger chains use a queued report (later slice)

export class AiBusinessBranchesService {
  constructor(private readonly reports: BranchCompareSource, private readonly scope: BranchScopeResolver) {}

  async compareBranches(ctx: AiBusinessContext, presetInput?: string): Promise<BranchComparison> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    if (presetInput != null && !VALID_PRESETS.includes(presetInput as DatePreset)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    const preset = (presetInput as DatePreset) ?? 'month';
    const filters: ReportFilters = { preset };

    const authorized = await this.scope.listAuthorizedBranches(ctx);
    const truncated = authorized.length > MAX_BRANCHES;
    const branchList = authorized.slice(0, MAX_BRANCHES);

    // Determine financial availability ONCE using the caller's own scope, so we don't half-populate rows.
    let financialsIncluded = true;

    const rows: BranchComparisonRow[] = [];
    for (const b of branchList) {
      // Build a ReportsContext scoped to THIS authorized branch. tenantId stays the caller's — never widened.
      const bctx: ReportsContext = { tenantId: ctx.tenantId, branchId: b.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      let booking: BookingsOverview;
      try {
        booking = await this.reports.getBooking(bctx, filters);
      } catch (e) {
        if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
        throw e;
      }

      let net: number | null = null, avg: number | null = null, tickets: number | null = null, revPerCompleted: number | null = null;
      if (financialsIncluded) {
        try {
          const { kpis } = await this.reports.getSales(bctx, filters);
          net = kpis.netSalesCents; avg = kpis.averageTicketCents; tickets = kpis.ticketsCount;
          revPerCompleted = booking.completed > 0 ? Math.round(kpis.netSalesCents / booking.completed) : null;
        } catch (e) {
          if (e instanceof ForbiddenError) { financialsIncluded = false; }
          else throw e;
        }
      }

      rows.push({
        branchId: b.branchId, branchName: b.branchName,
        netSalesCents: net, averageTicketCents: avg, ticketsCount: tickets,
        totalBookings: booking.totalBookings, completed: booking.completed,
        cancelledPercent: booking.cancelledPercent, noShowPercent: booking.noShowPercent,
        revenuePerCompletedAppointmentCents: revPerCompleted,
        completionRate: booking.totalBookings > 0 ? Math.round((booking.completed / booking.totalBookings) * 100) : 0,
      });
    }

    // If financials became unavailable partway (first branch denied), null them everywhere for consistency.
    if (!financialsIncluded) {
      for (const r of rows) { r.netSalesCents = null; r.averageTicketCents = null; r.ticketsCount = null; r.revenuePerCompletedAppointmentCents = null; }
    }

    const notes: string[] = ['Comparison covers only branches you are authorized to view.'];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (rows.length > 1) notes.push('Compare normalized figures (e.g. revenue per completed appointment, completion rate) rather than totals when branches differ in size or hours.');
    if (rows.length <= 1) notes.push('You have access to a single branch, so there is nothing to compare.');
    if (!financialsIncluded) notes.push('Revenue columns are hidden because you do not have financial-view permission.');
    if (truncated) notes.push(`Showing the first ${MAX_BRANCHES} of ${authorized.length} authorized branches; use a generated report for a full chain comparison.`);

    return {
      preset, partialCurrentPeriod: preset === 'today', financialsIncluded,
      branches: rows, branchCount: rows.length, truncated,
      drilldownRoute: getMetric('net_sales')!.drilldownRoute, notes,
    };
  }
}
