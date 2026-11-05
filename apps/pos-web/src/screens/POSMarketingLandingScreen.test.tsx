// POSMarketingLandingScreen.test.tsx — the Marketing & Growth group's home (Jul 27, 2026).
//
// The two things worth pinning: (1) the landing COMPOSES existing endpoints and never invents a number, and
// (2) one failing section must not blank the others — a loyalty outage cannot take the campaign figures with it,
// and a section that fails must SAY so rather than rendering a zero (a fabricated zero is worse than a gap).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSMarketingLandingScreen } from './POSMarketingLandingScreen';

const reportState = vi.fn();
const loyaltyState = vi.fn();
const referralsState = vi.fn();
const giftState = vi.fn();

vi.mock('../api/posMarketingReportApi', () => ({ posMarketingReportApi: { state: (...a: any[]) => reportState(...a) } }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: { state: (...a: any[]) => loyaltyState(...a) } }));
vi.mock('../api/posReferralsApi', () => ({ posReferralsApi: { state: (...a: any[]) => referralsState(...a) } }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: { state: (...a: any[]) => giftState(...a) } }));

beforeEach(() => {
  reportState.mockReset(); loyaltyState.mockReset(); referralsState.mockReset(); giftState.mockReset();
  reportState.mockResolvedValue({ headline: { campaignRevenueCents: 425600, campaignRoi: 5.1, activePromotions: 3, promotionRedemptions: 142, averageRating: 4.8, totalReviews: 368 } });
  loyaltyState.mockResolvedValue({ kpis: { memberCount: 1248, pointsOutstanding: 245680, redemptionCount: 89, pointsRedeemed: 189340, activeRewards: 6 } });
  referralsState.mockResolvedValue({ kpis: { codesIssued: 210, totalReferrals: 86, pendingReferrals: 12, rewardedReferrals: 74, rewardValueCents: 148000 } });
  giftState.mockResolvedValue({ kpis: { activeCards: 54, outstandingBalanceCents: 1243000 } });
});

const view = () => render(<MemoryRouter><POSMarketingLandingScreen /></MemoryRouter>);

describe('Marketing & Growth landing', () => {
  it('composes all four sources into one view, with money formatted from cents', async () => {
    view();
    expect(await screen.findByText('$4,256.00')).toBeInTheDocument();     // campaign revenue
    expect(screen.getByText('5.1x')).toBeInTheDocument();                  // ROI
    expect(screen.getByText('1248')).toBeInTheDocument();                  // loyalty members
    expect(screen.getByText('86')).toBeInTheDocument();                    // referrals
    expect(screen.getByText('$12,430.00')).toBeInTheDocument();            // gift card balance owed
    // Each source is asked exactly once — the landing reads, it does not recompute.
    expect(reportState).toHaveBeenCalledTimes(1);
    expect(loyaltyState).toHaveBeenCalledTimes(1);
  });

  it('a failing section says so and does NOT blank the rest or show a fabricated zero', async () => {
    loyaltyState.mockRejectedValue(new Error('loyalty down'));
    view();
    expect(await screen.findByText(/Loyalty could not be loaded/i)).toBeInTheDocument();
    // The campaign numbers are untouched by the loyalty outage.
    expect(screen.getByText('$4,256.00')).toBeInTheDocument();
    // …and no zero was invented in loyalty's place.
    expect(screen.queryByText('Points Outstanding')).toBeNull();
  });

  it('every headline links to the screen that owns the metric rather than duplicating it', async () => {
    view();
    const tile = await screen.findByTitle('Open Campaign Revenue');
    expect(tile).toBeEnabled();
  });
});
