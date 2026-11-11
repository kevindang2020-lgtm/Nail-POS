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

/** The window the figures cover. null = all time (no period asked). Salon-local days, inclusive. */
export interface MarketingPeriod { from: string; to: string; preset: string | null; timeZone: string; today: string }

export interface MarketingReportState {
  period?: MarketingPeriod | null;
  /** with a period: a promotion's redemptions are a running total (no dated redemption log), so they are all-time */
  redemptionsAllTime?: boolean;
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

// ── batch 9 decision 2 (Nov 10 2026): a period for the Marketing Report ─────────────────────────────────────────────────
/** the salon-local day (YYYY-MM-DD) of an instant */
export function localDay(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const inDays = (day: string | null, w: { from: string; to: string }) => !!day && day >= w.from && day <= w.to;
/** a campaign counts in the window it went out (its scheduled send, else the day it was created) */
export function campaignsInWindow<T extends { scheduledAt: string | null; createdAt: string }>(rows: T[], w: { from: string; to: string }, tz: string): T[] {
  return rows.filter((r) => inDays(localDay(r.scheduledAt ?? r.createdAt, tz), w));
}
/** a review counts on the day it was left */
export function reviewsInWindow<T extends { createdAt: string }>(rows: T[], w: { from: string; to: string }, tz: string): T[] {
  return rows.filter((r) => inDays(localDay(r.createdAt, tz), w));
}
/** a promotion counts when its run overlaps the window (no start = from its creation; no end = still running) */
export function promotionsInWindow<T extends { startsAt: string | null; endsAt: string | null; createdAt: string }>(rows: T[], w: { from: string; to: string }, tz: string): T[] {
  return rows.filter((p) => { const s = localDay(p.startsAt ?? p.createdAt, tz); const e = localDay(p.endsAt, tz); return (!s || s <= w.to) && (!e || e >= w.from); });
}
