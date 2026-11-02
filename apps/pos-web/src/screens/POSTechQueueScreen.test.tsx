import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSTechQueueScreen, filterTechRows, TQ_LANE_PAGE_SIZE } from './POSTechQueueScreen';

const state = {
  kpis: { assignedTickets: 0, waitingForAcceptance: 0, acceptedTickets: 0, readyToStart: 0, delayedTickets: 0, activeTechnicians: 0, availableTechnicians: 0, averageAssignedWaitMinutes: 0, laborRevenueTodayCents: 0, utilizationTodayPercent: 0, upsellCapturePercent: 0 },
  technicianLanes: [],
  tickets: { items: [], pagination: { totalItems: 0 } },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSTechQueueScreen', () => {
  it('mounts and renders the tech-queue board + empty state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Tech Queue')).toBeInTheDocument();
    expect(screen.getByText('No technicians clocked in.')).toBeInTheDocument();
  });

  it('renders AI Assignment Insights + Available Technicians from lanes', async () => {
    const withLanes = {
      kpis: { assignedTickets: 2, waitingForAcceptance: 1, acceptedTickets: 1, readyToStart: 0, delayedTickets: 1, activeTechnicians: 1, availableTechnicians: 1, averageAssignedWaitMinutes: 12, laborRevenueTodayCents: 84050, utilizationTodayPercent: 72, upsellCapturePercent: 40 },
      technicianLanes: [
        { technicianId: 't1', technicianName: 'Mia', workingStatus: 'available', activeTicketCount: 0, acceptedTicketCount: 0, delayedTicketCount: 0, estimatedWorkloadMinutes: 0, tickets: [] },
        { technicianId: 't2', technicianName: 'Leo', workingStatus: 'in_service', activeTicketCount: 3, acceptedTicketCount: 1, delayedTicketCount: 1, estimatedWorkloadMinutes: 120, tickets: [] },
      ],
      tickets: { items: [], pagination: { totalItems: 0 } },
    };
    globalThis.fetch = mockFetch(withLanes) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Tech Queue')).toBeInTheDocument();
    expect(screen.getByText(/AI Assignment Insights/)).toBeInTheDocument();
    // T05 added analytics row + Quick Actions
    expect(screen.getByText(/Tech Performance Today/)).toBeInTheDocument();
    expect(screen.getByText(/Top Revenue Techs/)).toBeInTheDocument();
    expect(screen.getByText(/Assignment Source/)).toBeInTheDocument();
    expect(screen.getByText(/Service Mix by Technician/)).toBeInTheDocument();
    expect(screen.getByText('Assign Guest')).toBeInTheDocument();
    expect(screen.getByText(/Available Technicians/)).toBeInTheDocument();
    expect(screen.getByText('Services In Progress')).toBeInTheDocument();
    expect(screen.getByText('Labor Revenue Today')).toBeInTheDocument();
    expect(screen.getByText('$840.50')).toBeInTheDocument();
    expect(screen.getByText('Utilization Today')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Upsell Capture')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
});

// ── 2026-07-03 screen-level coverage for the Workload Board: drag-drop assignment (guest → available tech hits the
// real assign endpoint), drop-eligibility rejection (in-service tech), and the Auto Balance preview→apply flow.
import { fireEvent, waitFor, within } from '@testing-library/react';

const boardState = {
  kpis: { assignedTickets: 1, waitingForAcceptance: 0, acceptedTickets: 0, readyToStart: 1, delayedTickets: 0, activeTechnicians: 2, availableTechnicians: 1, averageAssignedWaitMinutes: 8, laborRevenueTodayCents: 50000, utilizationTodayPercent: 60, upsellCapturePercent: 0 },
  technicianLanes: [
    { technicianId: 't1', technicianName: 'Mia', workingStatus: 'available', activeTicketCount: 0, acceptedTicketCount: 0, delayedTicketCount: 0, estimatedWorkloadMinutes: 0, tickets: [] },
    { technicianId: 't2', technicianName: 'Leo', workingStatus: 'in_service', activeTicketCount: 1, acceptedTicketCount: 0, delayedTicketCount: 0, estimatedWorkloadMinutes: 60, tickets: [] },
  ],
  technicianRows: [
    { rotationPosition: 1, technicianId: 't1', technicianName: 'Mia', specialties: ['Gel'], status: 'available', guests: 0, nextAvailableLabel: 'Now', utilizationPercent: 40, tipsTodayCents: 0, revenueTodayCents: 0 },
    { rotationPosition: 2, technicianId: 't2', technicianName: 'Leo', specialties: ['Acrylic'], status: 'in_service', guests: 1, currentServiceName: 'Full Set', currentServiceCustomer: 'Ann', nextAvailableLabel: '30m', utilizationPercent: 85, tipsTodayCents: 0, revenueTodayCents: 0 },
  ],
  waitingGuests: [
    { queueItemId: 'q1', customerName: 'Jessica Miller', serviceName: 'Gel Manicure', priority: 'normal', waitMinutes: 6 },
  ],
  tickets: { items: [], pagination: { totalItems: 0 } },
};

// Router: tech-queue state + queue assign/auto-balance endpoints (assignByDrop uses posQueueApi → /pos/queue/*).
const boardFetch = (opts: { assignFail?: boolean; preview?: any } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/auto-balance/preview')) return ok(opts.preview ?? { proposals: [{ queueItemId: 'q1', technicianId: 't1', technicianName: 'Mia', customerName: 'Jessica Miller' }], unassignable: [], summary: { proposed: 1 } });
    if (u.includes('/auto-balance/apply')) return ok({ applied: 1, failures: [] });
    if (u.includes('/assign-technician')) { if (opts.assignFail) return { ok: false, status: 409, json: async () => ({ message: 'Technician just became busy' }), headers: { get: () => null } } as any; return ok({ ok: true }); }
    if (u.includes('/pos/tech-queue/state')) return ok(boardState);
    return ok({});
  });
  (fn as any).calls = calls;
  return fn;
};


