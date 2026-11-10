import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
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
    render(<MemoryRouter><POSAiAnalyticsScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'AI Analytics' })).toBeInTheDocument();
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getByText('$1,320.00')).toBeInTheDocument();        // upsell revenue cents
    expect(screen.getAllByText('Not tracked yet').length).toBeGreaterThan(0); // untracked metrics
    expect(screen.getByText('no reviews in window')).toBeInTheDocument();     // untracked source note
  });
  it('flags an estimated metric with an est. tag', async () => {
    ovMock.mockResolvedValue(overview);
    render(<MemoryRouter><POSAiAnalyticsScreen /></MemoryRouter>);
    expect(await screen.findByText('est.')).toBeInTheDocument();      // aiTimeSavedMinutes estimated
    expect(screen.getByText(/246 min/)).toBeInTheDocument();
  });
});

describe('POSAiAnalyticsScreen — period (batch 9 guide 14, Nov 10 2026)', () => {
  it('today by default; a preset asks the server for that window and the caption + 7-day panel name it', async () => {
    const ov = ovMock;
    ov.mockResolvedValue({ ...overview, window: { from: '2026-11-01', to: '2026-11-10', timezone: 'America/New_York', weekFrom: '2026-11-04' } });
    render(<MemoryRouter initialEntries={['/tenant/reports/ai?preset=month']}><POSAiAnalyticsScreen /></MemoryRouter>);
    await waitFor(() => expect(ov).toHaveBeenCalledWith({ preset: 'month' }));
    expect(await screen.findByTestId('ai-caption')).toHaveTextContent('2026-11-01 – 2026-11-10');
    expect(screen.getByTestId('ai-week')).toHaveTextContent('from 2026-11-04');
  });
});
