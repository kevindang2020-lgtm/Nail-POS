// ai-business-branches.service.ts — compare_branches (spec §14, §30).
// Fans out over the caller's AUTHORIZED branches (resolved via BranchScopeResolver → owner_branch_access) and reads
// each branch's numbers from the existing ReportsService by constructing a ReportsContext with that branchId. It NEVER
// queries a branch outside the authorized set. Financial columns degrade to null when the caller lacks financial
// permission (§9). Totals are reported alongside normalized figures, explicitly labeled, so a smaller branch is not
// made to look worse merely for being smaller (§30).
import { type ReportsContext, type ReportFilters, type DatePreset, type SalesKpis, type SalesTrend, type BookingsOverview, ForbiddenError } from '@aipowersalon/reports';
import { getMetric } from './ai-business-metrics';
import { withCode } from '@aipowersalon/api-contracts';
import { addDays } from '@aipowersalon/date-time';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import type { BranchScopeResolver } from './ai-business-branch-scope';
import type { BranchFreshnessSource, BranchFreshness } from './ai-business-branch-freshness';

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
  cancelledPercent: number | null;   // null = nothing booked
  noShowPercent: number | null;
  // normalized (null when the denominator or financials are unavailable)
  revenuePerCompletedAppointmentCents: number | null;
  /** completed / totalBookings as a percent — null (N/A) when the branch had no bookings, never a fake 0 % */
  completionRate: number | null;
  status: string;
  /** AI BRANCH COMPARISON 11 (round 10) — this branch's own freshness (absent when no source is wired) */
  freshness?: BranchFreshness;
}
/** AI BRANCH COMPARISON 08 (Nov 12 2026): the same figures for the PREVIOUS equal period, per branch, read by the same Sales /
 *  Booking reports with the same definitions. A preset uses the Sales Report's own previous-period rule in each branch's
 *  time zone (ReportFilters.period 'previous': today → yesterday, month 1st..today → last month 1st..the same day, …); a
 *  custom From–To uses the same number of days immediately before it. Never mixed into the current figures. */
export interface BranchPriorFigures { netSalesCents: number | null; ticketsCount: number | null; totalBookings: number; completed: number; completionRate: number | null }
export interface BranchPeriodComparison { basis: 'previous_equal_period'; preset: string; range: { from: string; to: string } | null; priorRange: { from: string; to: string } | null;
  totals: BranchPriorFigures; byBranch: Record<string, BranchPriorFigures> }
export function priorCustomRange(r: { from: string; to: string }): { from: string; to: string } {
  const len = Math.round((Date.parse(r.to + 'T12:00:00Z') - Date.parse(r.from + 'T12:00:00Z')) / 86_400_000) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}
export interface BranchCompareQuery { preset?: string; from?: string; to?: string; q?: string; includeInactive?: boolean; page?: number; pageSize?: number; compare?: 'prior'; /** internal callers (assistant, saved reports): every branch on one page */ all?: boolean }

export interface BranchComparison {
  preset: DatePreset | 'custom';
  range: { from: string; to: string } | null;
  asOf: string;
  /** whole-salon totals over every branch that matched (not just this page); ratios are computed from the totals */
  totals: { netSalesCents: number | null; ticketsCount: number | null; averageTicketCents: number | null; totalBookings: number; completed: number; completionRate: number | null; branches: number };
  page: number; pageSize: number; totalItems: number; totalPages: number;
  inactiveHidden: number;
  partialCurrentPeriod: boolean;
  financialsIncluded: boolean;         // false when the caller lacks pos.reports.financial_view
  branches: BranchComparisonRow[];
  branchCount: number;
  truncated: boolean;                  // true when authorized branches exceeded the fan-out cap
  drilldownRoute: string;
  notes: string[];
  /** only when compare = 'prior' was asked for */
  comparison?: BranchPeriodComparison;
  /** AI BRANCH COMPARISON 01: how far the numbers can be trusted for comparing, shown BEFORE any ranking */
  readiness: BranchComparisonReadiness;
}
/** AI BRANCH COMPARISON 01 (Nov 12 2026) — Comparison Readiness. Over every matched branch (not just this page): how many had
 *  any activity (a booking or a ticket) in the period, how many are a small sample (1–4 bookings), whether revenue could be
 *  read for this viewer and whether the period is still running. `coveragePercent` = branches with activity ÷ matched
 *  branches. Level: not_ready (fewer than two branches with activity — nothing to compare), limited (a branch without
 *  activity, a small sample, revenue hidden or a partial day), ready otherwise. Freshness: the figures are read live from
 *  the Sales / Booking reports at `asOf` (no cached snapshot). */