describe('POSTechQueueScreen — Workload Board renders assignable guests and eligible drop targets', () => {
  it('waiting guests are draggable and available technicians present a drop affordance', async () => {
    globalThis.fetch = boardFetch() as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    // the waiting guest card is draggable (the source of a drop assignment)
    const guest = (await screen.findAllByText('Jessica Miller'))[0].closest('[draggable="true"]') as HTMLElement;
    expect(guest).toBeTruthy();
    // the board shows the tap-or-drag affordance for droppable columns (Dell touchscreen: tap is first-class)
    expect(screen.getAllByText(/Tap a guest, then a technician — or drag here/).length).toBeGreaterThanOrEqual(1);
  });

  it('TOUCH path: tap a guest to select it, then tap an available technician — hits the same assign endpoint as drag', async () => {
    const f = boardFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const guest = (await screen.findAllByText('Jessica Miller'))[0].closest('[draggable="true"]') as HTMLElement;
    fireEvent.click(guest); // arm the selection by tap (no drag events involved)
    const techCard = await screen.findByTitle('Tap or drop a guest to assign to Mia');
    fireEvent.click(techCard);
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/assign-technician') && c.method === 'POST');
      expect(call).toBeTruthy();
    });
  });

  it('an available technician is drop-eligible; an in-service technician is not (dropEligibility gate)', async () => {
    // dropEligibility is the pure gate assignByDrop consults before hitting the server.
    const { dropEligibility } = await import('./techQueueDnd');
    expect(dropEligibility('available')).toMatchObject({ ok: true, mode: 'now' });
    expect(dropEligibility('finishing_soon')).toMatchObject({ ok: true, mode: 'next' });
    expect(dropEligibility('in_service').ok).toBe(false);
    expect(dropEligibility('on_break').ok).toBe(false);
  });
});

