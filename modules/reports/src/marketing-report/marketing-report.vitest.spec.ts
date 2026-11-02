import { describe, it, expect } from 'vitest';
import { composeHeadline } from './marketing-report.dto';
import { MarketingReportService, MarketingReportForbiddenError } from './marketing-report.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.marketing.view'] };
const campState = { kpis: { totalCampaigns: 5, activeCampaigns: 2, totalSent: 1200, campaignRevenueCents: 500000, totalCostCents: 100000, avgRoi: 5, avgOpenRate: 42 }, campaigns: [], pagination: {} };
const promoState = { kpis: { total: 8, active: 3, paused: 1, totalRedemptions: 64, expiringSoon: 1 }, promotions: [] };
const revState = { kpis: { totalReviews: 40, averageRating: 4.6, ratingDistribution: [], publicCount: 38, hiddenCount: 2, withCommentCount: 25, fiveStarPercent: 72.5 }, reviews: [] };
const fakeCampaigns = { getState: async () => campState } as any;
const fakePromos = { getState: async () => promoState } as any;
const fakeReviews = { getState: async () => revState } as any;

describe('marketing-report — headline (pure)', () => {
  it('pulls the scan-first numbers from the three pillars', () => {
    const h = composeHeadline(
      { totalCampaigns: 5, activeCampaigns: 2, totalSent: 1200, campaignRevenueCents: 500000, totalCostCents: 100000, avgRoi: 5, avgOpenRate: 42 },
      { total: 8, active: 3, paused: 1, totalRedemptions: 64, expiringSoon: 1 },
      { totalReviews: 40, averageRating: 4.6, fiveStarPercent: 72.5, publicCount: 38, hiddenCount: 2 },
    );
    expect(h).toEqual({ campaignRevenueCents: 500000, campaignRoi: 5, activePromotions: 3, promotionRedemptions: 64, averageRating: 4.6, totalReviews: 40 });
  });
  it('Marketing & Growth §07/§12: no cost → ROI null (N/A, never 0x); no reviews → rating null (N/A, never 0 ★)', () => {
    const h = composeHeadline(
      { totalCampaigns: 1, activeCampaigns: 0, totalSent: 0, campaignRevenueCents: 0, totalCostCents: 0, avgRoi: null, avgOpenRate: 0 },
      { total: 1, active: 1, paused: 0, totalRedemptions: 0, expiringSoon: 0 },
      { totalReviews: 0, averageRating: 0, fiveStarPercent: 0, publicCount: 0, hiddenCount: 0 },
    );
    expect(h.campaignRoi).toBeNull(); expect(h.averageRating).toBeNull();
  });
});

describe('marketing-report — service composition', () => {
  it('composes campaigns + promotions + reviews into one state', async () => {
    const svc = new MarketingReportService(fakeCampaigns, fakePromos, fakeReviews);
    const st = await svc.getState(ctx);
    expect(st.campaigns.totalCampaigns).toBe(5);
    expect(st.promotions.active).toBe(3);
    expect(st.reviews.averageRating).toBe(4.6);
    expect(st.headline.campaignRevenueCents).toBe(500000);
    expect(st.headline.promotionRedemptions).toBe(64);
  });
  it('rejects unauthenticated', async () => {
    const svc = new MarketingReportService(fakeCampaigns, fakePromos, fakeReviews);
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(MarketingReportForbiddenError);
  });
});
