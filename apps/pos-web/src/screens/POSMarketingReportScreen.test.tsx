import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('asks the server for the chosen period and says redemptions stay all-time (batch 9 decision 2)', async () => {
    stateMock.mockResolvedValue(state);
    render(<MemoryRouter initialEntries={['/tenant/reports/marketing?preset=month']}><POSMarketingReportScreen /></MemoryRouter>);
    await waitFor(() => expect(stateMock).toHaveBeenCalledWith({ preset: 'month' }));
    stateMock.mockResolvedValue({ ...state, period: { from: '2026-11-01', to: '2026-11-10', preset: 'month', timeZone: 'America/New_York', today: '2026-11-10' }, redemptionsAllTime: true });
    fireEvent.click(await screen.findByTestId('preset-all'));
    await waitFor(() => expect(stateMock).toHaveBeenLastCalledWith({ preset: 'all' }));
  });
  it('shows the window and the all-time note when the server scoped the figures', async () => {
    stateMock.mockResolvedValue({ ...state, period: { from: '2026-10-01', to: '2026-10-31', preset: 'custom', timeZone: 'America/New_York', today: '2026-11-10' }, redemptionsAllTime: true });
    render(<MemoryRouter initialEntries={['/x?preset=custom&from=2026-10-01&to=2026-10-31']}><POSMarketingReportScreen /></MemoryRouter>);
    expect(await screen.findByTestId('mkt-scope')).toHaveTextContent('2026-10-01 – 2026-10-31');
    expect(screen.getByTestId('mkt-redemptions-alltime')).toBeInTheDocument();
    expect(stateMock).toHaveBeenCalledWith({ preset: 'custom', from: '2026-10-01', to: '2026-10-31' });
  });
});
