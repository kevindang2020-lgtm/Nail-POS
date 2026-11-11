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

describe('composeHeadline — batch 9 guide 12 (Nov 10 2026)', () => {
  it('an entered campaign cost with nothing sent is not a 0x return: ROI is N/A', () => {
    const h = composeHeadline({ totalCampaigns: 1, activeCampaigns: 0, totalSent: 0, campaignRevenueCents: 0, totalCostCents: 10000, avgRoi: 0, avgOpenRate: 0 } as any,
      { total: 1, active: 1, paused: 0, totalRedemptions: 0, expiringSoon: 0 } as any, { totalReviews: 4, averageRating: 5, fiveStarPercent: 100, publicCount: 4, hiddenCount: 0 } as any);
    expect(h.campaignRoi).toBeNull(); expect(h.averageRating).toBe(5);
  });
});

describe('marketing-report — a period (batch 9 decision 2, Nov 10 2026)', () => {
  const C = (id: string, scheduledAt: string | null, createdAt: string, sent: number, rev: number) => ({ id, scheduledAt, createdAt, sentCount: sent, openCount: 0, clickCount: 0, replyCount: 0, bookingCount: 0, revenueCents: rev, costCents: 0, status: 'completed' });
  const camps = [C('a', '2026-10-05T15:00:00Z', '2026-09-20T00:00:00Z', 100, 20000), C('b', null, '2026-10-20T15:00:00Z', 50, 5000), C('c', '2026-09-30T15:00:00Z', '2026-09-01T00:00:00Z', 999, 99900)];
  const pages = [camps.slice(0, 2), camps.slice(2)];
  const campsSvc = { getState: async (_c: any, f: any) => ({ kpis: {}, campaigns: f?.page ? pages[f.page - 1] : [], pagination: { totalPages: 2 } }) } as any;
  const promos = { getState: async () => ({ kpis: promoState.kpis, promotions: [
    { id: 'p1', status: 'active', startsAt: '2026-10-10T00:00:00Z', endsAt: null, createdAt: '2026-10-01T00:00:00Z', redemptionCount: 7 },
    { id: 'p2', status: 'active', startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-03-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', redemptionCount: 50 },
  ] }) } as any;
  const revs = { getState: async () => ({ kpis: revState.kpis, reviews: [
    { id: 'r1', rating: 5, isPublic: true, isHidden: false, comment: null, createdAt: '2026-10-11T18:00:00Z' },
    { id: 'r2', rating: 3, isPublic: true, isHidden: false, comment: null, createdAt: '2026-11-01T03:00:00Z' },   // Oct 31, 11 pm in the salon (New York) — inside the window
  ] }) } as any;
  it('scopes campaigns (all pages, by send day), reviews (by day left) and promotions (run overlaps) to the window', async () => {
    const svc = new MarketingReportService(campsSvc, promos, revs);   // no db → the default salon zone
    const st = await svc.getState(ctx, { preset: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(st.period).toMatchObject({ from: '2026-10-01', to: '2026-10-31', preset: 'custom' });
    expect(st.campaigns.totalCampaigns).toBe(2); expect(st.campaigns.totalSent).toBe(150); expect(st.campaigns.campaignRevenueCents).toBe(25000);
    expect(st.promotions.total).toBe(1); expect(st.promotions.totalRedemptions).toBe(7); expect(st.redemptionsAllTime).toBe(true);
    expect(st.reviews.totalReviews).toBe(2); expect(st.reviews.averageRating).toBe(4);
  });
  it('no period = all time, as before; a bad range is refused with the registry code', async () => {
    const svc = new MarketingReportService(fakeCampaigns, fakePromos, fakeReviews);
    const st = await svc.getState(ctx);
    expect(st.period).toBeNull(); expect(st.campaigns.totalCampaigns).toBe(5); expect(st.redemptionsAllTime).toBeUndefined();
    await expect(svc.getState(ctx, { preset: 'custom', from: '2026-10-31', to: '2026-10-01' })).rejects.toMatchObject({ apiCode: 'DATE_RANGE_INVALID' });
    await expect(svc.getState(ctx, { preset: 'custom', from: '2025-01-01', to: '2026-10-01' })).rejects.toMatchObject({ apiCode: 'DATE_RANGE_TOO_LARGE' });
    await expect(svc.getState(ctx, { preset: 'forever' })).rejects.toMatchObject({ apiCode: 'DATE_RANGE_INVALID' });
  });
});
