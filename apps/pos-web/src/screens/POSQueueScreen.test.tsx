import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSQueueScreen } from './POSQueueScreen';

const queueState = {
  kpis: { waitingGuests: 0, averageWaitMinutes: 0, longestWaitMinutes: 0, vipWaiting: 0, appointmentsWaiting: 0, walkInsWaiting: 0, readyForTech: 0, assignedTechnicians: 0, delayedQueueItems: 0, returnRatePercent: 0 },
  queue: { items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } },
  filters: { statuses: [], sources: [], technicians: [], serviceCategories: [], priorityLevels: [], stations: [] },
};
// The Queue screen fetches BOTH /pos/queue/state and /pos/technicians/state — return the right payload per URL.
const mockByUrl = (map: Record<string, unknown>) => vi.fn(async (url: any) => {
  const u = String(url);
  for (const frag of Object.keys(map)) if (u.includes(frag)) return { ok: true, status: 200, json: async () => map[frag], headers: { get: () => null } } as any;
  return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSQueueScreen', () => {
  it('mounts past loading and renders the queue + empty state', async () => {
    globalThis.fetch = mockByUrl({ '/pos/queue/state': queueState, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Customer Queue')).toBeInTheDocument();
    expect(screen.getByText('No customers waiting.')).toBeInTheDocument();
    // T06 added modules
    expect(screen.getByText('Customer Profile Preview')).toBeInTheDocument();
    expect(screen.getByText('Visit Source Mix')).toBeInTheDocument();
    expect(screen.getByText('Top Waiting Services')).toBeInTheDocument();
    expect(screen.getByText('Potential Revenue by Queue')).toBeInTheDocument();
    expect(screen.getByText('New Walk-In')).toBeInTheDocument();
  });

  it('renders Queue Flow Board + AI Queue Insights from items', async () => {
    const withItems = {
      kpis: { waitingGuests: 3, averageWaitMinutes: 14, longestWaitMinutes: 25, vipWaiting: 1, appointmentsWaiting: 1, walkInsWaiting: 2, readyForTech: 1, assignedTechnicians: 1, delayedQueueItems: 0, returnRatePercent: 60 },
      queue: { items: [
        { queueItemId: 'q1', customerName: 'Jessica Miller', isVip: true, source: 'walk_in', requestedServices: [{ serviceName: 'Acrylic Full Set' }], serviceCount: 1, priority: 'vip', status: 'waiting', quotedWaitMinutes: 12 },
        { queueItemId: 'q2', customerName: 'Olivia Brown', source: 'online', requestedServices: [{ serviceName: 'Gel X' }], serviceCount: 1, priority: 'normal', status: 'ready_for_tech', quotedWaitMinutes: 6 },
      ], pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 } },
      filters: { statuses: [], sources: [], technicians: [], serviceCategories: [], priorityLevels: [], stations: [] },
    };
    globalThis.fetch = mockByUrl({ '/pos/queue/state': withItems, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Customer Queue')).toBeInTheDocument();
    expect(screen.getByText('Queue Flow Board')).toBeInTheDocument();
    expect(screen.getByText('AI Queue Insights')).toBeInTheDocument();
    expect(screen.getByText(/Live Customer Queue/)).toBeInTheDocument();
    // §20: the board's columns are the canonical statuses (the client-only "Waiting Lounge" stage is gone)
    expect(screen.getByTestId('cq-count-waiting')).toBeInTheDocument();
    expect(screen.getByText('Guests Waiting')).toBeInTheDocument();
    expect(screen.getByText('Return Rate')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('Waiting Guests by Priority')).toBeInTheDocument();
    expect(screen.getByText(/Available Technicians for Queue/)).toBeInTheDocument();
  });
});

// ── 2026-07-03 restored controls: header search/service/source filters (state existed but had no inputs) + the
// per-item Manage drawer (assign / priority / cancel handlers were fetched-but-orphaned). Lock the wiring.
import { fireEvent, within, waitFor } from '@testing-library/react';

const qItem = (over: any = {}) => ({ queueItemId: 'q1', customerId: 'c1', customerName: 'Jessica Miller', source: 'walk_in', requestedServices: [{ serviceName: 'Gel Manicure' }], serviceCount: 1, priority: 'normal', status: 'waiting', checkedInAt: new Date().toISOString(), ...over });
const richQueue = {
  kpis: { waitingGuests: 1, averageWaitMinutes: 10, longestWaitMinutes: 20, vipWaiting: 0, appointmentsWaiting: 0, walkInsWaiting: 1, readyForTech: 0, assignedTechnicians: 1, delayedQueueItems: 0, returnRatePercent: 0 },
  queue: { items: [qItem()], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
  filters: { statuses: ['waiting', 'assigned'], sources: ['walk_in', 'appointment'], technicians: ['Mia'], serviceCategories: ['Manicure', 'Pedicure'], priorityLevels: ['normal', 'high'], stations: [] },
};
const roster = { rows: { items: [{ technicianId: 't1', displayName: 'Mia Johnson' }, { technicianId: 't2', displayName: 'Leo Chen' }] } };
// 200-technician salon: the roster above is only the first page of /pos/technicians/state; the assign / lock pickers read
// GET /pos/booking/technicians one page (12) at a time, searching on the server.
const bookingTechName = (n: number) => (n === 1 ? 'Mia Johnson' : n === 2 ? 'Leo Chen' : n === 200 ? 'Nguyễn Thị Hương' : 'Tech ' + n);
const bookingTechPage = (u: string) => {
  const p = new URL(u, 'http://x').searchParams; const pg = Number(p.get('page') || 1); const q = (p.get('search') || '').toLowerCase();
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const all = Array.from({ length: 200 }, (_, i) => ({ technicianId: 't' + (i + 1), name: bookingTechName(i + 1), rosterNumber: i + 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }))
    .filter((t) => !q || fold(t.name).includes(fold(q)));
  return { date: '2026-06-10', technicians: all.slice((pg - 1) * 12, pg * 12), total: all.length, totalAll: 200, workingCount: 200, page: pg, pageSize: 12, totalPages: Math.max(1, Math.ceil(all.length / 12)) };
};
/** open a TechnicianPickerButton by its aria-label inside `scope` and pick `name` from page 1 */
const pickTech = async (scope: HTMLElement, label: string, name: string) => {
  fireEvent.click(within(scope).getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
};

// Records queue requests + serves detail/roster; queueOver lets a test tweak the queue payload.
const recQueue = (opts: { detail?: any } = {}) => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/pos/technicians/state')) return ok(roster);
    if (u.match(/\/pos\/queue\/items\/[^/?]+$/) && method === 'GET') return ok(opts.detail ?? { queueItemId: 'q1', customerName: 'Jessica Miller' });
    if (u.includes('/pos/queue/state')) return ok(richQueue);
    return ok({ ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSQueueScreen — header filters drive real refetches (were dead/missing)', () => {
  it('the service filter populates from facets and refetches with serviceCategory=', async () => {
    const f = recQueue(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findByText('Customer Queue');
    const sel = screen.getByLabelText('Service filter') as HTMLSelectElement;
    expect(within(sel).getByText('Pedicure')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'Pedicure' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/queue/state') && c.url.includes('serviceCategory=Pedicure'))).toBe(true));
  });

  it('the source filter refetches with source=', async () => {
    const f = recQueue(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findByText('Customer Queue');
    fireEvent.change(screen.getByLabelText('Source filter'), { target: { value: 'appointment' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/queue/state') && c.url.includes('source=appointment'))).toBe(true));
  });

  it('the search box refetches with search=', async () => {
    const f = recQueue(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findByText('Customer Queue');
    fireEvent.change(screen.getByLabelText('Search queue'), { target: { value: 'Jessica' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/queue/state') && c.url.includes('search=Jessica'))).toBe(true));
  });
});

describe('POSQueueScreen — per-item Manage drawer (was orphaned)', () => {
  it('opens the drawer and cancel requires a reason before hitting the real endpoint', async () => {
    const f = recQueue(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findByText('Customer Queue');
    fireEvent.click(await screen.findByText('Manage'));
    // drawer actions present (the drawer row also holds the unique "Cancel from Queue" button)
    const drawerRow = screen.getByText('Cancel from Queue').closest('[role="dialog"]') as HTMLElement;   // Customer Queue mandate §19: Manage is an overlay
    expect(within(drawerRow).getByText('Assign')).toBeInTheDocument();
    expect(within(drawerRow).getByText('Cancel from Queue')).toBeInTheDocument();
    // cancel guarded
    fireEvent.click(within(drawerRow).getByText('Cancel from Queue'));
    expect(await screen.findByText(/A reason is required to cancel/)).toBeInTheDocument();
    // with a reason → real endpoint
    fireEvent.change(screen.getByPlaceholderText(/Reason \(required to cancel\)/), { target: { value: 'left the salon' } });
    fireEvent.click(screen.getByText('Cancel from Queue'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/queue/items/q1/cancel') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ reason: 'left the salon' });
    });
  });

  it('assign requires a technician selection', async () => {
    globalThis.fetch = recQueue() as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findByText('Customer Queue');
    fireEvent.click(await screen.findByText('Manage'));
    const drawerRow = screen.getByText('Cancel from Queue').closest('[role="dialog"]') as HTMLElement;   // Customer Queue mandate §19: Manage is an overlay
    fireEvent.click(within(drawerRow).getByText('Assign'));
    expect(await screen.findByText('Pick a technician to assign.')).toBeInTheDocument();
  });
});

describe('Overview "Assign Tech" deep-link', () => {
  it('opens the assign sheet directly when navigated with ?assign=1', async () => {
    render(<MemoryRouter initialEntries={['/queue?assign=1']}><POSQueueScreen /></MemoryRouter>);
    // the AssignTechSheet ("Add to Queue / Assign") opens without any extra click
    expect(await screen.findByText('Add to Queue / Assign')).toBeInTheDocument();
  });
  it('does NOT open the assign sheet on a normal visit', async () => {
    render(<MemoryRouter initialEntries={['/queue']}><POSQueueScreen /></MemoryRouter>);
    await screen.findByText(/Queue|Waiting/i);
    expect(screen.queryByText('Add to Queue / Assign')).not.toBeInTheDocument();
  });
});

describe('Overview "Start Service" deep-link', () => {
  it('loads the queue filtered to ready-to-start guests when navigated with ?status=ready_for_tech', async () => {
    const fetchMock = mockByUrl({ '/pos/queue/state': queueState, '/pos/technicians/state': { rows: { items: [] } } });
    globalThis.fetch = fetchMock as any;
    render(<MemoryRouter initialEntries={['/queue?status=ready_for_tech']}><POSQueueScreen /></MemoryRouter>);
    await waitFor(() => {
      const urls = (fetchMock as any).mock.calls.map((c: any) => String(c[0]));
      expect(urls.some((u: string) => u.includes('status=ready_for_tech'))).toBe(true);
    });
  });
});

// ── BUILD_PLAN Phase 6 (ai_queue_assignment → complete): every assign says what the board showed (expected technician
// + version), a 409 is explained in plain words, reorder by drag / Move up, locks, parties, per-service technicians and
// the history drawer — all through the real api client against the contract routes.
type P6Call = { url: string; method: string; body?: any };
const p6Items = [
  qItem({ queueItemId: 'q1', customerName: 'Jessica Miller', assignedTechnicianId: 't1', assignedTechnicianName: 'Mia Johnson', status: 'assigned', version: 5 }),
  qItem({ queueItemId: 'q2', customerName: 'Olivia Brown', version: 2, lock: { technicianId: 't2', reason: 'regular of Leo' }, groupId: 'g1' }),
  qItem({ queueItemId: 'q3', customerName: 'Ana Ruiz', version: 9, groupId: 'g1' }),
];
const p6Queue = { ...richQueue, queue: { items: p6Items, pagination: { page: 1, pageSize: 25, totalItems: 3, totalPages: 1 } } };
const p6 = (over: Record<string, (c: P6Call) => any> = {}) => {
  const calls: P6Call[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    const c = { url: u, method, body }; calls.push(c);
    const ok = (j: any, status = 200) => ({ ok: status < 300, status, json: async () => j, headers: { get: () => null } } as any);
    for (const k of Object.keys(over)) if (u.includes(k)) { const r = over[k](c); if (r) return r.status ? ok(r.body, r.status) : ok(r.body ?? r); }
    if (u.includes('/pos/technicians/state')) return ok(roster);
    if (u.includes('/pos/booking/technicians')) return ok(bookingTechPage(u));
    // QueueGroupView (modules/queue) — members, not queueItemIds
    if (u.includes('/pos/queue/groups') && method === 'GET') return ok([{ groupId: 'g1', label: 'Lee bridal party', size: 2, together: true, status: 'waiting', createdAt: new Date().toISOString(), members: [{ queueItemId: 'q2', customerName: 'Olivia Brown', status: 'waiting', assignedTechnicianId: null, assignedTechnicianName: null }, { queueItemId: 'q3', customerName: 'Ana Ruiz', status: 'waiting', assignedTechnicianId: null, assignedTechnicianName: null }] }]);
    if (u.match(/\/pos\/queue\/items\/[^/?]+$/) && method === 'GET') return ok({ queueItemId: u.split('/').pop(), customerName: 'Jessica Miller', version: 5, requestedServices: [{ serviceId: 's1', serviceName: 'Gel Manicure' }, { serviceId: 's2', serviceName: 'Pedicure' }] });
    // GET items/:id/history → { queueItemId, history: QueueHistoryRow[] }
    if (u.includes('/history')) return ok({ queueItemId: 'q1', history: [{ version: 5, fromStatus: 'waiting', toStatus: 'assigned', fromTechnicianId: null, toTechnicianId: 't1', action: 'assign', source: 'ai_suggestion', actorId: 'u1', reason: 'accepted suggestion', createdAt: new Date().toISOString() }] });
    if (u.includes('/pos/queue/state')) return ok(p6Queue);
    return ok({ ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};
const p6sent = (f: any, method: string, frag: string) => (f.calls as P6Call[]).filter((c) => c.method === method && c.url.includes(frag));
const openDrawerFor = async (name: string) => {
  const row = (await screen.findAllByText(name))[0].closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByText('Manage'));
  return screen.getByText('Cancel from Queue').closest('[role="dialog"]') as HTMLElement;   // §19: the Manage overlay (the row never expands)
};

describe('POSQueueScreen — Phase 6: assign sends what the board showed; 409 in plain words', () => {
  it('drawer Assign sends expectedTechnicianId + expectedVersion', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    await pickTech(drawer, 'Assign / reassign technician', 'Leo Chen');
    fireEvent.click(within(drawer).getByText('Assign'));
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q1/assign-technician')[0]?.body).toEqual({ technicianId: 't2', expectedTechnicianId: 't1', expectedVersion: 5 }));
  });

  it('the assign sheet (row "Assign") also sends the expected technician', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const row = (await screen.findAllByText('Ana Ruiz'))[0].closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Assign'));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Queue / Assign' });
    fireEvent.click(within(sheet).getByText('Leo Chen'));
    fireEvent.click(within(sheet).getAllByText('Assign').pop()!);
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q3/assign-technician')[0]?.body).toEqual({ technicianId: 't2', expectedTechnicianId: null, expectedVersion: 9 }));
  });

  it('a 409 says who has the guest now, in plain words', async () => {
    const f = p6({ '/assign-technician': () => ({ status: 409, body: { message: 'This guest was just assigned or changed on another device. The queue has been refreshed.', code: 'VERSION_CONFLICT', currentTechnicianId: 't2', currentVersion: 6, serverTime: new Date().toISOString() } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    await pickTech(drawer, 'Assign / reassign technician', 'Leo Chen');
    fireEvent.click(within(drawer).getByText('Assign'));
    expect(await screen.findByText(/Someone else changed Jessica Miller first — they are now with Leo Chen/)).toBeInTheDocument();
  });

  it('an ASSIGNMENT_LOCKED 409 says who the guest is locked to and why', async () => {
    const f = p6({ '/assign-technician': () => ({ status: 409, body: { message: 'This guest is locked to another technician by a manager.', code: 'ASSIGNMENT_LOCKED', lock: { lockId: 'l1', technicianId: 't2', technicianName: 'Leo Chen', reason: 'regular of Leo', lockedBy: 'u9', expiresAt: null, createdAt: new Date().toISOString() } } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Ana Ruiz');
    await pickTech(drawer, 'Assign / reassign technician', 'Mia Johnson');
    fireEvent.click(within(drawer).getByText('Assign'));
    expect(await screen.findByText('Ana Ruiz is locked to Leo Chen (“regular of Leo”). A manager has to unlock the guest first. Nothing was changed.')).toBeInTheDocument();
  });

  it('Auto Balance apply sends expectedTechnicianId null for each proposal (engine preview)', async () => {
    const withInsight = { ...p6Queue, insights: [{ id: 'i1', text: 'Balance the line', action: 'Auto Balance Queue' }] };
    const f = p6({ '/pos/queue/state': () => ({ body: withInsight }), '/auto-balance/preview': () => ({ body: { proposals: [{ queueItemId: 'q3', technicianId: 't1', technicianName: 'Mia Johnson', confidence: 0.8, reasons: ['Free now'] }], unassignable: [] } }), '/auto-balance/apply': () => ({ body: { applied: 1, failures: [] } }) });
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Auto Balance Queue' }));
    expect(await screen.findByText('Free now')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Apply 1'));
    await waitFor(() => expect(p6sent(f, 'POST', '/auto-balance/apply')[0]?.body).toEqual({ proposals: [{ queueItemId: 'q3', technicianId: 't1', expectedTechnicianId: null, expectedVersion: 9 }] }));
  });
});

describe('POSQueueScreen — Phase 6: reorder, lock, party, per-service technicians, history', () => {
  it('dragging a row onto another reorders the line with expected versions', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    await screen.findAllByText('Ana Ruiz');
    fireEvent.dragStart(screen.getByTestId('queue-row-q3'));
    fireEvent.dragOver(screen.getByTestId('queue-row-q1'));
    fireEvent.drop(screen.getByTestId('queue-row-q1'));
    await waitFor(() => expect(p6sent(f, 'POST', '/pos/queue/reorder')[0]?.body).toEqual({ order: [{ queueItemId: 'q3', expectedVersion: 9 }, { queueItemId: 'q1', expectedVersion: 5 }, { queueItemId: 'q2', expectedVersion: 2 }] }));
  });

  it('Move up (touch path) sends the same reorder', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Olivia Brown');
    fireEvent.click(within(drawer).getByText('Move up'));
    await waitFor(() => expect(p6sent(f, 'POST', '/pos/queue/reorder')[0]?.body.order.map((o: any) => o.queueItemId)).toEqual(['q2', 'q1', 'q3']));
  });

  it('shows the lock badge and the party name; unlock asks for a reason', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const row = await screen.findByTestId('queue-row-q2');
    expect(within(row!).getByText('Locked')).toBeInTheDocument();
    expect(within(row!).getByText('Lee bridal party')).toBeInTheDocument();
    const drawer = await openDrawerFor('Olivia Brown');
    fireEvent.click(within(drawer).getByText('Unlock'));
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'Leo went home' } });
    fireEvent.click(screen.getAllByText('Unlock').pop()!);
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q2/unlock')[0]?.body).toEqual({ reason: 'Leo went home' }));
  });

  it('Lock requires a reason, then posts technicianId null for "nobody"', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Ana Ruiz');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lock' }));
    expect(await screen.findByText('A lock needs a reason.')).toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText('Lock reason'), { target: { value: 'waiting for mom' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q3/lock')[0]?.body).toEqual({ technicianId: null, reason: 'waiting for mom' }));
  });

  it('creates a party from selected guests', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Make a party'));
    fireEvent.click(screen.getByLabelText('Add Jessica Miller to party'));
    fireEvent.click(screen.getByLabelText('Add Ana Ruiz to party'));
    fireEvent.change(screen.getByLabelText('Party name'), { target: { value: 'Miller sisters' } });
    fireEvent.click(screen.getByText('Create party'));
    await waitFor(() => expect(p6sent(f, 'POST', '/pos/queue/groups')[0]?.body).toEqual({ label: 'Miller sisters', queueItemIds: ['q1', 'q3'], together: true }));
  });

  it('the drawer opens the visit plan for a multi-service guest — the per-service PUT is gone', async () => {
    const plan = { recommendationId: 'rec-9', kind: 'visit', party: null, planVersion: 'qa-plan-1', ruleVersion: 'r', recoVersion: 'x', configVersion: null, generatedAt: new Date().toISOString(),
      visit: { queueItemId: 'q3', customerName: 'Ana Ruiz', queueVersion: 9, expectedTechnicianId: null, mode: 'split', leadTechnicianId: 't1', technicianCount: 2, estimatedStartInMinutes: 0, estimatedFinishInMinutes: 45, singleTechnicianAlternative: null, confidence: 0.8, warnings: [], conflicts: [], requiredAction: 'assignable',
        lines: [
          { queueItemId: 'q3', serviceId: 's1', serviceName: 'Gel Manicure', category: 'Manicure', durationMinutes: 30, sequence: 1, technicianId: 't1', technicianName: 'Mia Johnson', expectedTechnicianId: null, timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 30, confidence: 0.8, reasons: [], warnings: [], alternates: [], ineligible: [] },
          { queueItemId: 'q3', serviceId: 's2', serviceName: 'Pedicure', category: 'Pedicure', durationMinutes: 45, sequence: 2, technicianId: 't2', technicianName: 'Leo Chen', expectedTechnicianId: null, timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 45, confidence: 0.8, reasons: [], warnings: [], alternates: [], ineligible: [] },
        ] } };
    const f = p6({ '/entries/q3/plan': () => ({ body: plan }), '/plans/rec-9/decision': () => ({ body: { decision: { id: 'd' }, applied: true, result: null } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Ana Ruiz');
    fireEvent.click(await within(drawer).findByText('Plan technicians per service…'));
    const panel = await screen.findByLabelText('Visit plan for Ana Ruiz');
    expect(await within(panel).findByText('Split across 2 technicians')).toBeInTheDocument();
    fireEvent.click(within(panel).getByText('Accept plan'));
    await waitFor(() => expect(p6sent(f, 'POST', '/plans/rec-9/decision')[0]?.body).toMatchObject({ decision: 'accepted' }));
    expect(((f as any).calls as P6Call[]).some((c) => c.url.includes('service-assignments'))).toBe(false);
  });

  it('a split best match shows the technicians joined with " + " and Assign opens the plan, never a one-technician assign', async () => {
    const split = { ...p6Queue, queue: { ...p6Queue.queue, items: p6Items.map((x: any) => x.queueItemId === 'q3' ? { ...x, bestMatchMode: 'split', bestMatchTechnicianNames: ['Mia Johnson', 'Leo Chen'], bestMatchTechnicianName: 'Mia Johnson' } : x) } };
    const f = p6({ '/pos/queue/state': () => ({ body: split }), '/entries/q3/plan': () => ({ status: 500, body: { message: 'later' } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('Mia Johnson + Leo Chen')).toBeInTheDocument();
    const wrow = screen.getByText('Mia Johnson + Leo Chen').closest('tr') as HTMLElement;
    fireEvent.click(within(wrow).getByText('Assign'));
    expect(await screen.findByLabelText('Visit plan for Ana Ruiz')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add to Queue / Assign' })).toBeNull();
    // the live-queue row "Assign" also opens the plan
    fireEvent.click(within(screen.getByTestId('queue-row-q3')).getByText('Assign'));
    expect(screen.queryByRole('dialog', { name: 'Add to Queue / Assign' })).toBeNull();
    expect(p6sent(f, 'POST', '/assign-technician').length).toBe(0);
  });

  it('the party chip opens the party plan', async () => {
    const f = p6({ '/groups/g1/plan': () => ({ status: 500, body: { message: 'later' } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const row = await screen.findByTestId('queue-row-q2');
    fireEvent.click(within(row).getByText('Lee bridal party'));
    expect(await screen.findByLabelText('Party plan for Lee bridal party')).toBeInTheDocument();
    await waitFor(() => expect(p6sent(f, 'POST', '/ai-queue-assignment/groups/g1/plan').length).toBe(1));
  });

  it('opens the guest history', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    fireEvent.click(within(drawer).getByText('History'));
    expect(await screen.findByText(/waiting → assigned/i)).toBeInTheDocument();
    expect(screen.getByText(/accepted suggestion/)).toBeInTheDocument();
    expect(p6sent(f, 'GET', '/items/q1/history').length).toBe(1);
  });
});

describe('POSQueueScreen — Phase 6: technician availability', () => {
  it('fills "Next" from GET pos/queue/technicians/availability when the board has no label', async () => {
    const withStaff = { ...p6Queue, staff: [{ technicianId: 't1', name: 'Mia Johnson', status: 'Busy' }] };
    const f = p6({ '/pos/queue/state': () => ({ body: withStaff }), '/technicians/availability': () => ({ body: [{ technicianId: 't1', name: 'Mia Johnson', status: 'in_service', availableInMinutes: 15, shiftEndsInMinutes: 200, activeAssignments: 1, onBreak: false, nextAppointmentInMinutes: null }] }) });
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('in 15 min')).toBeInTheDocument();
  });
});

describe('POSQueueScreen — Fair Turn §69: an override of the recommended technician needs a reason', () => {
  it('a MANUAL_OVERRIDE_REASON_REQUIRED 400 asks for the reason inline and the retry sends overrideReasonCode', async () => {
    let n = 0;
    const f = p6({ '/assign-technician': () => (++n === 1 ? { status: 400, body: { message: 'Choose a reason for assigning someone other than the recommended technician.', code: 'MANUAL_OVERRIDE_REASON_REQUIRED' } } : { body: { ok: true } }) }); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    await pickTech(drawer, 'Assign / reassign technician', 'Leo Chen');
    fireEvent.click(within(drawer).getByText('Assign'));
    const reason = await screen.findByLabelText('Override reason');
    fireEvent.click(within(drawer).getByText('Assign'));
    expect(await screen.findByText('Choose why you are assigning someone other than the recommended technician.')).toBeInTheDocument();
    expect(p6sent(f, 'POST', '/assign-technician').length).toBe(1);   // no blind retry without a reason
    fireEvent.change(reason, { target: { value: 'SKILL_MATCH' } });
    fireEvent.click(within(drawer).getByText('Assign'));
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q1/assign-technician')[1]?.body).toEqual({ technicianId: 't2', expectedTechnicianId: 't1', expectedVersion: 5, overrideReasonCode: 'SKILL_MATCH' }));
  });
  it('"Guest declined tech" records the decline for the assigned technician', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    fireEvent.click(within(drawer).getByText('Guest declined tech'));
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    await waitFor(() => expect(p6sent(f, 'POST', '/pos/turn-queue/guest-declined')[0]?.body).toEqual({ queueItemId: 'q1', technicianId: 't1' }));
  });
});

// ── Vietnamese POS mandate leftover (Oct 27 2026): the Customer Queue assign / lock technician dropdowns listed only the
// first 20 technicians of /pos/technicians/state. They are now the server-paged TechnicianPicker (12 a page, server
// search) — proven against a 200-technician salon.
describe('POSQueueScreen — 200 technicians: assign / lock / assign sheet page on the server', () => {
  it('drawer Assign reaches technician #200 by walking pages and by an accent-free search', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Jessica Miller');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Assign / reassign technician' }));
    expect(await screen.findByText('Page 1 of 17')).toBeInTheDocument();
    expect(within(screen.getByTestId('technician-picker')).getAllByRole('option').length).toBe(12);
    for (let i = 1; i < 17; i++) { await screen.findByText(`Page ${i} of 17`, undefined, { timeout: 3000 }); fireEvent.click(screen.getByRole('button', { name: 'Next' })); }
    expect(await screen.findByText('Page 17 of 17')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Nguyễn Thị Hương/ })).toBeInTheDocument();
    // and the server search: "nguyen" finds "Nguyễn"
    fireEvent.change(screen.getByLabelText('Find technician'), { target: { value: 'nguyen' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/booking/technicians') && c.url.includes('search=nguyen'))).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId('technician-picker')).getAllByRole('option').length).toBe(1));   // the search answer: the one match
    fireEvent.click(screen.getByRole('option', { name: /Nguyễn Thị Hương/ }));
    fireEvent.click(within(drawer).getByText('Assign'));
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q1/assign-technician')[0]?.body).toEqual({ technicianId: 't200', expectedTechnicianId: 't1', expectedVersion: 5 }));
    // the roster read is never the source of the choices any more
    expect((f as any).calls.filter((c: any) => c.url.includes('/pos/booking/technicians') && c.url.includes('pageSize=12')).length).toBeGreaterThan(0);
  });

  it('Lock to a technician beyond the first page', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const drawer = await openDrawerFor('Ana Ruiz');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lock to' }));
    fireEvent.change(await screen.findByLabelText('Find technician'), { target: { value: '150' } });
    fireEvent.click(await screen.findByRole('option', { name: /Tech 150/ }, { timeout: 2000 }));
    fireEvent.change(within(drawer).getByLabelText('Lock reason'), { target: { value: 'regular' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q3/lock')[0]?.body).toEqual({ technicianId: 't150', reason: 'regular' }));
  });

  it('the assign sheet pages on the server too (17 pages of 12)', async () => {
    const f = p6(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSQueueScreen /></MemoryRouter>);
    const row = (await screen.findAllByText('Ana Ruiz'))[0].closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Assign'));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Queue / Assign' });
    expect(await within(sheet).findByText('Page 1 of 17')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Find technician'), { target: { value: 'nguyen' } });
    fireEvent.click(await within(sheet).findByRole('option', { name: /Nguyễn Thị Hương/ }, { timeout: 2000 }));
    fireEvent.click(within(sheet).getAllByText('Assign').pop()!);
    await waitFor(() => expect(p6sent(f, 'POST', '/items/q3/assign-technician')[0]?.body).toEqual({ technicianId: 't200', expectedTechnicianId: null, expectedVersion: 9 }));
  });
});
