// marketing-report.service.ts — composes campaigns + salon promotions + reviews into one marketing view.
// Reuses each domain's own service.getState (no duplicated aggregation). The controller enforces
// pos.marketing.view; each sub-service is tenant-scoped from ctx.
import { composeHeadline, type MarketingReportContext, type MarketingReportState } from './marketing-report.dto';
import type { CampaignsService } from '@aipowersalon/communications';
import type { SalonPromotionsService } from '@aipowersalon/deals';
import type { ReviewsService } from '@aipowersalon/customers';

export class MarketingReportForbiddenError extends Error {}

export class MarketingReportService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly promotions: SalonPromotionsService,
    private readonly reviews: ReviewsService,
  ) {}

  async getState(ctx: MarketingReportContext): Promise<MarketingReportState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new MarketingReportForbiddenError('Not authenticated');
    // The controller guard already enforced pos.marketing.view for this endpoint. The sub-services do
    // their own defense-in-depth check against the granular permission string, so pass a context that
    // carries it (all three pillars share the same pos.marketing.view gate — no privilege is widened).
    const subCtx = { ...ctx, permissions: Array.from(new Set([...(ctx.permissions || []), 'pos.marketing.view'])) };
    const [camp, promo, revs] = await Promise.all([
      this.campaigns.getState(subCtx as any),
      this.promotions.getState(subCtx as any),
      this.reviews.getState(subCtx as any),
    ]);
    const campaigns = {
      totalCampaigns: camp.kpis.totalCampaigns, activeCampaigns: camp.kpis.activeCampaigns, totalSent: camp.kpis.totalSent,
      campaignRevenueCents: camp.kpis.campaignRevenueCents, totalCostCents: camp.kpis.totalCostCents,
      avgRoi: camp.kpis.avgRoi, avgOpenRate: camp.kpis.avgOpenRate,
    };
    const promotions = {
      total: promo.kpis.total, active: promo.kpis.active, paused: promo.kpis.paused,
      totalRedemptions: promo.kpis.totalRedemptions, expiringSoon: promo.kpis.expiringSoon,
    };
    const reviews = {
      totalReviews: revs.kpis.totalReviews, averageRating: revs.kpis.averageRating, fiveStarPercent: revs.kpis.fiveStarPercent,
      publicCount: revs.kpis.publicCount, hiddenCount: revs.kpis.hiddenCount,
    };
    return { headline: composeHeadline(campaigns, promotions, reviews), campaigns, promotions, reviews };
  }
}
