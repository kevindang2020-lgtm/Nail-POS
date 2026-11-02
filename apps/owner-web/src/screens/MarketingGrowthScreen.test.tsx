// MarketingGrowthScreen (owner, read-only): campaign KPIs (active/revenue/ROI), open/click/conversion rates, referral
// count, channel breakdown, and a top-campaigns list with per-campaign rates. Verifies KPI rendering, the channel rows,
// a campaign card, and the empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerMarketingApi: { overview: vi.fn() } }));
vi.mock('./OwnerDealsCard', () => ({ OwnerDealsCard: () => null }));

import { ownerMarketingApi } from '../api/ownerApi';
import { MarketingGrowthScreen } from './MarketingGrowthScreen';

const overview = (over: any = {}) => ({
  kpis: { activeCampaigns: 3, totalCampaigns: 14, totalSent: 8200, openRatePercent: 41.2, clickRatePercent: 9.6, conversionRatePercent: 5.1, campaignRevenueCents: 1860000, campaignCostCents: 240000, roi: 7.8, referrals: 96 },
  channels: [{ channel: 'sms', campaigns: 8, sent: 6000, revenueCents: 1400000 }, { channel: 'email', campaigns: 6, sent: 2200, revenueCents: 460000 }],
  topCampaigns: [{ id: 'c1', name: 'Spring Gel Promo', channel: 'sms', status: 'completed', audienceLabel: 'VIPs', sent: 1200, openRate: 52, clickRate: 14, bookingRate: 8, revenueCents: 540000, costCents: 40000, roi: 13.5, scheduledAt: null }],
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerMarketingApi.overview as any).mockResolvedValue(overview()); });

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('MarketingGrowthScreen', () => {
  it('renders the campaign KPIs and rates', async () => {
    render(<MarketingGrowthScreen />);
    await waitFor(() => expect(screen.getByText('Active Campaigns')).toBeInTheDocument());
    expect(card('Active Campaigns')).toHaveTextContent('3');
    expect(card('Revenue')).toHaveTextContent('$18,600');
    expect(card('ROI')).toHaveTextContent('7.8×');
    expect(card('Open Rate')).toHaveTextContent('41.2%');
    expect(card('Referral Codes')).toHaveTextContent('96');
  });

  it('renders the channel breakdown', async () => {
    render(<MarketingGrowthScreen />);
    await waitFor(() => expect(screen.getByText('SMS')).toBeInTheDocument());
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText(/8 campaigns · 6,000 sent/)).toBeInTheDocument();
  });

  it('renders a top campaign card with its rates and status', async () => {
    render(<MarketingGrowthScreen />);
    await waitFor(() => expect(screen.getByText('Spring Gel Promo')).toBeInTheDocument());
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText(/SMS · VIPs · 1,200 sent/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no campaigns', async () => {
    (ownerMarketingApi.overview as any).mockResolvedValue(overview({ topCampaigns: [] }));
    render(<MarketingGrowthScreen />);
    await waitFor(() => expect(screen.getByText('No campaigns yet.')).toBeInTheDocument());
  });
});
