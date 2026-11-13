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
  // Extras Serving 04 (round 10): missing confirmations + a written severity label on every insight (not colour alone)
  it('shows the unconfirmed-bookings insight with its severity label; an info insight says Info', async () => {
    const st = { ...servingState, insights: [
      { id: 'unconfirmed', text: 'server words', action: 'Open', route: '/booking', severity: 'warn', vars: { count: 2, minutes: 25 } },
      { id: 'ready', text: 'server words', action: 'Open', route: '/service-done', severity: 'info', vars: { count: 1 } }] };
    globalThis.fetch = mockByUrl({ '/pos/serving': st, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await waitForLoaded();
    const box = screen.getByTestId('sv-insights');
    expect(box).toHaveTextContent('2 booking(s) in the next 2 hours not confirmed (first in 25 min)');
    expect(box).toHaveTextContent('nothing is sent automatically');
    expect(screen.getByTestId('sv-insight-sev-unconfirmed')).toHaveTextContent('Warning');
    expect(screen.getByTestId('sv-insight-sev-ready')).toHaveTextContent('Info');
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

  it('extras Serving 06 (round 10): a service line opens the ownership inspector — performer, kind, progress and ONLY that line\'s history; no money / payroll figures', async () => {
    const withTickets = { kpis: {}, tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceNames: ['Gel X'], elapsedMinutes: 10, subtotalCents: 6000, status: 'in_service' }], pagination: { totalItems: 1 } }, filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] } };
    const detail = { ticketId: 't1', status: 'in_service', customer: { fullName: 'Jessica Miller' }, primaryTechnician: { technicianId: 'k1', name: 'Mia' }, subtotalCents: 8000, estimatedEndAt: null,
      services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000, status: 'serving' }, { serviceLineId: 'l2', serviceName: 'Nail Art', priceCents: 2000, status: 'done', isAddOn: true, technicianName: 'Ava' }] };
    const revData = { ticketId: 't1', currentVersion: 3, revisions: [
      { version: 1, action: 'service_added', serviceLineId: 'l2', summary: 'Added Nail Art', actorRole: 'TECH', createdAt: '2026-06-01T00:30:00.000Z' },
      { version: 2, action: 'technician_assigned', serviceLineId: null, summary: 'Assigned Mia', actorRole: 'MANAGER', createdAt: '2026-06-01T00:35:00.000Z' },
      { version: 3, action: 'service_edited', serviceLineId: 'l2', summary: 'Updated Nail Art: tech Mia→Ava', actorRole: 'MANAGER', createdAt: '2026-06-01T00:40:00.000Z' } ] };
    globalThis.fetch = mockByUrl({ '/pos/serving/tickets/t1/revisions': revData, '/pos/serving/tickets/t1': detail, '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await screen.findByText('Added Nail Art');
    expect(screen.queryByTestId('sv-line-drawer')).toBeNull();
    fireEvent.click(screen.getByTestId('sv-line-l2'));
    const dr = screen.getByTestId('sv-line-drawer');
    expect(within(dr).getByTestId('sv-line-performer').textContent).toBe('Ava');
    expect(dr).toHaveTextContent('Add-Ons'); expect(dr).toHaveTextContent('Done');
    const rows = within(dr).getAllByTestId('sv-line-history-row');
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(['v3', 'v1']);   // newest first, the ticket-level v2 is not this line's
    expect(dr.textContent).not.toMatch(/\$|commission|payroll/i);
    fireEvent.click(screen.getByTestId('sv-line-l1'));   // the base line: performer falls back to the primary, labelled so; no history yet
    expect(within(screen.getByTestId('sv-line-drawer')).getByTestId('sv-line-performer').textContent).toBe('Mia (primary technician)');
    expect(screen.getByTestId('sv-line-history-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sv-line-l1'));
    expect(screen.queryByTestId('sv-line-drawer')).toBeNull();
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

  it('extras Serving 05: Guest Service Details shows the server\'s Service Done readiness and why not (never re-derived)', async () => {
    const withTickets = {
      kpis: { servingNow: 1, activeTickets: 1, delayedServices: 0, nearingCompletion: 0, averageServiceDurationMinutes: 40, totalInServiceSalesCents: 6000, techniciansInService: 1, servicesCompletedToday: 0, addOnAttachRatePercent: 0, addOnRevenueCents: 0, customerSatisfactionAvg: 0, onTimeCompletionPercent: 0 },
      tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceNames: ['Gel X'], primaryTechnicianName: 'Mia', elapsedMinutes: 10, estimatedDurationMinutes: 45, subtotalCents: 6000, status: 'in_service' }], pagination: { totalItems: 1 } },
      filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] },
    };
    // the line statuses say 'serving' but the server says not ready for NOTES_REQUIRED with 1 open line — the screen shows the server's answer
    const detail = { ticketId: 't1', status: 'in_service', allowedActions: ['mark_ready'], customer: { fullName: 'Jessica Miller' }, services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000, status: 'serving' }], subtotalCents: 6000, estimatedEndAt: null,
      serviceDoneReadiness: { state: 'not_ready', reasons: ['NOTES_REQUIRED'], openServiceLines: 1, via: null } };
    globalThis.fetch = mockByUrl({ '/pos/serving/tickets/t1/revisions': { ticketId: 't1', currentVersion: 0, revisions: [] }, '/pos/serving/tickets/t1': detail, '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    const box = await screen.findByTestId('sv-sd-ready');
    expect(box.getAttribute('data-state')).toBe('not_ready');
    expect(box.textContent).toContain('Not ready');
    expect(screen.getByTestId('sv-sd-why-NOTES_REQUIRED').textContent).toBe('Your salon requires a service note before Mark Ready.');
    expect(screen.getByTestId('sv-sd-open').textContent).toBe('1 service line(s) not marked done — not required to finish');
    expect(screen.queryByTestId('sv-qualified')).toBeNull();   // the server sent no qualified-availability → nothing invented
  });

  it('extras Serving 05 (round 10): Guest Service Details names the free technicians the server says are qualified; none → says how many were checked', async () => {
    const withTickets = { kpis: {}, tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceNames: ['Gel X'], elapsedMinutes: 10, subtotalCents: 6000, status: 'in_service' }], pagination: { totalItems: 1 } }, filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] } };
    const detail = { ticketId: 't1', status: 'in_service', customer: { fullName: 'Jessica Miller' }, services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000, status: 'serving' }], subtotalCents: 6000, estimatedEndAt: null,
      qualifiedAvailability: { technicians: [{ technicianId: 'k1', name: 'Ava' }, { technicianId: 'k2', name: 'Leo' }], checked: 3 } };
    const routes = (d: unknown) => mockByUrl({ '/pos/serving/tickets/t1/revisions': { ticketId: 't1', currentVersion: 0, revisions: [] }, '/pos/serving/tickets/t1': d, '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    globalThis.fetch = routes(detail);
    const { unmount } = render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect((await screen.findByTestId('sv-qualified')).textContent).toBe('Qualified & free nowAva, Leo');
    unmount();
    globalThis.fetch = routes({ ...detail, qualifiedAvailability: { technicians: [], checked: 2 } });
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect((await screen.findByTestId('sv-qualified')).textContent).toBe('Qualified & free nowNone of 2 free technicians');
  });

  it('extras Serving 05: a ready visit says which move; no readiness from the server → nothing invented', async () => {
    const withTickets = { kpis: {}, tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', serviceNames: ['Gel X'], elapsedMinutes: 10, subtotalCents: 6000, status: 'in_service' }], pagination: { totalItems: 1 } }, filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] } };
    const detail = { ticketId: 't1', status: 'in_service', customer: { fullName: 'Jessica Miller' }, services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000, status: 'done' }], subtotalCents: 6000, estimatedEndAt: null,
      serviceDoneReadiness: { state: 'ready', reasons: [], openServiceLines: 0, via: 'send_to_service_done' } };
    globalThis.fetch = mockByUrl({ '/pos/serving/tickets/t1/revisions': { ticketId: 't1', currentVersion: 0, revisions: [] }, '/pos/serving/tickets/t1': detail, '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    const { unmount } = render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    const box = await screen.findByTestId('sv-sd-ready');
    expect(box.textContent).toContain('Ready · Send to Service Done');
    expect(screen.queryByTestId('sv-sd-open')).toBeNull();
    unmount();
    const { serviceDoneReadiness: _drop, ...older } = detail;
    globalThis.fetch = mockByUrl({ '/pos/serving/tickets/t1/revisions': { ticketId: 't1', currentVersion: 0, revisions: [] }, '/pos/serving/tickets/t1': older, '/pos/serving': withTickets, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    expect(await screen.findByText('Change History')).toBeInTheDocument();
    expect(screen.queryByTestId('sv-sd-ready')).toBeNull();
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

// ── extras Serving 07 — Touch Safe Action Review: the server's review (guest, lines touched, permission, conflicts) is shown
// before a move / an add-on and before a Mark Ready that the server flags; a clean Mark Ready stays one tap.
describe('POSServingScreen — Serving 07 action review', () => {
  const review = (over: any = {}) => ({ ticketId: 'sv1', action: 'mark_ready', guest: { customerName: 'Jessica Miller', ticketNumber: 'S1', isVip: false },
    affected: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Mia', priceCents: 6500, isNew: false }], change: null,
    permission: { key: 'pos.serving.mark_done', allowed: true }, conflicts: [], canProceed: true, needsConfirmation: false, ...over });
  const rec = (rv: any) => {
    const calls: { url: string; method: string; body?: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url); const method = init?.method || 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(init.body) : undefined });
      const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/action-review')) return ok(rv);
      if (u.includes('/change-requests/pending')) return ok([]);
      if (u.includes('/pos/technicians/state')) return ok(sRoster);
      if (u.includes('/revisions')) return ok({ ticketId: 'sv1', currentVersion: 0, revisions: [] });
      if (u.match(/\/pos\/serving\/tickets\/[^/?]+$/) && method === 'GET') return ok({ ticketId: 'sv1', status: 'in_service', allowedActions: ['mark_ready'], customer: { fullName: 'Jessica Miller' }, services: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', priceCents: 6500, status: 'serving' }], subtotalCents: 6500 });
      if (u.includes('/pos/serving/state')) return ok(richServing);
      return ok({ ok: true });
    }) as any;
    return calls;
  };
  const markReadyQuick = async () => { await waitForLoaded(); const btn = screen.getAllByText('Mark Ready').map((n) => n.closest('button')).find((b) => b && b.getAttribute('aria-disabled') !== 'true'); fireEvent.click(btn!); };

  it('a clean Mark Ready (server: no confirmation needed) posts at once after the read-only review', async () => {
    const calls = rec(review());
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Mark Ready').some((n) => n.closest('button')?.getAttribute('aria-disabled') !== 'true')).toBe(true));
    await markReadyQuick();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mark-service-done') && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url.includes('/action-review'))!.url).toContain('action=mark_ready');
    expect(screen.queryByTestId('sv-review')).toBeNull();
  });

  it('a blocked Mark Ready shows the guest, lines, permission and the conflict; Confirm is off and nothing posts', async () => {
    const calls = rec(review({ conflicts: [{ code: 'NOTES_REQUIRED', severity: 'block' }, { code: 'OPEN_SERVICE_LINES', severity: 'info', vars: { n: 1 } }], canProceed: false, needsConfirmation: true }));
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Mark Ready').some((n) => n.closest('button')?.getAttribute('aria-disabled') !== 'true')).toBe(true));
    await markReadyQuick();
    const box = await screen.findByTestId('sv-review');
    expect(box.getAttribute('data-can-proceed')).toBe('false');
    expect(box.textContent).toContain('Jessica Miller');
    expect(screen.getAllByTestId('sv-review-line').map((n) => n.textContent)).toEqual([expect.stringContaining('Gel Manicure')]);
    expect(screen.getByTestId('sv-review-perm').textContent).toBe('You are allowed to: Mark Ready');
    expect(screen.getByTestId('sv-review-conflict-NOTES_REQUIRED').textContent).toContain('Your salon requires a service note before Mark Ready.');
    expect(screen.getByTestId('sv-review-conflict-OPEN_SERVICE_LINES').textContent).toBe('1 service line(s) are not marked done yet (allowed).');
    expect(screen.getByTestId('sv-review-confirm')).toBeDisabled();
    expect(calls.some((c) => c.url.includes('/mark-service-done'))).toBe(false);
  });

  it('moving to another technician always stops at the review (from → to, booking warning) and posts only on Confirm', async () => {
    const calls = rec(review({ action: 'assign_technician', change: { fromTechnicianName: 'Mia', toTechnicianName: 'Leo Chen' }, permission: { key: 'pos.serving.assign_technician', allowed: true, overrideKey: 'pos.booking.override_conflict', overrideAllowed: false },
      conflicts: [{ code: 'BOOKING_SOON', severity: 'warn', vars: { name: 'Leo Chen', minutes: 10, needs: 25 } }], needsConfirmation: true }));
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    await waitForLoaded();
    fireEvent.click(await screen.findByRole('button', { name: 'Move Tech' }));
    fireEvent.change(screen.getByLabelText('Move to technician'), { target: { value: 't2' } });
    await screen.findByTestId('sv-review');
    expect(calls.find((c) => c.url.includes('/action-review'))!.url).toMatch(/action=assign_technician.*technicianId=t2/);
    expect(screen.getByTestId('sv-review-change').textContent).toBe('From Mia → to Leo Chen');
    expect(screen.getByTestId('sv-review-conflict-BOOKING_SOON').textContent).toContain('Leo Chen has a booking in 10 min; this needs about 25 min.');
    expect(calls.some((c) => c.url.includes('/assign-technician'))).toBe(false);
    fireEvent.click(screen.getByTestId('sv-review-confirm'));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/assign-technician'))?.body).toEqual({ technicianId: 't2' }));
  });
});
