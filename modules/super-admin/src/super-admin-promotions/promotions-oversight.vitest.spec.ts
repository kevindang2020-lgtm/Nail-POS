import { describe, it, expect, vi } from 'vitest';
import { PromotionsOversightService } from './promotions-oversight.service';

// Service contract over the real promotions + tenant_promotion_redemptions tables: sourceable KPIs resolve (incl. the newly
// real Platform Offers, High-Value Pending, weighted Average Discount, Promotion Mix by Type); templates/abuse/
// redemption-rate/ROI remain honest gaps. Never fabricated.
function harness() {
  const repo = {
    statusCounts: vi.fn(async () => [{ status: 'active', count: 78 }, { status: 'scheduled', count: 22 }, { status: 'completed', count: 164 }]),
    typeCounts: vi.fn(async () => [{ type: 'percentage', count: 38 }, { type: 'fixed_amount', count: 20 }, { type: 'bundle', count: 6 }]),
    kpiTotals: vi.fn(async () => ({ active: 78, scheduled: 22, completed: 164, redemptions: 12846, revenueCents: 12876400, participatingBranches: 342, platformOffers: 24, highValuePending: 11, discountTotalCents: 3120000, eligibleTotalCents: 16684492 })),
    daily7: vi.fn(async () => [{ day: '2026-05-06', redemptions: 1842, revenueCents: 1862000 }]),
    topPromotions: vi.fn(async () => [{ id: 'p1', name: 'May Glow Up', tenant: 'Glamour', branch: 'Downtown', offer: 'percentage', status: 'active', revenueCents: 2145000, redemptions: 1842, startAt: '2026-05-01T00:00:00Z', endAt: '2026-05-15T00:00:00Z' }]),
    byTenant: vi.fn(async () => [{ tenantId: 't1', tenant: 'Glamour Studio', active: 8, redemptions: 2145, revenueCents: 2243000, lastActivity: '2026-05-06T13:15:00Z' }]),
    exceptionCandidates: vi.fn(async () => [
      { id: 'o1', name: 'Bad', tenant: 'Luxe', status: 'active', startAt: '2026-05-10T00:00:00Z', endAt: '2026-05-01T00:00:00Z', branchId: 'b1', tenantId: 't1', revenueCents: 0 },
      { id: 'o2', name: 'Clean', tenant: 'Elite', status: 'active', startAt: '2026-05-01T00:00:00Z', endAt: '2026-12-01T00:00:00Z', branchId: 'b1', tenantId: 't1', revenueCents: 0 },
    ]),
    bottomTotals: vi.fn(async () => ({ redemptionsToday: 1842, revenueTodayCents: 1862000, newOffersToday: 7 })),
  };
  return { svc: new PromotionsOversightService(repo as any) };
}

describe('PromotionsOversightService.overview (promotions-backed)', () => {
  it('resolves the now-real KPIs and keeps templates/abuse/redemption-rate honest gaps', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.kpis.activePromotions).toEqual({ value: 78, available: true });
    expect(o.kpis.platformOffers).toMatchObject({ value: 24, available: true });
    expect(o.kpis.highValuePending).toMatchObject({ value: 11, available: true });
    expect(o.kpis.averageDiscountPct.available).toBe(true); // weighted
    expect(o.kpis.revenueImpactCents).toMatchObject({ value: 12876400, available: true });
    for (const g of ['promotionTemplates', 'abuseAlerts', 'redemptionRatePct'] as const) {
      expect(o.kpis[g].available).toBe(false);
      expect(o.kpis[g].note).toBeTruthy();
    }
  });

  it('builds a real Promotion Mix by Type donut and reconciling status mix', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.promotionMixByType.available).toBe(true);
    expect((o.promotionMixByType as any).total).toBe(64);
    expect((o.promotionMixByType as any).segments[0]).toEqual({ label: 'Percentage Discount', value: 38 });
    expect(o.statusMix.total).toBe(264);
    expect(o.topPromotions[0]).toMatchObject({ name: 'May Glow Up', status: 'Active', revenueCents: 2145000 });
  });

  it('derives real offer exceptions and gaps ROI/abuse honestly', async () => {
    const { svc } = harness();
    const o = await svc.overview();
    expect(o.offerExceptions.map((e) => e.issue)).toContain('End date before start date');
    expect(o.bottom.averageOfferRoi.available).toBe(false);
    expect(o.bottom.abuseCasesOpen.available).toBe(false);
    expect(o.abuseByStatus.available).toBe(false);
    expect(o.bottom.redemptionsToday).toMatchObject({ value: 1842, available: true });
  });
});
