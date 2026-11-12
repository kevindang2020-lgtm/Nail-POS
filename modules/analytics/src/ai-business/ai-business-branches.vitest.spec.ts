// ai-business-branches.vitest.spec.ts — slice 5: compare_branches + branch-scope authorization (§14, §30, §52).
import { ForbiddenError, type ReportsContext, type ReportFilters, type SalesKpis, type SalesTrend, type BookingsOverview } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessBranchesService, type BranchCompareSource } from './ai-business-branches.service';
import type { BranchScopeResolver, AuthorizedBranch } from './ai-business-branch-scope';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const kpis = (o: Partial<SalesKpis>): SalesKpis => ({ grossSalesCents: 0, netSalesCents: 0, serviceSalesCents: 0, productSalesCents: 0, tipsCents: 0, taxCollectedCents: 0, cardSurchargeCents: 0, discountsCents: 0, refundsCents: 0, ticketsCount: 0, customersCount: 0, averageTicketCents: 0, ...o });
const booking = (o: Partial<BookingsOverview>): BookingsOverview => ({ totalBookings: 0, completed: 0, completedPercent: 0, cancelled: 0, cancelledPercent: 0, noShow: 0, noShowPercent: 0, ...o });
const trend: SalesTrend = { points: [] };

// Records every branchId it was asked about so we can prove unauthorized branches are never queried.
class FakeBranchSource implements BranchCompareSource {
  queriedBranches: string[] = [];
  constructor(private data: Record<string, { kpis: SalesKpis; booking: BookingsOverview }>, private denyFinancial = false) {}
  async getSales(ctx: ReportsContext, _f?: ReportFilters) {
    if (this.denyFinancial) throw new ForbiddenError('Missing pos.reports.financial_view');
    return { kpis: this.data[ctx.branchId]?.kpis ?? kpis({}), trend };
  }
  async getBooking(ctx: ReportsContext, _f?: ReportFilters) {
    this.queriedBranches.push(ctx.branchId);
    return this.data[ctx.branchId]?.booking ?? booking({});
  }
}
class FakeScope implements BranchScopeResolver {
  constructor(private branches: AuthorizedBranch[]) {}
  async listAuthorizedBranches(_ctx: AiBusinessContext) { return this.branches; }
}
const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view', 'pos.reports.financial_view'], ...o });

describe('compareBranches — authorization boundary', () => {
  const src = new FakeBranchSource({
    b1: { kpis: kpis({ netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100 }), booking: booking({ totalBookings: 120, completed: 100, cancelledPercent: 8, noShowPercent: 5 }) },
    b2: { kpis: kpis({ netSalesCents: 200000, averageTicketCents: 4000, ticketsCount: 50 }), booking: booking({ totalBookings: 60, completed: 50, cancelledPercent: 10, noShowPercent: 6 }) },
    bX: { kpis: kpis({ netSalesCents: 999999, averageTicketCents: 9999, ticketsCount: 999 }), booking: booking({ totalBookings: 999, completed: 999 }) }, // NOT authorized
  });
  const scope = new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }, { branchId: 'b2', branchName: 'Deptford', status: 'active' }]);
  const svc = new AiBusinessBranchesService(src, scope);

  it('only ever queries authorized branches (unauthorized bX is never touched)', async () => {
    await svc.compareBranches(CTX(), 'month');
    expect(src.queriedBranches.sort()).toEqual(['b1', 'b2']);
    expect(src.queriedBranches).not.toContain('bX');
  });

  it('scopes each ReportsContext to the caller tenant, never widening', async () => {
    const spySrc = new FakeBranchSource({ b1: { kpis: kpis({}), booking: booking({}) } });
    let seenTenant = '';
    const orig = spySrc.getBooking.bind(spySrc);
    spySrc.getBooking = async (ctx: ReportsContext, f?: ReportFilters) => { seenTenant = ctx.tenantId; return orig(ctx, f); };
    await new AiBusinessBranchesService(spySrc, new FakeScope([{ branchId: 'b1', branchName: 'X', status: 'active' }])).compareBranches(CTX({ tenantId: 'tOnly' }), 'week');
    expect(seenTenant).toBe('tOnly');
  });
});