describe('POSTechQueueScreen — Auto Balance preview and apply', () => {
  it('previews proposals then applies them through the real endpoints', async () => {
    const f = boardFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.click(screen.getByText('Auto Balance Queue'));
    // preview renders, then Apply
    expect(await screen.findByText(/Auto Balance preview/)).toBeInTheDocument();
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/auto-balance/preview') && c.method === 'POST')).toBe(true));
    const applyBtn = await screen.findByText(/Apply/);
    fireEvent.click(applyBtn);
    await waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/auto-balance/apply') && c.method === 'POST')).toBe(true);
    });
    expect(await screen.findByText(/Auto Balance applied: 1 assigned/)).toBeInTheDocument();
  });

  it('an empty preview reports nothing to balance instead of a fake proposal', async () => {
    globalThis.fetch = boardFetch({ preview: { proposals: [], unassignable: [], summary: { proposed: 0 } } }) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.click(screen.getByText('Auto Balance Queue'));
    expect(await screen.findByText(/Nothing to balance/)).toBeInTheDocument();
  });
});

// ── 2026-07-03 Assigned Tickets management table + Manage drawer: the supervisory actions (reassign / priority /
// delay / decline / cancel) were fully implemented and endpoint-wired but the table/drawer had been dropped from the
// render, orphaning them. These lock the restored wiring end-to-end.
const ticketState = {
  kpis: boardState.kpis,
  technicianLanes: boardState.technicianLanes,
  technicianRows: [],
  waitingGuests: [],
  tickets: { items: [
    { techQueueTicketId: 'tk1', customerName: 'Jessica Miller', isVip: false, requestedServices: [{ serviceName: 'Gel Manicure' }], serviceCount: 1, priority: 'normal', status: 'assigned', assignedTechnicianName: 'Mia', assignedWaitMinutes: 5 },
  ], pagination: { totalItems: 1 } },
};
const ticketFetch = () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/pos/tech-queue/state')) return ok(ticketState);
    return ok({ ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSTechQueueScreen — Assigned Tickets Manage drawer', () => {
  it('renders assigned tickets and opens the Manage drawer with supervisory actions', async () => {
    globalThis.fetch = ticketFetch() as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Assigned Tickets');
    expect(screen.getByText('Manage')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Manage'));
    // the drawer exposes the real actions
    expect(screen.getByText('Reassign')).toBeInTheDocument();
    expect(screen.getByText('Update Priority')).toBeInTheDocument();
    expect(screen.getByText('Report Delay')).toBeInTheDocument();
    expect(screen.getByText('Decline')).toBeInTheDocument();
    expect(screen.getByText('Cancel Ticket')).toBeInTheDocument();
  });

  it('Cancel Ticket requires a reason, then POSTs to the real cancel endpoint', async () => {
    const f = ticketFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Assigned Tickets');
    fireEvent.click(screen.getByText('Manage'));
    // no reason yet → guarded
    fireEvent.click(screen.getByText('Cancel Ticket'));
    expect(await screen.findByText(/Cancelling requires a reason/)).toBeInTheDocument();
    // provide a reason → real endpoint
    fireEvent.change(screen.getByPlaceholderText(/guest requested a different tech/), { target: { value: 'duplicate ticket' } });
    fireEvent.click(screen.getByText('Cancel Ticket'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/tech-queue/tickets/tk1/cancel') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ reason: 'duplicate ticket' });
    });
  });

  it('Reassign requires a technician selection before submitting', async () => {
    globalThis.fetch = ticketFetch() as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Assigned Tickets');
    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByText('Reassign'));
    expect(await screen.findByText('Pick a technician.')).toBeInTheDocument();
  });
});

// ── 2026-07-03 header "All Services" filter: was a static single-option dropdown (dead); now populated from the
// state's category facets and drives a real server refetch with ?serviceCategory=.
describe('POSTechQueueScreen — service category filter (was a dead dropdown)', () => {
  it('populates from facets and refetches with serviceCategory=', async () => {
    const calls: { url: string }[] = [];
    const withFacets = { ...ticketState, filters: { serviceCategories: ['Manicure', 'Pedicure'] } };
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url); calls.push({ url: u });
      return { ok: true, status: 200, json: async () => withFacets, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const sel = screen.getByLabelText('Service filter') as HTMLSelectElement;
    expect(within(sel).getByText('Manicure')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'Pedicure' } });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/pos/tech-queue/state') && c.url.includes('serviceCategory=Pedicure'))).toBe(true));
  });
});

