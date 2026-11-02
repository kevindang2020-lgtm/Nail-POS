// Promotions & Offers oversight service — composes the dashboard from the real promotions + tenant_promotion_redemptions
// tables via promotions-core. Widgets with no schema (templates, abuse, redemption-rate denominator, ROI cost) stay
// honest gaps. Discounts/revenue are integer cents; Revenue Impact is gross attributed post-discount revenue.
import type { PromotionsOversightRepositoryPort } from './promotions-oversight.repository';
import { assemblePromotionKpis, assembleStatusMix, assembleTypeMix, weightedDiscountPct, deriveOfferExceptions, offerStatus, pct } from './promotions-core';

export class PromotionsOversightService {
  constructor(private readonly repo: PromotionsOversightRepositoryPort) {}

  async overview() {
    const [statusCounts, typeCounts, totals, daily, top, tenants, exceptionRows, bottom] = await Promise.all([
      this.repo.statusCounts(), this.repo.typeCounts(), this.repo.kpiTotals(), this.repo.daily7(), this.repo.topPromotions(8), this.repo.byTenant(8), this.repo.exceptionCandidates(200), this.repo.bottomTotals(),
    ]);

    const avgDiscount = weightedDiscountPct(totals.discountTotalCents, totals.eligibleTotalCents);
    const kpis = assemblePromotionKpis({
      activePromotions: totals.active, scheduledPromotions: totals.scheduled, completedPromotions: totals.completed,
      discountRedemptions: totals.redemptions, revenueImpactCents: totals.revenueCents, participatingBranches: totals.participatingBranches,
      platformOffers: totals.platformOffers, highValuePending: totals.highValuePending, averageDiscountPct: avgDiscount,
    });
    const statusMix = assembleStatusMix(statusCounts);
    const typeMix = assembleTypeMix(typeCounts);
    const exceptions = exceptionRows.flatMap((o) => deriveOfferExceptions(o)).slice(0, 25);

    return {
      kpis,
      statusMix,
      promotionMixByType: typeMix.total > 0 ? { available: true, ...typeMix } : { available: false, note: 'No promotions created yet' },
      trend: daily.map((d) => ({ day: d.day, redemptions: d.redemptions, revenueCents: d.revenueCents })),
      redemptionsVsRevenue: daily.map((d) => ({ day: d.day, redemptions: d.redemptions, revenueCents: d.revenueCents })),
      topPromotions: top.map((r) => ({
        id: r.id, name: r.name || '(unnamed)', tenant: r.tenant, branch: r.branch, offer: r.offer,
        status: offerStatus(r.status).label, statusTone: offerStatus(r.status).tone, revenueCents: r.revenueCents, redemptions: r.redemptions, startAt: r.startAt, endAt: r.endAt,
      })),
      tenantOversight: tenants.map((t) => ({ tenantId: t.tenantId, tenant: t.tenant || '(unknown)', active: t.active, redemptions: t.redemptions, revenueCents: t.revenueCents, lastActivity: t.lastActivity })),
      offerExceptions: exceptions,
      bottom: {
        redemptionsToday: { value: bottom.redemptionsToday, available: true },
        revenueTodayCents: { value: bottom.revenueTodayCents, available: true },
        newOffersToday: { value: bottom.newOffersToday, available: true },
        abuseCasesOpen: { value: null, available: false, note: 'No abuse-detection schema' },
        approvalSlaHours: { value: null, available: false, note: 'No approval-timing schema' },
        averageOfferRoi: { value: null, available: false, note: 'No promotion-cost/funding schema' },
      },
      // Still honest gaps — no schema
      abuseByStatus: { available: false, note: 'No abuse-detection schema' },
      abuseReview: { available: false, note: 'No abuse-case schema' },
      meta: { redemptionsLabel: 'Successful promotion redemptions', revenueLabel: 'Gross attributed post-discount revenue', activeRatePct: pct(totals.active, totals.active + totals.scheduled + totals.completed) },
    };
  }
}