describe('compareBranches — totals + normalized', () => {
  const src = new FakeBranchSource({
    b1: { kpis: kpis({ netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100 }), booking: booking({ totalBookings: 120, completed: 100 }) },
    b2: { kpis: kpis({ netSalesCents: 200000, averageTicketCents: 4000, ticketsCount: 50 }), booking: booking({ totalBookings: 60, completed: 50 }) },
  });
  const svc = new AiBusinessBranchesService(src, new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }, { branchId: 'b2', branchName: 'Deptford', status: 'active' }]));

  it('reports totals and normalized revenue-per-completed-appointment', async () => {
    const r = await svc.compareBranches(CTX(), 'month');
    expect(r.financialsIncluded).toBe(true);
    const b1 = r.branches.find((b) => b.branchId === 'b1')!;
    expect(b1.netSalesCents).toBe(500000);
    expect(b1.revenuePerCompletedAppointmentCents).toBe(5000); // 500000 / 100
    expect(b1.completionRate).toBe(83); // 100/120
    expect(r.notes.some((n) => /normalized/i.test(n))).toBe(true);
  });
});

describe('compareBranches — honest financial degradation', () => {
  const src = new FakeBranchSource({ b1: { kpis: kpis({ netSalesCents: 1 }), booking: booking({ totalBookings: 10, completed: 9 }) } }, /* denyFinancial */ true);
  const svc = new AiBusinessBranchesService(src, new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }]));

  it('nulls revenue columns and keeps operational columns when financial permission is absent', async () => {
    const r = await svc.compareBranches(CTX({ permissions: ['ai.use', 'pos.reports.view'] }), 'month');
    expect(r.financialsIncluded).toBe(false);
    expect(r.branches[0].netSalesCents).toBeNull();
    expect(r.branches[0].completed).toBe(9); // operational retained
    expect(r.notes.some((n) => /financial-view/i.test(n))).toBe(true);
  });
});

