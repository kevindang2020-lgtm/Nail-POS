import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCampaignCenterScreen } from './POSCampaignCenterScreen';

// The screen reads /pos/campaigns/state via posCampaignsApi; mock it to return a representative Campaign Center payload
// (matching the server's derived-metric shape) and assert the KPI strip + performance table render real values.
vi.mock('../api/posCampaignsApi', () => ({
  posCampaignsApi: {
    getState: vi.fn().mockResolvedValue({
      kpis: { totalCampaigns: 2, activeCampaigns: 1, totalSent: 5680, campaignRevenueCents: 816800, avgRoi: 4.8, avgOpenRate: 42.5 },
      campaigns: [
        { id: 'c1', name: 'Spring Into Glow', offer: '20% Off Gel Mani', channel: 'sms', audienceLabel: 'Lapsed', audienceSize: 2842, status: 'completed', sentCount: 2842, openRate: 48.2, clickRate: 12.6, replyRate: 8.3, bookingCount: 142, revenueCents: 425600, roi: 5.1 },
        { id: 'c2', name: 'VIP Rebooking', offer: 'Book Again & Save', channel: 'email', audienceLabel: 'VIP', audienceSize: 3124, status: 'in_progress', sentCount: 2838, openRate: 36.7, clickRate: 9.4, replyRate: 6.1, bookingCount: 126, revenueCents: 391200, roi: 4.6 },
      ],
      pagination: { page: 1, pageSize: 50, totalItems: 2, totalPages: 1 },
    }),
    create: vi.fn(), schedule: vi.fn(), activate: vi.fn(), complete: vi.fn(), cancel: vi.fn(),
  },
}));

describe('POSCampaignCenterScreen', () => {
  it('renders KPI strip + campaign performance rows from real state', async () => {
    render(<MemoryRouter><POSCampaignCenterScreen /></MemoryRouter>);

    // KPI strip (derived server-side)
    expect(await screen.findByText('Campaign Revenue')).toBeInTheDocument();
    expect(screen.getByText('$8,168.00')).toBeInTheDocument();
    expect(screen.getByText('4.8x')).toBeInTheDocument();

    // performance table rows + derived metrics
    expect(screen.getAllByText('Spring Into Glow').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('48.2%')).toBeInTheDocument();
    expect(screen.getByText('5.1x')).toBeInTheDocument();

    // lifecycle action available on the in-progress campaign ("Complete" button is unique vs the "Completed" filter option)
    expect(screen.getByText('Complete')).toBeInTheDocument();
    // status badges reflect the lifecycle (also present as filter options, so allow multiple)
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Growth Funnel')).toBeInTheDocument();
    expect(screen.getByText(/Channel Mix/)).toBeInTheDocument();
    expect(screen.getByText('Revenue by Campaign')).toBeInTheDocument();
    expect(screen.getByText('Loyalty & Rewards')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });
});
