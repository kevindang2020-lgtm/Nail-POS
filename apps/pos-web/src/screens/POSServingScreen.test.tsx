import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSServingScreen } from './POSServingScreen';

const servingState = {
  kpis: { servingNow: 0, activeTickets: 0, delayedServices: 0, nearingCompletion: 0, averageServiceDurationMinutes: 0, totalInServiceSalesCents: 0, techniciansInService: 0, servicesCompletedToday: 0, addOnAttachRatePercent: 0, addOnRevenueCents: 0, customerSatisfactionAvg: 0, onTimeCompletionPercent: 0 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] },
};
// Serving fetches both /pos/serving/state and /pos/technicians/state.
const mockByUrl = (map: Record<string, unknown>) => vi.fn(async (url: any) => {
  const u = String(url);
  for (const frag of Object.keys(map)) if (u.includes(frag)) return { ok: true, status: 200, json: async () => map[frag], headers: { get: () => null } } as any;
  return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
});
// Why this file used to HANG (no output until killed): React 18's dev-mode invokeGuardedCallback saves and restores
// `window.event` by ASSIGNING it, and under vitest's jsdom global that assignment sticks — after the first fireEvent the
// global `window.event` stays a stale 'change' Event for every later test. React reads window.event to pick an update's
// priority, so in the next test the Serving auto-select effect's setSelId never committed while its detail fetch kept
// re-firing: an endless fetch→setState microtask loop inside act that starved every timer (even the test timeout).
// Clear the stale value before each test so React sees "no current event", as a real browser does between events.
const clearStaleWindowEvent = () => { (window as any).event = undefined; };
beforeEach(() => { vi.restoreAllMocks(); clearStaleWindowEvent(); });
afterEach(() => { clearStaleWindowEvent(); });
// The heading, filters and the six panel titles render in the loading skeleton too — wait for the loaded board (the KPI
// row only exists once /pos/serving/state answered) before asserting on data or changing a data-driven filter.
const waitForLoaded = () => screen.findByTestId('serving-kpis');