describe('compareBranches — single branch + validation', () => {
  it('notes that a single-branch user has nothing to compare', async () => {
    const src = new FakeBranchSource({ b1: { kpis: kpis({}), booking: booking({ totalBookings: 5 }) } });
    const r = await new AiBusinessBranchesService(src, new FakeScope([{ branchId: 'b1', branchName: 'Only', status: 'active' }])).compareBranches(CTX({ role: 'MANAGER' }), 'month');
    expect(r.branchCount).toBe(1);
    expect(r.notes.some((n) => /nothing to compare/i.test(n))).toBe(true);
  });

  it('rejects an invalid preset', async () => {
    const src = new FakeBranchSource({});
    try { await new AiBusinessBranchesService(src, new FakeScope([])).compareBranches(CTX(), 'century'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('AI Branch Comparison guide: no 20-branch cap — every authorized branch, searched and paged; totals over all of them', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ branchId: `b${i}`, branchName: `B${String(i).padStart(2, '0')}`, status: i === 24 ? 'inactive' : 'active' }));
    const data: Record<string, { kpis: SalesKpis; booking: BookingsOverview }> = {};
    for (const b of many) data[b.branchId] = { kpis: kpis({ netSalesCents: 1000, ticketsCount: 2 }), booking: booking({ totalBookings: 1, completed: 1 }) };
    const svc = new AiBusinessBranchesService(new FakeBranchSource(data), new FakeScope(many));
    const p1 = await svc.compareBranches(CTX(), { preset: 'month', pageSize: 10 });
    expect([p1.truncated, p1.totalItems, p1.totalPages, p1.branches.length, p1.inactiveHidden]).toEqual([false, 24, 3, 10, 1]);
    expect(p1.totals).toMatchObject({ netSalesCents: 24000, ticketsCount: 48, averageTicketCents: 500, branches: 24 });
    const p3 = await svc.compareBranches(CTX(), { preset: 'month', pageSize: 10, page: 3 });
    expect(p3.branches.map((b) => b.branchName)).toEqual(['B20', 'B21', 'B22', 'B23']);
    expect((await svc.compareBranches(CTX(), { preset: 'month', q: 'b07' })).branches.map((b) => b.branchName)).toEqual(['B07']);
    expect((await svc.compareBranches(CTX(), { preset: 'month', includeInactive: true, all: true })).branches).toHaveLength(25);
  });
  it('N/A instead of 0: no bookings → completion null; no tickets → average ticket null; average ticket is NET ÷ tickets', async () => {
    const svc = new AiBusinessBranchesService(new FakeBranchSource({ x: { kpis: kpis({ netSalesCents: 0, grossSalesCents: 0, ticketsCount: 0, averageTicketCents: 0 }), booking: booking({ totalBookings: 0, completed: 0 }) },
      y: { kpis: kpis({ netSalesCents: 9000, grossSalesCents: 10000, ticketsCount: 2, averageTicketCents: 5000 }), booking: booking({ totalBookings: 2, completed: 2 }) } }),
      new FakeScope([{ branchId: 'x', branchName: 'X', status: 'active' }, { branchId: 'y', branchName: 'Y', status: 'active' }]));
    const r = await svc.compareBranches(CTX(), 'month');
    expect(r.branches.find((b) => b.branchId === 'x')).toMatchObject({ completionRate: null, averageTicketCents: null, revenuePerCompletedAppointmentCents: null });
    expect(r.branches.find((b) => b.branchId === 'y')!.averageTicketCents).toBe(4500);
  });
  it('a custom From / To is checked and passed through', async () => {
    const svc = new AiBusinessBranchesService(new FakeBranchSource({}), new FakeScope([]));
    await expect(svc.compareBranches(CTX(), { from: '2026-11-05', to: '2026-11-01' })).rejects.toBeInstanceOf(AiBusinessError);
    await expect(svc.compareBranches(CTX(), { from: '2025-01-01', to: '2026-11-01' })).rejects.toBeInstanceOf(AiBusinessError);
    expect((await svc.compareBranches(CTX(), { from: '2026-10-01', to: '2026-10-31' })).range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});

describe('compareBranches — AI BRANCH COMPARISON 08: previous equal period (Nov 12 2026)', () => {
  // the source answers by the filters it is given, so we can prove which period each figure came from
  class PeriodSource implements BranchCompareSource {
    seen: ReportFilters[] = [];
    private pick(ctx: ReportsContext, f?: ReportFilters) { this.seen.push(f ?? {}); const prev = f?.period === 'previous' || f?.from === '2026-08-31'; return { b: ctx.branchId, prev }; }
    async getSales(ctx: ReportsContext, f?: ReportFilters) { const { b, prev } = this.pick(ctx, f); return { kpis: kpis({ netSalesCents: (b === 'b1' ? 1000 : 400) * (prev ? 1 : 2), ticketsCount: prev ? 10 : 20 }), trend }; }
    async getBooking(ctx: ReportsContext, f?: ReportFilters) { const { prev } = this.pick(ctx, f); return booking(prev ? { totalBookings: 10, completed: 5 } : { totalBookings: 10, completed: 9 }); }
  }
  const scope = new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }, { branchId: 'b2', branchName: 'Deptford', status: 'active' }]);

  it('a preset reads the reports\' own previous period per branch (period: previous) and keeps it apart from the current figures', async () => {
    const src = new PeriodSource();
    const r = await new AiBusinessBranchesService(src, scope).compareBranches(CTX(), { preset: 'month', compare: 'prior' });
    expect(r.totals.netSalesCents).toBe(2800);                     // current figures untouched
    expect(r.comparison).toMatchObject({ basis: 'previous_equal_period', preset: 'month', range: null, priorRange: null });
    expect(r.comparison!.byBranch.b1).toMatchObject({ netSalesCents: 1000, completed: 5, completionRate: 50 });
    expect(r.comparison!.totals).toMatchObject({ netSalesCents: 1400, ticketsCount: 20, totalBookings: 20, completed: 10, completionRate: 50 });
    expect(src.seen.filter((f) => f.period === 'previous').every((f) => f.preset === 'month')).toBe(true);
  });
  it('a custom range compares with the same number of days immediately before it — named, never silently moved', async () => {
    const src = new PeriodSource();
    const r = await new AiBusinessBranchesService(src, scope).compareBranches(CTX(), { from: '2026-10-01', to: '2026-10-31', compare: 'prior' });
    expect(r.comparison).toMatchObject({ range: { from: '2026-10-01', to: '2026-10-31' }, priorRange: { from: '2026-08-31', to: '2026-09-30' } });
    expect(src.seen.some((f) => f.from === '2026-08-31' && f.to === '2026-09-30')).toBe(true);
    expect(r.comparison!.byBranch.b2).toMatchObject({ netSalesCents: 400, completionRate: 50 });   // the prior window's own figures
  });
  it('no compare asked → no comparison and no extra reads; financial view denied → prior money is hidden too', async () => {
    const src = new PeriodSource();
    expect((await new AiBusinessBranchesService(src, scope).compareBranches(CTX(), { preset: 'week' })).comparison).toBeUndefined();
    expect(src.seen.some((f) => f.period === 'previous')).toBe(false);
    const denied = new FakeBranchSource({ b1: { kpis: kpis({ netSalesCents: 5 }), booking: booking({ totalBookings: 4, completed: 2 }) } }, true);
    const r = await new AiBusinessBranchesService(denied, scope).compareBranches(CTX(), { preset: 'week', compare: 'prior' });
    expect(r.comparison!.totals.netSalesCents).toBeNull(); expect(r.comparison!.byBranch.b1.netSalesCents).toBeNull();
  });
});