// ── 2026-07-03 D1 "Assign" now assigns the waiting guest to their computed best-match technician inline (same
// /assign-technician endpoint + eligibility as drag-drop), instead of only navigating to /queue. Backend now returns
// bestMatchTechnicianId alongside bestMatchTechnicianName.
import { waitFor as waitForTQ } from '@testing-library/react';
const boardStateBestMatch = {
  ...boardState,
  waitingGuests: [
    { queueItemId: 'q1', customerName: 'Jessica Miller', serviceName: 'Gel Manicure', priority: 'normal', waitMinutes: 6, bestMatchTechnicianName: 'Mia', bestMatchTechnicianId: 't1' },
  ],
};
describe('POSTechQueueScreen — D1 one-click assign to best match', () => {
  it('clicking Assign posts to /assign-technician for the best-match technician', async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    const fn = vi.fn(async (url: any, init?: any) => {
      const u = String(url); const method = init?.method || 'GET';
      let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
      calls.push({ url: u, method, body });
      const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/assign-technician')) return ok({ ok: true });
      if (u.includes('/pos/tech-queue/state')) return ok(boardStateBestMatch);
      return ok({});
    });
    globalThis.fetch = fn as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    // the D1 table row for Jessica has an Assign button
    const assignBtns = await screen.findAllByText('Assign');
    fireEvent.click(assignBtns[assignBtns.length - 1]);
    await waitForTQ(() => {
      const call = calls.find((c) => c.url.includes('/assign-technician') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call!.body).toMatchObject({ technicianId: 't1' });
    });
  });
});