describe('POSServingScreen', () => {
  // Extras Serving 04 (Nov 12 2026): the server's booking-conflict insight is worded in the cashier's language with its numbers + an Open action
  it('shows the booking-conflict insight from the server (name, minutes, remaining, count) with its Open action', async () => {
    const st = { ...servingState, insights: [{ id: 'booking_conflict', text: 'server words', sub: 'x', action: 'Open', route: '/booking', severity: 'warn', vars: { name: 'Mia', minutes: 10, remaining: 15, count: 1 } }] };
    globalThis.fetch = mockByUrl({ '/pos/serving': st, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await waitForLoaded();
    const box = screen.getByTestId('sv-insights');
    expect(box).toHaveTextContent('Mia has a booking in 10 min but needs about 15 min more (1 conflict(s))');
    expect(box).toHaveTextContent('Review the Booking board before the next guest arrives');
    expect(box).toHaveTextContent('Open');
  });
  it('mounts and renders the serving board + empty state', async () => {
    globalThis.fetch = mockByUrl({ '/pos/serving': servingState, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect(await screen.findByText('Serving')).toBeInTheDocument();
    await waitForLoaded();
    expect(screen.getByText('No active services.')).toBeInTheDocument();
  });

  it('renders Service Progress Board + AI Service Insights from tickets', async () => {
    const withTickets = {
      kpis: { servingNow: 2, activeTickets: 2, delayedServices: 1, nearingCompletion: 1, averageServiceDurationMinutes: 40, totalInServiceSalesCents: 12000, techniciansInService: 2, servicesCompletedToday: 5, addOnAttachRatePercent: 40, addOnRevenueCents: 3000, customerSatisfactionAvg: 4.7, onTimeCompletionPercent: 82 },
      tickets: { items: [
        { ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: true, serviceNames: ['Acrylic Full Set'], primaryTechnicianName: 'Mia', elapsedMinutes: 36, estimatedDurationMinutes: 30, subtotalCents: 9500, status: 'in_progress' },
        { ticketId: 't2', ticketNumber: 'A2', customerName: 'Olivia Brown', serviceNames: ['Gel X'], primaryTechnicianName: 'Leo', elapsedMinutes: 10, estimatedDurationMinutes: 45, subtotalCents: 6000, status: 'nearly_finished' },
      ], pagination: { totalItems: 2 } },
      filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] },
    };
    globalThis.fetch = mockByUrl({ '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect(await screen.findByText('Serving')).toBeInTheDocument();
    await waitForLoaded();
    expect(screen.getByText('Service Progress Board')).toBeInTheDocument();
    expect(screen.getByText('AI Service Insights')).toBeInTheDocument();
    expect(screen.getByText('Live Service Floor')).toBeInTheDocument();
    expect(screen.getByText('Active Services')).toBeInTheDocument();
    // T07 added modules
    expect(screen.getByText(/Technician Service Performance/)).toBeInTheDocument();
    expect(screen.getByText('Guest Service Details')).toBeInTheDocument();
    expect(screen.getByText('Service Mix')).toBeInTheDocument();
    expect(screen.getByText(/Completion Funnel/)).toBeInTheDocument();
    expect(screen.getByText('Potential Revenue in Progress')).toBeInTheDocument();
    expect(screen.getByText('Start Service')).toBeInTheDocument();
    expect(screen.getAllByText('Finishing Soon').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getAllByText('$30.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Customer Satisfaction')).toBeInTheDocument();
    expect(screen.getByText('4.7 / 5')).toBeInTheDocument();
    expect(screen.getByText('On-Time Completion')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('renders the P4 change-history timeline for the selected ticket from real revisions', async () => {
    const withTickets = {
      kpis: { servingNow: 1, activeTickets: 1, delayedServices: 0, nearingCompletion: 0, averageServiceDurationMinutes: 40, totalInServiceSalesCents: 6000, techniciansInService: 1, servicesCompletedToday: 0, addOnAttachRatePercent: 0, addOnRevenueCents: 0, customerSatisfactionAvg: 0, onTimeCompletionPercent: 0 },
      tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: true, serviceNames: ['Gel X'], primaryTechnicianName: 'Mia', elapsedMinutes: 10, estimatedDurationMinutes: 45, subtotalCents: 6000, status: 'in_progress' }], pagination: { totalItems: 1 } },
      filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] },
    };
    // the server says which moves THIS user may make (allowedActions); Send to Service Done is offered only when it is legal
    const detail = { ticketId: 't1', allowedActions: ['send_to_service_done'], customer: { fullName: 'Jessica Miller', phone: '555-0100', isVip: true }, services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000, status: 'in_service' }], subtotalCents: 6000, estimatedEndAt: null };
    const revData = { ticketId: 't1', currentVersion: 2, revisions: [
      { version: 1, action: 'service_added', summary: 'Added Gel X', actorRole: 'TECH', createdAt: '2026-06-01T00:30:00.000Z' },
      { version: 2, action: 'technician_assigned', summary: 'Assigned Mia', actorRole: 'MANAGER', createdAt: '2026-06-01T00:35:00.000Z' },
    ] };
    // ordered most-specific first so the revisions URL resolves before /pos/serving (state)
    globalThis.fetch = mockByUrl({
      '/pos/serving/tickets/t1/revisions': revData,
      '/pos/serving/tickets/t1': detail,
      '/pos/serving': withTickets,
      '/pos/technicians/state': { rows: { items: [] } },
    }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect(await screen.findByText('Change History')).toBeInTheDocument();
    expect(await screen.findByText('Service Added')).toBeInTheDocument();
    expect(screen.getByText('Added Gel X')).toBeInTheDocument();
    expect(screen.getByText('Technician Assigned')).toBeInTheDocument();
    // the Guest Service Details action that POSTs send-to-service-done says what it does (it read "Send Update")
    expect(screen.getByRole('button', { name: 'Send to Service Done' })).toBeEnabled();
  });
});

// ── 2026-07-03 restored surfaces: header search/service/delay filters (state existed but had no controls or a dead
// dropdown), the per-ticket Manage drawer (delay report/clear + helper — handlers were orphaned), and the
// Requested-Technician Change Approvals panel (fetched-but-unrendered). Lock the wiring.
import { fireEvent, within, waitFor } from '@testing-library/react';

const sTicket = (over: any = {}) => ({ ticketId: 'sv1', ticketNumber: 'S1', customerName: 'Jessica Miller', serviceNames: ['Gel Manicure'], stage: 'In Service', primaryTechnicianName: 'Mia', elapsedMinutes: 12, subtotalCents: 6500, status: 'in_service', startedAt: new Date().toISOString(), ...over });
const richServing = {
  kpis: { servingNow: 1, activeTickets: 1, delayedServices: 0, nearingCompletion: 0, averageServiceDurationMinutes: 30, totalInServiceSalesCents: 6500, techniciansInService: 1, servicesCompletedToday: 3, addOnAttachRatePercent: 0, addOnRevenueCents: 0, customerSatisfactionAvg: 4.8, onTimeCompletionPercent: 90 },
  tickets: { items: [sTicket()], pagination: { totalItems: 1 } },
  filters: { statuses: ['in_service', 'paused'], technicians: ['Mia'], serviceCategories: ['Manicure', 'Pedicure'], stations: [], delayStatuses: ['on_time', 'delayed'] },
};
const sRoster = { rows: { items: [{ technicianId: 't1', displayName: 'Mia Johnson' }, { technicianId: 't2', displayName: 'Leo Chen' }] } };

const recServing = (opts: { changeReqs?: any[] } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/change-requests/pending')) return ok(opts.changeReqs ?? []);
    if (u.includes('/pos/technicians/state')) return ok(sRoster);
    if (u.match(/\/pos\/serving\/tickets\/[^/?]+$/) && method === 'GET') return ok({ ticketId: 'sv1', customerName: 'Jessica Miller' });
    if (u.includes('/pos/serving/state')) return ok(richServing);
    return ok({ ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSServingScreen — header filters (were dead/missing)', () => {
  it('service filter populates from facets and refetches with serviceCategory=', async () => {
    const f = recServing(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Serving');
    await waitForLoaded();   // the facet options arrive with the state
    const sel = screen.getByLabelText('Service filter') as HTMLSelectElement;
    expect(within(sel).getByText('Pedicure')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'Pedicure' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/serving/state') && c.url.includes('serviceCategory=Pedicure'))).toBe(true));
  });

  it('search box refetches with search=', async () => {
    const f = recServing(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Serving');
    fireEvent.change(screen.getByLabelText('Search serving'), { target: { value: 'Mia' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/serving/state') && c.url.includes('search=Mia'))).toBe(true));
  });

  it('delay filter refetches with delayStatus=', async () => {
    const f = recServing(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Serving');
    await waitForLoaded();   // the 'delayed' option only exists once the facets loaded
    fireEvent.change(screen.getByLabelText('Delay filter'), { target: { value: 'delayed' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/serving/state') && c.url.includes('delayStatus=delayed'))).toBe(true));
  });
});

describe('POSServingScreen — per-ticket Manage drawer (was orphaned)', () => {
  it('opens the drawer; Report Delay requires a reason then hits the real endpoint', async () => {
    const f = recServing(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Serving');
    fireEvent.click(await screen.findByText('Manage'));
    const drawerRow = screen.getByText('Report Delay').closest('tr') as HTMLElement;
    expect(within(drawerRow).getByText('Clear Delay')).toBeInTheDocument();
    expect(within(drawerRow).getByText('Apply Helper')).toBeInTheDocument();
    // guarded
    fireEvent.click(within(drawerRow).getByText('Report Delay'));
    expect(await screen.findByText(/A delay reason is required/)).toBeInTheDocument();
    // with a reason → real endpoint
    fireEvent.change(within(drawerRow).getByPlaceholderText('Reason or note'), { target: { value: 'guest stepped out' } });
    fireEvent.click(within(drawerRow).getByText('Report Delay'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/serving/tickets/sv1/report-delay') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ reason: 'guest stepped out' });
    });
  });
});

describe('POSServingScreen — Requested-Technician Change Approvals (was unrendered)', () => {
  it('renders pending change requests and approve hits the decision endpoint', async () => {
    const f = recServing({ changeReqs: [{ requestId: 'cr1', customerName: 'Ann Lee', currentTechnicianName: 'Mia', requestedTechnicianName: 'Leo', reason: 'prefers Leo' }] });
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Serving');
    expect(await screen.findByText('Requested-Technician Change Approvals')).toBeInTheDocument();
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/serving/change-requests/cr1/decision') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ decision: 'approve' });
    });
  });
});