import { priorCustomRange } from './ai-business-branches.service';
describe('priorCustomRange', () => {
  it('equal length, ending the day before; across months and a leap day', () => {
    expect(priorCustomRange({ from: '2026-11-12', to: '2026-11-12' })).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(priorCustomRange({ from: '2028-03-01', to: '2028-03-07' })).toEqual({ from: '2028-02-23', to: '2028-02-29' });
  });
});

describe('compareBranches — AI BRANCH COMPARISON 01: comparison readiness (Nov 12 2026)', () => {
  const scope3 = new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }, { branchId: 'b2', branchName: 'Deptford', status: 'active' }, { branchId: 'b3', branchName: 'Cherry Hill', status: 'active' }]);
  it('ready: every branch had activity, none is a small sample, revenue readable, period closed — coverage over ALL matched branches, not the page', async () => {
    const src = new FakeBranchSource({ b1: { kpis: kpis({ netSalesCents: 1000, ticketsCount: 10 }), booking: booking({ totalBookings: 12, completed: 10 }) },
      b2: { kpis: kpis({ netSalesCents: 800, ticketsCount: 8 }), booking: booking({ totalBookings: 9, completed: 8 }) },
      b3: { kpis: kpis({ netSalesCents: 500, ticketsCount: 5 }), booking: booking({ totalBookings: 6, completed: 5 }) } });
    const r = await new AiBusinessBranchesService(src, scope3).compareBranches(CTX(), { preset: 'month', pageSize: 10, page: 1 });
    expect(r.readiness).toMatchObject({ level: 'ready', coveragePercent: 100, branches: 3, withActivity: 3, noActivity: 0, smallSample: 0, financialCoverage: true, partialPeriod: false, source: 'live_reports', reasons: [] });
    expect(r.readiness.asOf).toBe(r.asOf);
  });
  it('limited: a branch with no activity and a small sample are named; coverage 67 %', async () => {
    const src = new FakeBranchSource({ b1: { kpis: kpis({ netSalesCents: 1000, ticketsCount: 10 }), booking: booking({ totalBookings: 12, completed: 10 }) },
      b2: { kpis: kpis({ netSalesCents: 100, ticketsCount: 1 }), booking: booking({ totalBookings: 2, completed: 1 }) } });
    const r = await new AiBusinessBranchesService(src, scope3).compareBranches(CTX(), 'month');
    expect(r.readiness).toMatchObject({ level: 'limited', coveragePercent: 67, withActivity: 2, noActivity: 1, smallSample: 1, reasons: ['branch_without_activity', 'small_sample'] });
  });
  it('not ready: fewer than two branches with activity; a single authorized branch; revenue hidden and a partial day are reasons too', async () => {
    const one = new FakeBranchSource({ b1: { kpis: kpis({ ticketsCount: 3 }), booking: booking({ totalBookings: 7, completed: 6 }) } }, true);
    const r = await new AiBusinessBranchesService(one, scope3).compareBranches(CTX(), 'today');
    expect(r.readiness).toMatchObject({ level: 'not_ready', withActivity: 1, financialCoverage: false, partialPeriod: true });
    expect(r.readiness.reasons).toEqual(['too_few_with_activity', 'branch_without_activity', 'revenue_hidden', 'partial_period']);
    const single = await new AiBusinessBranchesService(one, new FakeScope([{ branchId: 'b1', branchName: 'Marlton', status: 'active' }])).compareBranches(CTX(), 'month');
    expect(single.readiness).toMatchObject({ level: 'not_ready', branches: 1, reasons: ['single_branch', 'revenue_hidden'] });
    const none = await new AiBusinessBranchesService(one, new FakeScope([])).compareBranches(CTX(), 'month');
    expect(none.readiness.coveragePercent).toBeNull();
  });
});
