// marketing-report.dto.ts — a one-glance marketing performance view that COMPOSES the existing marketing
// surfaces (campaigns + salon promotions + reviews). No new aggregation logic: the numbers come from the
// same services that power those screens; this only reshapes them into a headline + three pillars.

export interface MarketingReportContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export interface CampaignsPillar {
  totalCampaigns: number; activeCampaigns: number; totalSent: number;
  campaignRevenueCents: number; totalCostCents: number; avgRoi: number; avgOpenRate: number;
}
export interface PromotionsPillar {
  total: number; active: number; paused: number; totalRedemptions: number; expiringSoon: number;
}
export interface ReviewsPillar {
  totalReviews: number; averageRating: number; fiveStarPercent: number; publicCount: number; hiddenCount: number;
}

export interface MarketingHeadline {
  campaignRevenueCents: number;
  campaignRoi: number;
  activePromotions: number;
  promotionRedemptions: number;
  averageRating: number;
  totalReviews: number;
}

export interface MarketingReportState {
  headline: MarketingHeadline;
  campaigns: CampaignsPillar;
  promotions: PromotionsPillar;
  reviews: ReviewsPillar;
}

// Pure headline composer — pulls the few numbers an owner scans first out of the three pillars.
export function composeHeadline(c: CampaignsPillar, p: PromotionsPillar, r: ReviewsPillar): MarketingHeadline {
  return {
    campaignRevenueCents: Math.max(0, Math.round(c.campaignRevenueCents || 0)),
    campaignRoi: Number(c.avgRoi) || 0,
    activePromotions: Math.max(0, p.active || 0),
    promotionRedemptions: Math.max(0, p.totalRedemptions || 0),
    averageRating: Number(r.averageRating) || 0,
    totalReviews: Math.max(0, r.totalReviews || 0),
  };
}
