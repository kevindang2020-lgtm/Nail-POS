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
  campaignRevenueCents: number; totalCostCents: number; avgRoi: number | null; avgOpenRate: number;
}
export interface PromotionsPillar {
  total: number; active: number; paused: number; totalRedemptions: number; expiringSoon: number;
}
export interface ReviewsPillar {
  totalReviews: number; averageRating: number; fiveStarPercent: number; publicCount: number; hiddenCount: number;
}

export interface MarketingHeadline {
  campaignRevenueCents: number;
  campaignRoi: number | null;   // revenue ÷ cost; null = no cost recorded (shown N/A, never 0x)
  activePromotions: number;
  promotionRedemptions: number;
  averageRating: number | null;   // null = no reviews (shown N/A, never 0 ★)
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
    // batch 9 guide 12 (Nov 10 2026): the campaign cost is what the owner ENTERED on the campaign, not provider charges — with
    // nothing sent there is no return to measure, so ROI is N/A (it read "0x" beside a $100 entered cost and 0 messages)
    campaignRoi: (c.totalSent ?? 0) <= 0 || c.avgRoi == null || !Number.isFinite(Number(c.avgRoi)) ? null : Number(c.avgRoi),
    activePromotions: Math.max(0, p.active || 0),
    promotionRedemptions: Math.max(0, p.totalRedemptions || 0),
    averageRating: (r.totalReviews ?? 0) > 0 ? Number(r.averageRating) || 0 : null,
    totalReviews: Math.max(0, r.totalReviews || 0),
  };
}
