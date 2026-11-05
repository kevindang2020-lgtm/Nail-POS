// AiCenterScreen (owner, read-only): delegates to the AI Center overview and renders metrics honestly — tracked values
// shown, untracked shown as "—" with a "not tracked yet" note. Verifies tracked KPI rendering, the untracked "—"
// treatment, the call-intelligence card, and the capabilities (tracked/not-tracked) list.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerAiCenterApi: { overview: vi.fn() } }));

import { ownerAiCenterApi } from '../api/ownerApi';
import { AiCenterScreen } from './AiCenterScreen';

const tracked = (value: number, unit?: string) => ({ tracked: true, value, unit, source: 's' });
const untracked = () => ({ tracked: false, value: null, source: 's' });

const overview = (over: any = {}) => ({
  generatedAt: '2026-06-27T15:00:00.000Z',
  kpis: {
    aiCallsHandled: tracked(128), bookingsCapturedByAi: tracked(54), missedCallsRecovered: tracked(19),
    aiConversationsToday: tracked(7), automationSuccessRate: tracked(96, '%'), customerSentiment: untracked(),
  },
  sections: [{ key: 'call', title: 'Call Intelligence', tracked: true }, { key: 'voice', title: 'Voice Cloning', tracked: false, needs: 'voice telemetry' }],
  activity: [{ at: '2026-06-27T14:00:00.000Z', assistant: 'Receptionist', action: 'Booked appointment', status: 'success' }],
  callIntelligence: { callsHandled: tracked(128), recovered: tracked(19), callToBookingRatePct: tracked(42, '%') },
  bookingAssistant: { completed: tracked(310), aiBookings: tracked(54), rebookings: tracked(22) },
  automation: { sentToday: tracked(80), successRatePct: tracked(96, '%') },
  live: { appointmentsToday: tracked(40), aiBookingsToday: tracked(6), aiConversationsToday: tracked(7), customerSentiment: untracked(), assistantsActive: tracked(3) },
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerAiCenterApi.overview as any).mockResolvedValue(overview()); });

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('AiCenterScreen', () => {
  it('renders tracked KPIs with their values', async () => {
    render(<AiCenterScreen />);
    await waitFor(() => expect(screen.getByText('AI Calls Handled')).toBeInTheDocument());
    expect(card('AI Calls Handled')).toHaveTextContent('128');
    expect(card('Bookings by AI')).toHaveTextContent('54');
    expect(card('Automation Success')).toHaveTextContent('96%');
  });

  it('renders untracked metrics as "—" with a not-tracked note', async () => {
    render(<AiCenterScreen />);
    await waitFor(() => expect(screen.getByText('Sentiment')).toBeInTheDocument());
    const sentiment = card('Sentiment');
    expect(sentiment).toHaveTextContent('—');
    expect(sentiment).toHaveTextContent(/not tracked yet/i);
  });

  it('renders the capabilities list with tracked vs not-tracked', async () => {
    render(<AiCenterScreen />);
    await waitFor(() => expect(screen.getByText('Voice Cloning')).toBeInTheDocument());
    expect(screen.getByText(/needs: voice telemetry/)).toBeInTheDocument();
    expect(screen.getByText('Not tracked')).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(1);
  });

  it('renders recent AI activity', async () => {
    render(<AiCenterScreen />);
    await waitFor(() => expect(screen.getByText('Receptionist')).toBeInTheDocument());
    expect(screen.getByText(/Booked appointment/)).toBeInTheDocument();
  });
});
