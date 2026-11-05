import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { stateMock, resultsMock } = vi.hoisted(() => ({ stateMock: vi.fn(), resultsMock: vi.fn() }));
vi.mock('../api/posCampaignsApi', () => ({ posCampaignsApi: { getState: stateMock } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { campaignResults: resultsMock, state: vi.fn(), previewAudience: vi.fn(), generateDraft: vi.fn() } }));
import { POSAICampaignResultsScreen } from './POSAICampaignResultsScreen';
beforeEach(() => { stateMock.mockReset(); resultsMock.mockReset(); });

describe('POSAICampaignResultsScreen', () => {
  it('lists campaigns and shows results on selection with associated-revenue labeling', async () => {
    stateMock.mockResolvedValue({ campaigns: [{ id: 'c1', name: 'Gel rebooking', status: 'completed', channel: 'sms' }] });
    resultsMock.mockResolvedValue({
      campaignId: 'c1', name: 'Gel rebooking', status: 'completed', channel: 'sms', audienceSize: 800,
      funnel: { sent: 780, opened: 0, clicked: 96, booked: 41 },
      rates: { openRate: null, clickRate: 96 / 780, bookingRate: 41 / 780 },
      costCents: 3900, associatedRevenueCents: 348000, costPerBookingCents: 95, revenuePerSentCents: 446,
      disclaimer: 'Revenue shown is associated with customers who booked through this campaign (correlation), not a proven causal effect.',
      generatedAt: 'now',
    });
    render(<POSAICampaignResultsScreen />);
    fireEvent.click(await screen.findByText('Gel rebooking'));
    expect(await screen.findByText('Assoc. Revenue')).toBeInTheDocument();
    expect(screen.getByText('$3,480.00')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // open rate null → em-dash
    expect(screen.getAllByText(/correlation/i).length).toBeGreaterThan(0);
    expect(resultsMock).toHaveBeenCalledWith('c1');
  });

  it('shows an empty state when there are no campaigns', async () => {
    stateMock.mockResolvedValue({ campaigns: [] });
    render(<POSAICampaignResultsScreen />);
    expect(await screen.findByText(/No campaigns yet/i)).toBeInTheDocument();
  });
});