// ── BUILD_PLAN Phase 6 (audit bug 10): drag-drop / tap / best-match assign send the technician this board showed
// (`expectedTechnicianId`, + version when known), a 409 reads in plain words, and "Send Break" is real — it starts the
// technician's break through the live-schedule break API instead of saying "not connected yet".
const p6State = {
  ...boardState,
  technicianRows: [...boardState.technicianRows, { rotationPosition: 3, technicianId: 't3', technicianName: 'Ana', specialties: ['Gel'], status: 'on_break', guests: 0, nextAvailableLabel: '15m', utilizationPercent: 10, tipsTodayCents: 0, revenueTodayCents: 0 }],
  waitingGuests: [{ queueItemId: 'q1', customerName: 'Jessica Miller', serviceName: 'Gel Manicure', priority: 'normal', waitMinutes: 6, bestMatchTechnicianName: 'Mia', bestMatchTechnicianId: 't1', version: 4 }],
};
const p6Fetch = (over: Record<string, () => { status: number; body: any }> = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const res = (status: number, j: any) => ({ ok: status < 300, status, json: async () => j, headers: { get: () => null } } as any);
    for (const k of Object.keys(over)) if (u.includes(k)) { const r = over[k](); return res(r.status, r.body); }
    if (u.includes('/pos/tech-queue/state')) return res(200, p6State);
    // the server-paged technician picker (200-technician §2: Send Break / Reassign pick through it, never a roster <select>)
    if (u.includes('/pos/booking/technicians')) { const techs = p6State.technicianRows.filter((r) => r.status !== 'on_break').map((r) => ({ technicianId: r.technicianId, name: r.technicianName, rosterNumber: r.rotationPosition, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }));
      return res(200, { date: '2026-10-27', technicians: techs, total: techs.length, totalAll: techs.length, workingCount: techs.length, page: 1, pageSize: 12, totalPages: 1 }); }
    return res(200, { ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};
const p6Sent = (f: any, method: string, frag: string) => (f.calls as any[]).filter((c) => c.method === method && c.url.includes(frag));

describe('POSTechQueueScreen — Phase 6: expected technician on every assign (bug 10)', () => {
  it('a mouse drag-drop sends expectedTechnicianId (null for a waiting guest) and the version', async () => {
    const f = p6Fetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const guest = (await screen.findAllByText('Jessica Miller'))[0].closest('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(guest);
    const tech = await screen.findByTitle('Tap or drop a guest to assign to Mia');
    fireEvent.dragOver(tech);
    fireEvent.drop(tech);
    await waitFor(() => expect(p6Sent(f, 'POST', '/items/q1/assign-technician')[0]?.body).toEqual({ technicianId: 't1', expectedTechnicianId: null, expectedVersion: 4 }));
  });

  it('"Assign" to the engine\'s best match sends the expected technician too', async () => {
    const f = p6Fetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const btns = await screen.findAllByText('Assign');
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(p6Sent(f, 'POST', '/assign-technician')[0]?.body).toMatchObject({ technicianId: 't1', expectedTechnicianId: null }));
  });

  it('a 409 tells staff who has the guest now', async () => {
    const f = p6Fetch({ '/assign-technician': () => ({ status: 409, body: { message: 'This guest was just assigned or changed on another device.', code: 'VERSION_CONFLICT', currentTechnicianId: 't2', currentVersion: 5 } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const btns = await screen.findAllByText('Assign');
    fireEvent.click(btns[btns.length - 1]);
    expect(await screen.findByText(/Someone else changed Jessica Miller first — they are now with Leo/)).toBeInTheDocument();
  });
});

describe('POSTechQueueScreen — Phase 6: Send Break is real (bug 10)', () => {
  it('starts the break through the live-schedule break API', async () => {
    const f = p6Fetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.click(screen.getByText('Send Break'));
    expect(screen.queryByText(/aren.t connected yet/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Break technician'));
    fireEvent.click(await screen.findByRole('option', { name: /Mia/ }));
    fireEvent.change(screen.getByLabelText('Break reason'), { target: { value: 'lunch' } });
    fireEvent.click(screen.getByText('Start break'));
    await waitFor(() => expect(p6Sent(f, 'POST', '/pos/technicians/t1/start-break')[0]?.body).toEqual({ reason: 'lunch' }));
    expect(await screen.findByText(/Mia is on break/)).toBeInTheDocument();
  });

  it('a technician mid-service is refused in plain words', async () => {
    const f = p6Fetch({ '/start-break': () => ({ status: 409, body: { message: 'This technician is in an active service' } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.click(screen.getByText('Send Break'));
    fireEvent.click(screen.getByLabelText('Break technician'));
    fireEvent.click(await screen.findByRole('option', { name: /Leo/ }));
    fireEvent.click(screen.getByText('Start break'));
    expect(await screen.findByText(/Leo can.t start a break right now: This technician is in an active service/)).toBeInTheDocument();
  });

  it('the break picker pages from the server (working technicians), and a technician on break can be brought back with End break', async () => {
    const f = p6Fetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.click(screen.getByText('Send Break'));
    fireEvent.click(screen.getByLabelText('Break technician'));
    await screen.findByRole('option', { name: /Mia/ });
    expect(screen.queryByRole('option', { name: /Ana/ })).toBeNull();
    expect(p6Sent(f, 'GET', '/pos/booking/technicians')[0].url).toContain('working=true');
    fireEvent.click(screen.getByText('End break'));
    await waitFor(() => expect(p6Sent(f, 'POST', '/pos/technicians/t3/end-break').length).toBe(1));
  });
});

// ── Multi-technician routing (contract §7): part rows of a shared visit; a split best match is never dropped on one tech ──
describe('POSTechQueueScreen — shared visits and split best matches', () => {
  const splitState = {
    ...p6State,
    waitingGuests: [{ queueItemId: 'q1', customerName: 'Jessica Miller', serviceName: 'Pedicure (+2)', priority: 'normal', waitMinutes: 6, bestMatchTechnicianName: 'Mia', bestMatchTechnicianId: 't1', bestMatchMode: 'split', bestMatchTechnicianNames: ['Mia', 'Leo'], version: 4 }],
    tickets: { items: [
      { techQueueTicketId: 'tkA', customerName: 'Olivia Brown', requestedServices: [{ serviceName: 'Pedicure' }], serviceCount: 1, priority: 'normal', status: 'assigned', assignedTechnicianName: 'Mia', visitPart: 1,
        sharedWith: [{ technicianId: 't2', technicianName: 'Leo', serviceNames: ['Manicure', 'Nail Art'], status: 'assigned', visitPart: 2 }] },
      { techQueueTicketId: 'tkB', customerName: 'Ana Ruiz', requestedServices: [{ serviceName: 'Gel X' }], serviceCount: 1, priority: 'normal', status: 'assigned', assignedTechnicianName: 'Mia', visitPart: null },
    ], pagination: { totalItems: 2 } },
  };
  const planFail = () => ({ status: 500, body: { message: 'later' } });

  it('a part row says "Part n of m · with <tech> (<services>)"; a whole-visit ticket says nothing extra', async () => {
    globalThis.fetch = p6Fetch({ '/pos/tech-queue/state': () => ({ status: 200, body: splitState }) }) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Part 1 of 2 · with Leo (Manicure, Nail Art)')).toBeInTheDocument();
    expect(screen.queryByTestId('part-tkB')).toBeNull();
  });

  it('the best match of a split guest reads "Mia + Leo"; Assign opens the plan and assigns nobody', async () => {
    const f = p6Fetch({ '/pos/tech-queue/state': () => ({ status: 200, body: splitState }), '/entries/q1/plan': planFail }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Mia + Leo')).toBeInTheDocument();
    const btns = await screen.findAllByText('Assign');
    fireEvent.click(btns[btns.length - 1]);
    expect(await screen.findByLabelText('Visit plan for Jessica Miller')).toBeInTheDocument();
    expect(p6Sent(f, 'POST', '/assign-technician').length).toBe(0);
  });

  it('dropping a split guest onto one technician opens the plan instead of assigning', async () => {
    const f = p6Fetch({ '/pos/tech-queue/state': () => ({ status: 200, body: splitState }), '/entries/q1/plan': planFail }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    const guest = (await screen.findAllByText('Jessica Miller'))[0].closest('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(guest);
    const tech = await screen.findByTitle('Tap or drop a guest to assign to Mia');
    fireEvent.dragOver(tech); fireEvent.drop(tech);
    expect(await screen.findByText('Jessica Miller needs several technicians — review the plan and assign it as a whole.')).toBeInTheDocument();
    expect(screen.getByLabelText('Visit plan for Jessica Miller')).toBeInTheDocument();
    expect(p6Sent(f, 'POST', '/assign-technician').length).toBe(0);
  });
});

// 200-technician mandate §33: the Live Technician Queue searches, filters by status and pages — never one giant list.
const STATUSES = ['available', 'in_service', 'finishing_soon', 'on_break', 'off_today', 'scheduled_later'];
const techRows = Array.from({ length: 200 }, (_, i) => ({ rotationPosition: i + 1, technicianId: 't' + (i + 1), technicianName: 'Tech ' + (i + 1), specialties: [i % 2 ? 'Pedicure' : 'Gel'], status: STATUSES[i % 6], guests: 0, nextAvailableLabel: 'now', utilizationPercent: null, tipsTodayCents: 0, revenueTodayCents: 0 }));

describe('Tech Queue at 200 technicians (§33)', () => {
  it('filterTechRows: status groups, #rotation and name search, bounded pages', () => {
    expect(filterTechRows(techRows, '', '', 1).items.length).toBe(TQ_LANE_PAGE_SIZE);
    expect(filterTechRows(techRows, '', '', 1).totalPages).toBe(20);
    expect(filterTechRows(techRows, '', '', 99).page).toBe(20);
    const serving = filterTechRows(techRows, '', 'serving', 1);
    expect(serving.total).toBe(67);   // in_service (34) + finishing_soon (33)
    expect(serving.items.every((r) => ['in_service', 'finishing_soon'].includes(r.status))).toBe(true);
    expect(filterTechRows(techRows, '', 'off', 1).total).toBe(66);
    expect(filterTechRows(techRows, '#150', '', 1).items.map((r) => r.technicianId)).toEqual(['t150']);
    expect(filterTechRows(techRows, 'tech 19', '', 1).total).toBe(11);   // 19, 190–199
    expect(filterTechRows(techRows, 'pedi', 'ready', 1).total).toBe(0);  // available rows are the even-index "Gel" ones
  });

  it('renders one page of the 200 lanes, searches and filters by status', async () => {
    globalThis.fetch = mockFetch({ ...state, technicianRows: techRows }) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    const pager = await screen.findByTestId('tq-lane-pager');
    expect(pager.textContent).toContain('Showing 10 of 200');
    expect(pager.textContent).toContain('Page 1 of 20');
    const table = pager.parentElement!.querySelector('table')!;
    expect(table.querySelectorAll('tbody tr').length).toBe(10);
    fireEvent.click(within(pager).getByText('Last »'));
    expect(within(table).getByText('Tech 200')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Technician status filter'), { target: { value: 'break' } });
    expect((await screen.findByTestId('tq-lane-pager')).textContent).toContain('Showing 10 of 33');
    fireEvent.change(screen.getAllByLabelText('Find technician')[0], { target: { value: '#4' } });
    await waitFor(() => expect(screen.getByTestId('tq-lane-pager').textContent).toContain('Showing 1 of 1'));
    expect(within(table).getByText('Tech 4')).toBeInTheDocument();
  });
});

// Oct 26 2026: the server reports Hold (Fair Turn HOLD) and Appointment Soon as lane states; the screen filters and labels them
describe('Tech Queue — Hold and Appointment Soon (§33)', () => {
  const rows200 = techRows.map((r, i) => (i % 10 === 3 ? { ...r, status: 'hold', holdReason: 'AWAITING_MANAGER_POSITION' } : i % 10 === 7 ? { ...r, status: 'appointment_soon', nextAppointmentInMinutes: 25 } : r));
  it('filterTechRows groups them', () => {
    expect(filterTechRows(rows200, '', 'hold', 1).total).toBe(20);
    expect(filterTechRows(rows200, '', 'soon', 1).total).toBe(20);
    expect(filterTechRows(rows200, '', 'hold', 1).items.every((r) => r.status === 'hold')).toBe(true);
  });
  it('the status filter offers them and the table labels them', async () => {
    globalThis.fetch = mockFetch({ ...state, technicianRows: rows200 }) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    const pager = await screen.findByTestId('tq-lane-pager');
    const table = pager.parentElement!.querySelector('table')!;
    fireEvent.change(screen.getByLabelText('Technician status filter'), { target: { value: 'hold' } });
    await waitFor(() => expect(pager.textContent).toContain('of 20'));
    expect(within(table).getAllByText('On Hold').length).toBe(TQ_LANE_PAGE_SIZE);
    fireEvent.change(screen.getByLabelText('Technician status filter'), { target: { value: 'soon' } });
    await waitFor(() => expect(within(table).getAllByText('Appointment soon').length).toBe(TQ_LANE_PAGE_SIZE));
  });
});


// ── Oct 30 2026 rebuild (Tech Queue guide): LIVE QUEUE | HISTORY is a real switch over /pos/tech-queue-screen/tickets, the
// Assigned Tickets tabs count from the one ticket table, Technician Assignment Details opens from the lane row (Close / Esc)
// and says whether she can take a guest, and the one search shows its three scopes separately.
describe('POSTechQueueScreen — Live / History, tabs, assignment details, scoped search', () => {
  const page = (items: unknown[]) => ({ tab: 'history', period: null, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
  const closed = { id: 'h1', customer: 'Lan Ng', phone: '••• 6666', vip: false, source: 'walk_in', priority: 'normal', status: 'expired', delay: null, services: ['Gel Manicure'], technicianId: 't2', technician: 'Leo',
    createdAt: '2026-10-27T14:00:00Z', assignedAt: '2026-10-27T14:00:00Z', acceptedAt: null, startedAt: null, updatedAt: '2026-10-27T14:15:00Z', waitMinutes: 15, waitFrozen: true, ticketNumber: null, paid: false, live: false, appointmentId: null, matchedVia: null };
  const tech = { technicianId: 't1', name: 'Mia', avatarUrl: null, role: 'Technician', branch: 'Main', account: 'active', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', queue: 'AVAILABLE', manualUnavailable: false, onBreak: false, breakSince: null, assignable: true,
    qualifiedServices: ['Gel Manicure'], qualifiedCount: 1, current: null, next: [], nextAppointment: null, recent: { items: [], page: 1, pageSize: 6, totalItems: 0, totalPages: 1 } };
  const route = (calls: string[]) => vi.fn(async (url: any) => {
    const u = String(url); calls.push(u);
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/pos/tech-queue-screen/tab-counts')) return ok({ live: 1, waiting: 1, accepted: 0, in_service: 0, delayed: 0, done_today: 4, checkout_pending: 1 });
    if (u.includes('/pos/tech-queue-screen/tickets?') || u.endsWith('/pos/tech-queue-screen/tickets')) return ok(page([closed]));
    if (u.includes('/pos/tech-queue-screen/technicians/t1')) return ok(tech);
    if (u.includes('/pos/tech-queue-screen/search')) return ok({ q: 'mia', technicians: { totalItems: 1, items: [{ technicianId: 't1', name: 'Mia', avatarUrl: null, queue: 'AVAILABLE' }] }, live: { totalItems: 0, items: [] }, history: { totalItems: 1, items: [closed] } });
    if (u.includes('/pos/tech-queue/state')) return ok(boardState);
    return ok({});
  });
  it('History hides the live board, asks the server for closed tickets and shows a frozen wait', async () => {
    const calls: string[] = []; globalThis.fetch = route(calls) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    expect(screen.getByTestId('live-queue')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mode-history'));
    expect(await screen.findByTestId('history-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('live-queue')).toBeNull(); expect(screen.queryByTestId('workload')).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.includes('/pos/tech-queue-screen/tickets') && c.includes('tab=history'))).toBe(true));
    expect(await screen.findByText('Lan Ng')).toBeInTheDocument();
    expect(screen.getByText('stopped at the last event')).toBeInTheDocument();
  });
  it('the tabs carry the server counts and a tab pages from the server', async () => {
    const calls: string[] = []; globalThis.fetch = route(calls) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    expect(await screen.findByTestId('tab-done_today')).toHaveTextContent('4');
    fireEvent.click(screen.getByTestId('tab-checkout_pending'));
    await waitFor(() => expect(calls.some((c) => c.includes('tab=checkout_pending'))).toBe(true));
  });
  it('a lane row opens Technician Assignment Details; Esc closes it', async () => {
    const calls: string[] = []; globalThis.fetch = route(calls) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('lane-details'))[0]);
    expect(await screen.findByTestId('tech-assignable')).toHaveTextContent(/Yes/);
    expect(screen.getByTestId('tech-summary')).toHaveTextContent('Gel Manicure');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dlg-tech')).toBeNull());
  });
  it('one search shows technicians, live tickets and history as separate scopes', async () => {
    const calls: string[] = []; globalThis.fetch = route(calls) as any;
    render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findByText('Tech Queue');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'mia' } });
    expect(await screen.findByTestId('search-results')).toHaveTextContent('Technicians (1)');
    expect(screen.getByTestId('search-results')).toHaveTextContent('History (1)');
    expect(screen.getAllByTestId('hit-history')).toHaveLength(1);
  });
});
