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

  it('truncates and notes when authorized branches exceed the fan-out cap', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ branchId: `b${i}`, branchName: `B${i}`, status: 'active' }));
    const data: Record<string, { kpis: SalesKpis; booking: BookingsOverview }> = {};
    for (const b of many) data[b.branchId] = { kpis: kpis({}), booking: booking({ totalBookings: 1 }) };
    const r = await new AiBusinessBranchesService(new FakeBranchSource(data), new FakeScope(many)).compareBranches(CTX(), 'month');
    expect(r.truncated).toBe(true);
    expect(r.branchCount).toBe(20);
    expect(r.notes.some((n) => /first 20/i.test(n))).toBe(true);
  });
});