export interface BranchComparisonReadiness {
  level: 'ready' | 'limited' | 'not_ready'; coveragePercent: number | null; branches: number; withActivity: number; noActivity: number; smallSample: number;
  financialCoverage: boolean; partialPeriod: boolean; source: 'live_reports'; asOf: string;
  reasons: Array<'single_branch' | 'too_few_with_activity' | 'branch_without_activity' | 'small_sample' | 'revenue_hidden' | 'partial_period'>;
}
export const SMALL_SAMPLE_BOOKINGS = 5;
export function comparisonReadiness(rows: Array<Pick<BranchComparisonRow, 'totalBookings' | 'ticketsCount'>>, o: { financialsIncluded: boolean; partialPeriod: boolean; asOf: string }): BranchComparisonReadiness {
  const active = rows.filter((r) => r.totalBookings > 0 || (r.ticketsCount ?? 0) > 0).length;
  const smallSample = rows.filter((r) => r.totalBookings > 0 && r.totalBookings < SMALL_SAMPLE_BOOKINGS).length;
  const reasons: BranchComparisonReadiness['reasons'] = [];
  if (rows.length < 2) reasons.push('single_branch'); else if (active < 2) reasons.push('too_few_with_activity');
  if (rows.length - active > 0) reasons.push('branch_without_activity');
  if (smallSample) reasons.push('small_sample');
  if (!o.financialsIncluded) reasons.push('revenue_hidden');
  if (o.partialPeriod) reasons.push('partial_period');
  const level = rows.length < 2 || active < 2 ? 'not_ready' : reasons.length ? 'limited' : 'ready';
  return { level, coveragePercent: rows.length ? Math.round((active / rows.length) * 100) : null, branches: rows.length, withActivity: active, noActivity: rows.length - active, smallSample,
    financialCoverage: o.financialsIncluded, partialPeriod: o.partialPeriod, source: 'live_reports', asOf: o.asOf, reasons };
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'];
const PAGE_SIZES = [10, 25, 50];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CUSTOM_DAYS = 366;

export class AiBusinessBranchesService {
  constructor(private readonly reports: BranchCompareSource, private readonly scope: BranchScopeResolver, private readonly freshnessSource: BranchFreshnessSource | null = null) {}

  /**
   * AI Branch Comparison guide (Nov 3 2026): every authorized branch (no 20-branch cap), searched by name and paged; inactive branches
   * hidden unless asked for; a preset or a custom From/To; N/A where a ratio has no denominator (it showed 0 % / $0.00); the average
   * ticket is net ÷ tickets like Net Sales (it was gross ÷ tickets); whole-salon totals over every matching branch.
   */
  async compareBranches(ctx: AiBusinessContext, input?: string | BranchCompareQuery): Promise<BranchComparison> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    const q: BranchCompareQuery = typeof input === 'string' || input == null ? { preset: input ?? undefined } : input;
    let filters: ReportFilters; let preset: DatePreset | 'custom'; let range: { from: string; to: string } | null = null;
    if (q.from || q.to) {
      if (!YMD.test(String(q.from)) || !YMD.test(String(q.to)) || String(q.from) > String(q.to)) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Choose a valid From and To date.'), 'DATE_RANGE_INVALID');
      const days = Math.round((Date.parse(String(q.to)) - Date.parse(String(q.from))) / 86_400_000) + 1;
      if (days > MAX_CUSTOM_DAYS) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, `Choose at most ${MAX_CUSTOM_DAYS} days.`), 'DATE_RANGE_MAX_DAYS', { max: MAX_CUSTOM_DAYS });
      range = { from: String(q.from), to: String(q.to) }; preset = 'custom'; filters = { preset: 'custom' as DatePreset, from: range.from, to: range.to };
    } else {
      if (q.preset != null && !VALID_PRESETS.includes(q.preset as DatePreset)) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
      preset = (q.preset as DatePreset) ?? 'month'; filters = { preset };
    }
    const pageSize = q.all ? 100_000 : PAGE_SIZES.includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
    const term = String(q.q ?? '').trim().toLowerCase().slice(0, 80);

    const authorized = await this.scope.listAuthorizedBranches(ctx);
    const visible = authorized.filter((b) => q.includeInactive || !b.status || b.status === 'active');
    const matched = visible.filter((b) => !term || b.branchName.toLowerCase().includes(term)).sort((a, b) => a.branchName.localeCompare(b.branchName));
    const totalPages = Math.max(1, Math.ceil(matched.length / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(q.page)) || 1));

    let financialsIncluded = true;
    const all: BranchComparisonRow[] = [];
    for (const b of matched) {
      // a ReportsContext scoped to THIS authorized branch; tenantId stays the caller's — never widened
      const bctx: ReportsContext = { tenantId: ctx.tenantId, branchId: b.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      let booking: BookingsOverview;
      try { booking = await this.reports.getBooking(bctx, filters); }
      catch (e) { if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message); throw e; }
      let net: number | null = null, avg: number | null = null, tickets: number | null = null, revPerCompleted: number | null = null;
      if (financialsIncluded) {
        try {
          const { kpis } = await this.reports.getSales(bctx, filters);
          net = kpis.netSalesCents; tickets = kpis.ticketsCount;
          avg = kpis.ticketsCount > 0 ? Math.round(kpis.netSalesCents / kpis.ticketsCount) : null;
          revPerCompleted = booking.completed > 0 ? Math.round(kpis.netSalesCents / booking.completed) : null;
        } catch (e) { if (e instanceof ForbiddenError) financialsIncluded = false; else throw e; }
      }
      all.push({ branchId: b.branchId, branchName: b.branchName, status: b.status ?? 'active',
        netSalesCents: net, averageTicketCents: avg, ticketsCount: tickets,
        totalBookings: booking.totalBookings, completed: booking.completed,
        cancelledPercent: booking.cancelledPercent, noShowPercent: booking.noShowPercent,
        revenuePerCompletedAppointmentCents: revPerCompleted,
        completionRate: booking.totalBookings > 0 ? Math.round((booking.completed / booking.totalBookings) * 100) : null });
    }
    let comparison: BranchPeriodComparison | undefined;
    if (q.compare === 'prior') {
      const priorRange = range ? priorCustomRange(range) : null;
      const pf: ReportFilters = priorRange ? { preset: 'custom' as DatePreset, from: priorRange.from, to: priorRange.to } : { preset: preset as DatePreset, period: 'previous' };
      const byBranch: Record<string, BranchPriorFigures> = {};
      for (const b of matched) {
        const bctx: ReportsContext = { tenantId: ctx.tenantId, branchId: b.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
        let booking: BookingsOverview;
        try { booking = await this.reports.getBooking(bctx, pf); }
        catch (e) { if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message); throw e; }
        let net: number | null = null, tickets: number | null = null;
        if (financialsIncluded) {
          try { const { kpis } = await this.reports.getSales(bctx, pf); net = kpis.netSalesCents; tickets = kpis.ticketsCount; }
          catch (e) { if (e instanceof ForbiddenError) financialsIncluded = false; else throw e; }
        }
        byBranch[b.branchId] = { netSalesCents: net, ticketsCount: tickets, totalBookings: booking.totalBookings, completed: booking.completed,
          completionRate: booking.totalBookings > 0 ? Math.round((booking.completed / booking.totalBookings) * 100) : null };
      }
      const pr = Object.values(byBranch);
      if (!financialsIncluded) for (const x of pr) { x.netSalesCents = null; x.ticketsCount = null; }
      const pBk = pr.reduce((a, x) => a + x.totalBookings, 0), pDone = pr.reduce((a, x) => a + x.completed, 0);
      comparison = { basis: 'previous_equal_period', preset, range, priorRange, byBranch,
        totals: { netSalesCents: financialsIncluded ? pr.reduce((a, x) => a + (x.netSalesCents ?? 0), 0) : null, ticketsCount: financialsIncluded ? pr.reduce((a, x) => a + (x.ticketsCount ?? 0), 0) : null,
          totalBookings: pBk, completed: pDone, completionRate: pBk > 0 ? Math.round((pDone / pBk) * 100) : null } };
    }
    if (!financialsIncluded) for (const r of all) { r.netSalesCents = null; r.averageTicketCents = null; r.ticketsCount = null; r.revenuePerCompletedAppointmentCents = null; }
    if (this.freshnessSource && all.length) {
      const fr = await this.freshnessSource.freshness(ctx.tenantId, all.map((r) => r.branchId));
      for (const r of all) if (fr[r.branchId]) r.freshness = fr[r.branchId];
    }
    const sum = (f: (r: BranchComparisonRow) => number | null) => all.reduce((a, r) => a + (f(r) ?? 0), 0);
    const tNet = financialsIncluded ? sum((r) => r.netSalesCents) : null, tTk = financialsIncluded ? sum((r) => r.ticketsCount) : null;
    const tBk = sum((r) => r.totalBookings), tDone = sum((r) => r.completed);
    const rows = all.slice((page - 1) * pageSize, page * pageSize);

    const notes: string[] = ['Comparison covers only branches you are authorized to view.'];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (all.length > 1) notes.push('Compare normalized figures (e.g. revenue per completed appointment, completion rate) rather than totals when branches differ in size or hours.');
    if (authorized.length <= 1) notes.push('You have access to a single branch, so there is nothing to compare.');
    if (!financialsIncluded) notes.push('Revenue columns are hidden because you do not have financial-view permission.');
    const inactiveHidden = authorized.length - visible.length;
    if (inactiveHidden) notes.push(`${inactiveHidden} inactive branch${inactiveHidden === 1 ? ' is' : 'es are'} hidden.`);

    const asOf = new Date().toISOString();
    return {
      readiness: comparisonReadiness(all, { financialsIncluded, partialPeriod: preset === 'today', asOf }),
      preset, range, asOf, partialCurrentPeriod: preset === 'today', financialsIncluded,
      totals: { netSalesCents: tNet, ticketsCount: tTk, averageTicketCents: tNet != null && tTk ? Math.round(tNet / tTk) : null, totalBookings: tBk, completed: tDone,
        completionRate: tBk > 0 ? Math.round((tDone / tBk) * 100) : null, branches: all.length },
      branches: rows, branchCount: all.length, truncated: false, page, pageSize, totalItems: all.length, totalPages, inactiveHidden,
      drilldownRoute: getMetric('net_sales')!.drilldownRoute, notes, ...(comparison ? { comparison } : {}),
    };
  }
}
