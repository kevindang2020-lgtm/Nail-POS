// POSAIFrontDeskScreen.test — AI Front Desk guide (Oct 31 2026): the rebuilt directory over /pos/ai/front-desk/*.
// Honest empty state, real agents with evidence-based state (never a fake "Active"), Create Agent saves a draft through the
// API, and a live agent's overlay offers Pause but never Edit; activation is owner-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const page = (items: any[]) => ({ items, pagination: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 }, filters: { window: null }, route: { stage: 'configured' } });
const draft = { id: 'a1', name: 'Main Front Desk', description: 'Main line', status: 'draft', effective: 'draft', branchName: null, providerRef: null, providerLinked: false, bookingMode: 'handoff_only', configVersion: 1, wizardStep: 2, updatedAt: '2026-10-31T10:00:00Z' };
const live = { ...draft, id: 'a2', name: 'Live Desk', status: 'live', effective: 'degraded', providerRef: '…abc123', providerLinked: true };
let rows: any[] = [];
const create = vi.fn((_b?: any) => Promise.resolve({ agent: { ...draft, id: 'new1', name: 'After-Hours Agent' }, replayed: false }));
const role = { value: 'OWNER' };
const drift: { value: any } = { value: undefined };

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: role.value, permissions: ['ai.use', 'ai.manage'] } }) }));
vi.mock('../api/posAiApi', () => ({ posAiApi: { provisionReceptionistAgent: vi.fn(), receptionistProvisioningJob: vi.fn() } }));
const fdCalls = vi.fn((_q: any) => Promise.resolve({ items: [{ providerCallId: 'call_abc', callRef: 'call_abc…', at: '2026-11-06T15:00:00Z', durationSeconds: 120, booking: null, handoff: null, error: null, abandoned: false }],
  avgDurationSeconds: 120, pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } }));
vi.mock('../api/posAiFrontDeskApi', () => ({
  posAiFrontDeskApi: {
    agents: vi.fn(() => Promise.resolve(page(rows))),
    summary: vi.fn(() => Promise.resolve({ counts: { total: rows.length, draft: 1, setupRequired: 0, ready: 0, active: 0, degraded: rows.some((r) => r.status === 'live') ? 1 : 0, paused: 0, archived: 0 }, route: { stage: 'configured' } })),
    monitor: vi.fn(() => Promise.resolve({ providerRoute: { state: 'DISABLED', liveAgent: null, drift: false, routedAt: null, routedAgentRef: null }, agentHealth: { state: 'UNKNOWN', calls24h: 0, failed24h: 0 }, callSuccess: { answered24h: 0, abandoned24h: 0, handoffs24h: 0 }, bookingActions: { succeeded24h: 0, refusedOrFailed24h: 0, armed: false }, fallback: { state: 'DISABLED' }, subscription: { state: 'READY' } })),
    events: vi.fn(() => Promise.resolve({ items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } })),
    create: (b: any) => create(b),
    calls: (_id: string, q: any) => fdCalls(q),
    wizard: vi.fn(() => Promise.resolve({ agent: { ...draft, id: 'new1', name: 'After-Hours Agent' }, config: { name: 'After-Hours Agent' }, steps: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ step: n, key: ['identity', 'knowledge', 'conversation', 'booking', 'retell', 'twilio', 'review', 'activate'][n - 1], done: n === 1 })) })),
    detail: vi.fn(() => Promise.resolve({ overview: live, business: { core: [], versions: 1, drift: drift.value }, voice: {}, routing: { rollbackTo: null }, booking: { mode: 'handoff_only' }, usage: { entitlement: 'READY' }, health: { last: null, recentErrors: [] } })),
  },
}));

import { POSAIFrontDeskScreen } from './POSAIFrontDeskScreen';

