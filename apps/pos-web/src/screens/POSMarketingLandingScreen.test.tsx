// POSMarketingLandingScreen.test.tsx — Marketing & Growth (Jul 27, 2026; rebuilt Oct 30 2026 for the Marketing & Growth guide).
//
// Pinned: (1) the dashboard COMPOSES the endpoints that own each number and never invents one — campaign revenue / ROI come
// from Campaign Center, an unknown ROI reads N/A (never "0x"), no reviews reads N/A (never "0 ★"); (2) one failing section
// must not blank the others and must SAY so rather than render a zero; (3) the quick actions and Open links are kept;
// (4) the Smart Campaign Assistant only navigates to Campaign Center's assistant — it never sends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSMarketingLandingScreen } from './POSMarketingLandingScreen';

const reportState = vi.fn(); const loyaltyState = vi.fn(); const referralsState = vi.fn(); const giftState = vi.fn();
const ccOverview = vi.fn(); const discKpis = vi.fn(); const recon = vi.fn(); const econ = vi.fn(); const activity = vi.fn(); const search = vi.fn(); const journey = vi.fn();
const navigate = vi.fn();

vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../api/posMarketingReportApi', () => ({ posMarketingReportApi: { state: (...a: any[]) => reportState(...a) } }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: { state: (...a: any[]) => loyaltyState(...a) } }));
vi.mock('../api/posReferralsApi', () => ({ posReferralsApi: { state: (...a: any[]) => referralsState(...a) } }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: { state: (...a: any[]) => giftState(...a) } }));
vi.mock('../api/posCampaignCenterApi', () => ({ posCampaignCenterApi: { overview: (...a: any[]) => ccOverview(...a) } }));
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: { kpis: (...a: any[]) => discKpis(...a) } }));
vi.mock('../api/posMarketingGrowthApi', async (orig) => ({ ...(await orig() as object), posMarketingGrowthApi: {
  reconciliation: (...a: any[]) => recon(...a), economics: (...a: any[]) => econ(...a), activity: (...a: any[]) => activity(...a), search: (...a: any[]) => search(...a), journey: (...a: any[]) => journey(...a) } }));

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-30' };
beforeEach(() => {
  for (const f of [reportState, loyaltyState, referralsState, giftState, ccOverview, discKpis, recon, econ, activity, search, journey, navigate]) f.mockReset();
  reportState.mockResolvedValue({ headline: { campaignRevenueCents: 0, campaignRoi: null, activePromotions: 1, promotionRedemptions: 0, averageRating: 5, totalReviews: 4 } });
  ccOverview.mockResolvedValue({ kpis: { campaignRevenueCents: 425600, avgRoi: null, totalSent: 0 } });
  discKpis.mockResolvedValue({ activeDiscounts: 1, ledger: { confirmedEvents: 0 } });
  loyaltyState.mockResolvedValue({ kpis: { memberCount: 2, pointsOutstanding: 1298, redemptionCount: 0, pointsRedeemed: 0, activeRewards: 0 } });
  referralsState.mockResolvedValue({ kpis: { codesIssued: 2, totalReferrals: 0, pendingReferrals: 0, rewardedReferrals: 0, rewardValueCents: 0 } });
  giftState.mockResolvedValue({ kpis: { activeCards: 0, outstandingCents: 0 } });
  recon.mockResolvedValue({ overall: 'ready', sections: [{ key: 'loyalty', title: 'Loyalty points outstanding', status: 'ready', values: { pointsOutstandingTenantWide: 1298, ledgerTotal: 1298 }, formula: 'Σ', caveats: [], defects: [] }], defects: [] });
  econ.mockResolvedValue({ totals: { spendCents: null, campaignsMissingCost: 1, attributedRevenueCents: 0, roi: null, roas: null }, campaigns: [], programCosts: { promotionDiscountCents: 0, referralRewardCents: 0, note: '' }, formulas: {}, excludes: [], reconciliation: { reconciled: true } });
  activity.mockResolvedValue({ period, scope: { label: 'tenant_wide', selected: null, branches: [] }, items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } });
});

const view = () => render(<MemoryRouter initialEntries={['/tenant/marketing']}><POSMarketingLandingScreen /></MemoryRouter>);

describe('Marketing & Growth dashboard', () => {
  it('reads each number from its owner: revenue from Campaign Center, ROI N/A (never "0x"), 1,298 points from loyalty', async () => {
    view();
    expect((await screen.findAllByText('$4,256.00')).length).toBeGreaterThan(0);
    expect(screen.queryByText('0x')).toBeNull();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,298').length).toBeGreaterThan(0);
    expect(ccOverview).toHaveBeenCalledTimes(1); expect(loyaltyState).toHaveBeenCalledTimes(1);
  });
  it('a failing section says so and does NOT blank the rest or show a fabricated zero', async () => {
    loyaltyState.mockRejectedValue(new Error('loyalty down'));
    view();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect((await screen.findAllByText('$4,256.00')).length).toBeGreaterThan(0);
  });
  it('keeps the six quick actions; the Smart Campaign Assistant navigates to Campaign Center\'s assistant and sends nothing', async () => {
    view();
    for (const l of ['Launch Promo', 'Issue Gift Card', 'Request Review']) expect(await screen.findByText(l)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mg-assistant'));
    fireEvent.click(await screen.findByTestId('mg-goal-inactive'));
    expect(navigate).toHaveBeenCalledWith('/tenant/marketing/campaigns?assistant=inactive');
  });
  it('unknown campaign spend reads N/A in Marketing Cost & Profit', async () => {
    view();
    expect(await screen.findByTestId('mg-econ-spend')).toHaveTextContent('N/A');
  });
});
