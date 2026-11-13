// POSAIReceptionistScreen.test — AI Receptionist guide (Oct 31 2026): the rebuilt page keeps the original composition (title,
// five cards, 8 setup steps, Connections, 7 Quick Actions, Recent Calls) and shows evidence, never "Connected" from a saved
// credential. Mocks the /pos/ai/receptionist-center client.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const callsFn = vi.fn((_q: any) => Promise.resolve({ agents: [{ ref: 'agent_rose', name: 'Rose front desk' }], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
  items: [{ id: 'v1', callRef: 'CA123', startedAt: '2026-11-06T15:00:00Z', callerMasked: '•••• 7711', dialedMasked: '•••• 0100', direction: 'inbound', identity: 'caller_only', status: 'missed', bookingOutcome: null, handoffOutcome: null, durationSeconds: 5 }] }));
const KPI0 = { window: { from: '2026-10-01', to: '2026-10-31' }, calls: 0, voiceMinutes: 0, avgDurationSeconds: null,
  booked: { confirmed: 0, requested: 0, pendingVerification: 0, ratePct: null }, handoffs: { requested: 0, completed: 0, failed: 0, ratePct: null }, abandoned: { count: 0, ratePct: null } };
const kpisFn = vi.fn((_q: any): Promise<any> => Promise.resolve(KPI0));
const step = (key: string, state: string) => ({ key, label: key, state, detail: `${key} detail`, route: null });
vi.mock('../api/posAiReceptionistCenterApi', () => ({
  posAiReceptionistCenterApi: {
    readiness: () => Promise.resolve({
      stage: 'configured', verifiedSteps: 1, progressPct: 13, checkedAt: '2026-10-31T12:00:00Z', control: null,
      steps: [step('business_setup', 'verified'), step('booking_rules', 'configured'), step('integration_key', 'incomplete'), step('voice_agent', 'blocked'),
        step('phone_number', 'configured'), step('write_tools', 'incomplete'), step('test_call', 'blocked'), step('go_live', 'incomplete')],
      connections: { twilio: 'configured_route_unverified', retell: 'not_configured', integrationKey: 'not_issued', booking: 'handoff_only' },
      checks: [],
      capabilities: [
        { key: 'services', tool: 'get_services', configured: true, tested: true, lastTestedAt: '2026-11-01T15:00:00Z', active: false, allowed: true },
        { key: 'booking', tool: 'create_appointment', configured: false, tested: false, lastTestedAt: null, active: false, allowed: true },
        { key: 'sms', tool: null, configured: true, tested: null, lastTestedAt: null, active: false, allowed: null },
      ],
    }),
    lastHealth: () => Promise.resolve(null),
    kpis: (q: any) => kpisFn(q),
    calls: (q: any) => callsFn(q),
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
    expect(screen.getByTestId('rcp-kpi-booked')).toHaveTextContent('—');   // no fabricated rate with zero calls
  });

  it('A15 / A10 Nov 6: missed status, number-called column, agent / length filters, filters read from and kept in the address, live note', async () => {
    window.history.replaceState(null, '', '/tenant/ai/receptionist?rpstatus=missed&rplen=short&rpq=7711');
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    await waitFor(() => expect(callsFn).toHaveBeenCalledWith(expect.objectContaining({ status: 'missed', minSeconds: undefined, maxSeconds: 59, q: '7711' })));
    expect(await screen.findByTestId('rcp-state-missed')).toHaveTextContent('Missed');
    expect(screen.getByText('•••• 0100')).toBeInTheDocument();
    expect(screen.getByTestId('rcp-live')).toHaveTextContent('every 30 s');
    fireEvent.change(await screen.findByTestId('rcp-f-agent'), { target: { value: 'agent_rose' } });
    await waitFor(() => expect(callsFn).toHaveBeenLastCalledWith(expect.objectContaining({ agent: 'agent_rose', page: 1 })));
    expect(window.location.search).toContain('rpagent=agent_rose');
    expect(window.location.search).toContain('rpstatus=missed');
    window.history.replaceState(null, '', '/');
  });

  it('extras AI Receptionist 04: the capability matrix shows the server\'s four facts per capability; unknown is "—", never a green light', async () => {
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('rcp-capabilities-open'));
    const rows = await screen.findAllByTestId('rcp-cap-row');
    expect(rows.map((r) => r.getAttribute('data-cap'))).toEqual(['services', 'booking', 'sms']);
    const cells = (i: number, id: string) => rows[i]!.querySelector(`[data-testid="${id}"]`)!.textContent;
    expect(rows[0]).toHaveTextContent('Services');
    expect(cells(0, 'rcp-cap-tested')).toMatch(/^Yes · last /);
    expect(cells(0, 'rcp-cap-active')).toBe('No');
    expect(cells(1, 'rcp-cap-configured')).toBe('No'); expect(cells(1, 'rcp-cap-tested')).toBe('Not yet');
    expect(cells(2, 'rcp-cap-tested')).toBe('—'); expect(cells(2, 'rcp-cap-allowed')).toBe('—');
    expect(screen.getByTestId('rcp-capabilities')).toHaveTextContent('a saved setting is never a test');
  });

  it('Extras AI Receptionist 08: call insights show the server\'s counts — question categories marked AI-derived, services booked, no caller data', async () => {
    kpisFn.mockImplementation(() => Promise.resolve({ ...KPI0, calls: 4, insights: {
      questionCategories: [{ label: 'call me at [number]', count: 2 }, { label: 'check_availability', count: 2 }], callsWithCategories: 3,
      serviceInterests: [{ label: 'Gel manicure', count: 2 }], sources: { questionCategories: 'ai_derived', serviceInterests: 'recorded' } } }));
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    const box = await screen.findByTestId('rcp-insights');
    expect(screen.getByTestId('rcp-ins-ai-label')).toHaveTextContent('AI-derived labels');
    expect(screen.getByTestId('rcp-ins-questions').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('rcp-ins-questions')).toHaveTextContent('Check availability');
    expect(screen.getByTestId('rcp-ins-services')).toHaveTextContent('Gel manicure · 2');
    expect(box).toHaveTextContent('Topics the voice AI tagged on 3 call(s) in this period');
    kpisFn.mockImplementation(() => Promise.resolve(KPI0));
  });
  it('Extras AI Receptionist 08: empty insights say so; no insights from the server → no card', async () => {
    kpisFn.mockImplementation(() => Promise.resolve({ ...KPI0, insights: { questionCategories: [], callsWithCategories: 0, serviceInterests: [], sources: {} } }));
    const { unmount } = render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    expect(await screen.findByTestId('rcp-ins-questions-none')).toHaveTextContent('Nothing recorded in this period.');
    expect(screen.getByTestId('rcp-ins-services-none')).toBeInTheDocument();
    unmount();
    kpisFn.mockImplementation(() => Promise.resolve(KPI0));
    render(<MemoryRouter><POSAIReceptionistScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('rcp-kpi-calls')).toHaveTextContent('0'));
    expect(screen.queryByTestId('rcp-insights')).toBeNull();
  });
});