describe('POSAIFrontDeskScreen', () => {
  beforeEach(() => { rows = []; role.value = 'OWNER'; create.mockClear(); });
  it('UI-04 an empty salon shows the honest "No agents yet" with Create Agent', async () => {
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('No agents yet')).toBeInTheDocument());
    expect(screen.getAllByText(/Create Agent/).length).toBeGreaterThan(0);
  });
  it('lists real agents with their evidence-based state — a live agent without route proof is "Degraded", never "Active"', async () => {
    rows = [draft, live];
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live Desk')).toBeInTheDocument());
    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Active').filter((el) => el.getAttribute('role') !== 'tab')).toHaveLength(0);   // the 'Active' FILTER TAB is not an agent state
  });
  it('Create Agent saves a draft through the API with a request key', async () => {
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('fd-create')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('fd-create'));
    fireEvent.change(screen.getByTestId('fd-create-name'), { target: { value: 'After-Hours Agent' } });
    fireEvent.click(screen.getByTestId('fd-create-save'));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'After-Hours Agent', idempotencyKey: expect.any(String) })));
  });
  it('a live agent opens with Pause but no Edit; a manager sees no Activate', async () => {
    rows = [live]; role.value = 'MANAGER';
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('fd-row-a2'));
    await waitFor(() => expect(screen.getByTestId('fd-ov-pause')).toBeInTheDocument());
    expect(screen.queryByTestId('fd-ov-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fd-ov-activate')).not.toBeInTheDocument();
  });
  it('A14 Nov 6: the Calls tab searches the agent’s calls on the server and shows the average call length', async () => {
    rows = [live];
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('fd-row-a2'));
    fireEvent.click(await screen.findByTestId('fd-ov-tab-calls'));
    expect(await screen.findByTestId('fd-calls-avg')).toHaveTextContent('120s');
    fireEvent.change(screen.getByTestId('fd-calls-q'), { target: { value: '6095554411' } });
    await waitFor(() => expect(fdCalls).toHaveBeenLastCalledWith(expect.objectContaining({ q: '6095554411', page: 1 })));
    expect(screen.getByTestId('fd-call-open')).toBeInTheDocument();
  });
  it('Extras · AI Front Desk 08: choosing a window asks the server for it and shows this window vs the one before, with the basis', async () => {
    rows = [live];
    fdCalls.mockImplementation((q: any) => Promise.resolve({ items: [], avgDurationSeconds: null, pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
      performance: q.period === 'week' ? { from: '2026-11-09', to: '2026-11-12', timeZone: 'America/New_York', previousFrom: '2026-11-05', previousTo: '2026-11-08',
        current: { calls: 3, answered: 2, confirmedBookings: 1, handoffs: 1, failed: 0, bookingRatePercent: 33.3 }, previous: { calls: 0, answered: 0, confirmedBookings: 0, handoffs: 0, failed: 0, bookingRatePercent: null } } : null }) as any);
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('fd-row-a2'));
    fireEvent.click(await screen.findByTestId('fd-ov-tab-calls'));
    await waitFor(() => expect(fdCalls).toHaveBeenLastCalledWith(expect.objectContaining({ period: undefined })));
    expect(screen.queryByTestId('fd-perf')).toBeNull();                                   // no window → no comparison
    fireEvent.change(screen.getByTestId('fd-calls-period'), { target: { value: 'week' } });
    await waitFor(() => expect(fdCalls).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'week', page: 1 })));
    const perf = await screen.findByTestId('fd-perf');
    expect(perf).toHaveTextContent('2026-11-09 – 2026-11-12'); expect(perf).toHaveTextContent('2026-11-05 – 2026-11-08');
    expect(screen.getByTestId('fd-perf-booked')).toHaveTextContent(/Confirmed bookings\s*1\s*0/);
    expect(screen.getByTestId('fd-perf-rate')).toHaveTextContent('33.3%'); expect(screen.getByTestId('fd-perf-rate')).toHaveTextContent('—');
    expect(perf).toHaveTextContent('America/New_York');
  });
  it('Extras · AI Front Desk 06: the Business tab lists the server\'s knowledge-drift findings and when each live source last changed', async () => {
    rows = [live];
    drift.value = { status: 'DRIFT', savedAt: '2026-11-01T14:00:00Z', errorCode: null,
      findings: [{ kind: 'hours_time_mismatch', field: 'greeting', value: '8 PM' }, { kind: 'service_price_mismatch', field: 'greeting', value: '$35', service: 'Gel Manicure', currentPriceCents: 4000 },
        { kind: 'service_not_offered', field: 'behavior', value: 'Paraffin Dip' }, { kind: 'booking_not_armed' }],
      sources: [{ source: 'hours', changedAt: '2026-11-05T14:00:00Z', changedSinceAgentSaved: true }, { source: 'services', changedAt: '2026-10-01T14:00:00Z', changedSinceAgentSaved: false },
        { source: 'closures', changedAt: null, changedSinceAgentSaved: false }, { source: 'faqs', changedAt: null, changedSinceAgentSaved: false }] };
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('fd-row-a2'));
    fireEvent.click(await screen.findByTestId('fd-ov-tab-business'));
    const box = await screen.findByTestId('fd-drift');
    expect(box).toHaveTextContent('Needs review');
    const items = screen.getByTestId('fd-drift-findings').querySelectorAll('li');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Greeting says “8 PM”, which is not an opening or closing time');
    expect(items[1]).toHaveTextContent('Greeting quotes $35 for Gel Manicure; the current price is $40.00.');
    expect(items[2]).toHaveTextContent('Behavior mentions “Paraffin Dip”');
    expect(items[3]).toHaveTextContent('booking actions are off');
    expect(screen.getByTestId('fd-drift-src-hours')).toHaveTextContent('after this agent was saved');
    expect(screen.getByTestId('fd-drift-src-services')).not.toHaveTextContent('after this agent was saved');
    expect(screen.getByTestId('fd-drift-src-faqs')).toHaveTextContent('No change recorded');
    drift.value = undefined;
  });
});
