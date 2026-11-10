import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posMarketingReportApi', () => ({ posMarketingReportApi: { state: stateMock } }));
import { POSMarketingReportScreen } from './POSMarketingReportScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  headline: { campaignRevenueCents: 500000, campaignRoi: 5, activePromotions: 3, promotionRedemptions: 64, averageRating: 4.6, totalReviews: 40 },
  campaigns: { totalCampaigns: 5, activeCampaigns: 2, totalSent: 1200, campaignRevenueCents: 500000, totalCostCents: 100000, avgRoi: 5, avgOpenRate: 42 },
  promotions: { total: 8, active: 3, paused: 1, totalRedemptions: 64, expiringSoon: 1 },
  reviews: { totalReviews: 40, averageRating: 4.6, fiveStarPercent: 72.5, publicCount: 38, hiddenCount: 2 },
};

describe('POSMarketingReportScreen', () => {
  it('renders composed headline + three pillars', async () => {
    stateMock.mockResolvedValue(state);
    render(<MemoryRouter><POSMarketingReportScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Marketing Report' })).toBeInTheDocument();
    expect(screen.getAllByText('$5,000.00').length).toBeGreaterThan(0); // campaign revenue
    expect(screen.getByText('Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Promotions')).toBeInTheDocument();
    expect(screen.getByText('Reputation')).toBeInTheDocument();
    expect(screen.getByText('72.5%')).toBeInTheDocument();       // five-star share
  });
});

describe('POSMarketingReportScreen — batch 9 guide 12 (Nov 10 2026)', () => {
  it('no reviews and nothing sent: N/A instead of a crash / "nullx"; the cost is labelled as entered; all-time scope', async () => {
    stateMock.mockResolvedValue({ ...state,
      headline: { ...state.headline, campaignRevenueCents: 0, campaignRoi: null, averageRating: null, totalReviews: 0 },
      campaigns: { ...state.campaigns, totalSent: 0, campaignRevenueCents: 0, totalCostCents: 10000, avgRoi: null },
      reviews: { totalReviews: 0, averageRating: 0, fiveStarPercent: 0, publicCount: 0, hiddenCount: 0 } });
    render(<MemoryRouter><POSMarketingReportScreen /></MemoryRouter>);
    expect(await screen.findByTestId('mkt-roi')).toHaveTextContent('ROI N/A');
    expect(screen.getByTestId('mkt-rating')).toHaveTextContent('N/A');
    expect(screen.getByText(/entered on the campaign/)).toBeInTheDocument();
    expect(screen.getByTestId('mkt-scope')).toHaveTextContent('All time');
  });
});
