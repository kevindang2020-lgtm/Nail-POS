// POSAIReceptionistScreen.test — AI Receptionist guide (Oct 31 2026): the rebuilt page keeps the original composition (title,
// five cards, 8 setup steps, Connections, 7 Quick Actions, Recent Calls) and shows evidence, never "Connected" from a saved
// credential. Mocks the /pos/ai/receptionist-center client.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const step = (key: string, state: string) => ({ key, label: key, state, detail: `${key} detail`, route: null });
vi.mock('../api/posAiReceptionistCenterApi', () => ({
  posAiReceptionistCenterApi: {
    readiness: () => Promise.resolve({
      stage: 'configured', verifiedSteps: 1, progressPct: 13, checkedAt: '2026-10-31T12:00:00Z', control: null,
      steps: [step('business_setup', 'verified'), step('booking_rules', 'configured'), step('integration_key', 'incomplete'), step('voice_agent', 'blocked'),
        step('phone_number', 'configured'), step('write_tools', 'incomplete'), step('test_call', 'blocked'), step('go_live', 'incomplete')],
      connections: { twilio: 'configured_route_unverified', retell: 'not_configured', integrationKey: 'not_issued', booking: 'handoff_only' },
      checks: [],
    }),
    lastHealth: () => Promise.resolve(null),
    kpis: () => Promise.resolve({ window: { from: '2026-10-01', to: '2026-10-31' }, calls: 0, voiceMinutes: 0, avgDurationSeconds: null,
      booked: { confirmed: 0, requested: 0, pendingVerification: 0, ratePct: null }, handoffs: { requested: 0, completed: 0, failed: 0, ratePct: null }, abandoned: { count: 0, ratePct: null } }),
    calls: () => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
    search: () => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
    priority: () => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }),
    health: vi.fn(), call: vi.fn(), prepare: vi.fn(), decide: vi.fn(), control: vi.fn(), controlHistory: vi.fn(),
  },
}));

import { POSAIReceptionistScreen } from './POSAIReceptionistScreen';

describe('POSAIReceptionistScreen', () => {
  it('keeps the original layout and never shows a saved credential as connected', async () => {
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('rcp-step-go_live')).toBeInTheDocument());
    expect(screen.getByText('AI Receptionist')).toBeInTheDocument();
    for (const k of ['calls', 'booked', 'handoffs', 'abandoned', 'duration']) expect(screen.getByTestId(`rcp-kpi-${k}`)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^rcp-step-/)).toHaveLength(8);
    expect(screen.getByTestId('rcp-conn-twilio')).toHaveTextContent('Salon account OK — route not verified');
    expect(screen.getByTestId('rcp-conn-retell')).toHaveTextContent('Not configured');
    expect(screen.getByTestId('rcp-conn-booking')).toHaveTextContent('Handoff-only');
    expect(screen.queryByText(/^Connected$/)).toBeNull();
    expect(screen.getByTestId('rcp-quick').querySelectorAll('button')).toHaveLength(7);
    expect(screen.getByText(/No calls yet/)).toBeInTheDocument();
    expect(screen.getByTestId('rcp-kpi-booked')).toHaveTextContent('—');   // no fabricated rate with zero calls
  });
});
