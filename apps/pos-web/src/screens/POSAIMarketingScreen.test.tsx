import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { mkMock } = vi.hoisted(() => ({ mkMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { state: mkMock, previewAudience: vi.fn() } }));
import { POSAIMarketingScreen } from './POSAIMarketingScreen';
beforeEach(() => mkMock.mockReset());

const summary = {
  activeCampaigns: 2, scheduledCampaigns: 1, draftCampaigns: 3, completedCampaigns: 5,
  messagesSent: 806, bookingsAttributed: 41, revenueAssociatedCents: 348000, messageCostCents: 4030,
  costPerBookingCents: 98, suppressedContacts: 12, optedInSms: 300, optedInEmail: 210,
  generatedAt: '2026-07-07T00:00:00Z',
};

describe('POSAIMarketingScreen', () => {
  it('renders Command Center KPIs and recommendation cards', async () => {
    mkMock.mockResolvedValue({
      summary,
      recommendations: [
        {
          type: 'rebooking', title: 'Rebook customers due for their next visit', goal: 'Bring back customers.',
          evidence: '60 consented customers completed a visit outside the rebooking window.', audienceEstimate: 60,
          suppressedEstimate: 8, branchScope: 'tenant', suggestedChannel: 'sms', requiresOffer: false, offer: null,
          risks: ['Do not use "overdue" wording unless approved.'], confidence: 'medium', supportingMetric: 'x',
        },
        {
          type: 'inactive_customer', title: 'Re-engage customers inactive for 90+ days', goal: 'Win back.',
          evidence: '45 consented customers have no visit in 90 days.', audienceEstimate: 45, suppressedEstimate: 5,
          branchScope: 'tenant', suggestedChannel: 'sms', requiresOffer: true, offer: null, risks: [],
          confidence: 'medium', supportingMetric: 'x',
        },
      ],
      freshness: { generatedAt: '2026-07-07T00:00:00Z', source: 'live_read_model' },
    });
    render(<POSAIMarketingScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Marketing Assistant' })).toBeInTheDocument();
    expect(screen.getByText('Associated Rev')).toBeInTheDocument();   // Sep 2026 redesign: shortened KPI label (the 'associated with' note below still explains it)
    expect(screen.getByText('$3,480.00')).toBeInTheDocument();
    expect(screen.getByText('$0.98')).toBeInTheDocument(); // cost per booking
    expect(screen.getByText(/Rebook customers due/i)).toBeInTheDocument();
    expect(screen.getByText('Needs approved offer')).toBeInTheDocument(); // only the inactive rec requires an offer
  });

  it('renders em-dash for cost/booking when there are no bookings', async () => {
    mkMock.mockResolvedValue({
      summary: { ...summary, bookingsAttributed: 0, costPerBookingCents: null },
      recommendations: [],
      freshness: { generatedAt: '2026-07-07T00:00:00Z', source: 'live_read_model' },
    });
    render(<POSAIMarketingScreen />);
    expect(await screen.findByText('Cost / Booking')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/No campaign opportunities right now/i)).toBeInTheDocument();
  });
});
