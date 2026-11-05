import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const overview = {
  frontDeskStatus: 'setup', writeToolsEnabled: false, keyIssued: false,
  providers: { voiceAgent: 'not_connected', telephony: 'not_connected' },
  analytics: { totalCalls: 0, booked: 0, bookingRatePct: null, handoffs: 0, handoffRatePct: null, abandoned: 0, abandonmentRatePct: null, avgDurationSeconds: null, topIntents: [] },
  checklist: [
    { key: 'business_setup', label: 'Confirm business hours & services', state: 'done', detail: 'Store hours are configured.' },
    { key: 'voice_agent', label: 'Create the voice agent', state: 'action_needed', detail: 'Connect a Retell account.' },
  ],
  setupProgressPct: 50,
};

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistOverview: vi.fn(() => Promise.resolve(overview)),
    receptionistCalls: vi.fn(() => Promise.resolve([])),
  },
}));

import { POSAIReceptionistScreen } from './POSAIReceptionistScreen';

describe('POSAIReceptionistScreen', () => {
  it('renders real overview data with honest not-connected providers and the setup checklist', async () => {
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('AI Receptionist')).toBeInTheDocument());
    // status badge + honest provider states
    expect(screen.getByText('Setup')).toBeInTheDocument();
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(2);
    // checklist reflects real config
    expect(screen.getByText('Confirm business hours & services')).toBeInTheDocument();
    expect(screen.getByText('Create the voice agent')).toBeInTheDocument();
    // honest empty state for calls
    expect(screen.getByText(/No calls yet/)).toBeInTheDocument();
    // rates render as em-dash with zero calls (no fabricated 100%)
    expect(screen.getAllByText('\u2014').length).toBeGreaterThan(0);
  });
});
