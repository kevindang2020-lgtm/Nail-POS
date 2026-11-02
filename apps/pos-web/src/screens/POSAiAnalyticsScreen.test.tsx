import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { ovMock } = vi.hoisted(() => ({ ovMock: vi.fn() }));
vi.mock('../api/posAiCenterApi', () => ({ posAiCenterApi: { overview: ovMock } }));
import { POSAiAnalyticsScreen } from './POSAiAnalyticsScreen';
beforeEach(() => ovMock.mockReset());

const real = (value: number, unit?: string, estimated?: boolean) => ({ tracked: true, value, unit, source: 'src', estimated });
const untracked = (source: string) => ({ tracked: false, value: null, source });
const overview = {
  generatedAt: '2026-07-06T12:00:00Z',
  kpis: {
    aiCallsHandled: real(42), bookingsCapturedByAi: real(4), missedCallsRecovered: untracked('call feed unavailable'),
    aiConversationsToday: real(0), automationSuccessRate: real(98.1, '%'), customerSentiment: untracked('no reviews in window'),
    suggestedUpsellRevenueCents: real(132000, 'cents'), aiTimeSavedMinutes: real(246, 'min', true),
  },
  performance: { totalConversations: real(23), aiSuccessRatePct: real(97.4, '%') },
  callIntelligence: { callsHandled: real(42), recovered: untracked('call feed unavailable'), callToBookingRatePct: real(41, '%') },
  bookingAssistant: { completed: real(31), aiBookings: real(4), rebookings: real(6) },
  campaigns: { sent: real(1200), bookings: real(84), revenueCents: real(540000, 'cents'), conversionPct: real(7, '%') },
};

describe('POSAiAnalyticsScreen', () => {
  it('shows tracked KPIs with values and untracked as "Not tracked yet"', async () => {
    ovMock.mockResolvedValue(overview);
    render(<POSAiAnalyticsScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Analytics' })).toBeInTheDocument();
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getByText('$1,320.00')).toBeInTheDocument();        // upsell revenue cents
    expect(screen.getAllByText('Not tracked yet').length).toBeGreaterThan(0); // untracked metrics
    expect(screen.getByText('no reviews in window')).toBeInTheDocument();     // untracked source note
  });
  it('flags an estimated metric with an est. tag', async () => {
    ovMock.mockResolvedValue(overview);
    render(<POSAiAnalyticsScreen />);
    expect(await screen.findByText('est.')).toBeInTheDocument();      // aiTimeSavedMinutes estimated
    expect(screen.getByText(/246 min/)).toBeInTheDocument();
  });
});
