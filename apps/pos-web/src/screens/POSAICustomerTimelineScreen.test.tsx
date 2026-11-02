// POSAICustomerTimelineScreen — Customer Timeline guide (Nov 1 2026). The title, subtitle, search box and Search button stay;
// nothing is shown before a customer is chosen from real search results; the summary is Customer Search's profile; events are
// grouped by visit, newest first, with role-hidden amounts; filters and pages are server queries; the detail overlay opens
// the owning module; unknown source statuses fall back to their family label; the check shows each area in the POS language.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { cs, tlApi, navigate } = vi.hoisted(() => ({
  cs: { customers: vi.fn(), profile: vi.fn() }, tlApi: { events: vi.fn(), event: vi.fn(), check: vi.fn() }, navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: cs }));
vi.mock('../api/posCustomerTimelineApi', () => ({ posCustomerTimelineApi: tlApi }));
import { POSAICustomerTimelineScreen, eventLabel } from './POSAICustomerTimelineScreen';

const C1 = 'c1111111-0000-4000-8000-000000000001';
const MATCHES = { items: [{ id: C1, name: 'Nguyễn Thị Hằng', phone: '(•••) •••-0101', email: null, visits: 3, lastVisitAt: '2026-11-01T15:00:00Z', createdAt: '2025-01-05T15:00:00Z', sharedContactProfiles: 0 },
  { id: 'c2', name: 'Hang Nguyen', phone: '(•••) •••-0101', email: null, visits: 0, lastVisitAt: null, createdAt: '2026-02-01T15:00:00Z', sharedContactProfiles: 1 }], total: 2, pageCount: 1 };
const PROFILE = { identity: { id: C1, name: 'Nguyễn Thị Hằng', phone: '(•••) •••-0101', email: null, archivedAt: null }, visits: { completed: 3, firstAt: '2024-11-01T15:00:00Z', lastAt: '2026-11-01T15:00:00Z' },
  appointments: { upcoming: [{ id: 'a9', date: '2026-11-09', time: '09:00' }], history: [] }, preferences: { technician: { name: 'Lan Nguyễn' } }, loyalty: { enrolled: true, points: 65, tier: null },
  memberships: [], sources: { visits: 'ok', booking: 'ok', services: 'ok', loyalty: 'ok', memberships: 'unavailable' } };
const EV = (o: any) => ({ family: 'visit', occurredAt: '2026-11-02T15:00:00Z', recordedAt: '2026-11-02T15:00:00Z', refId: 't1', status: 'paid', branch: { id: 'b1', name: 'Main' }, technician: null, amountCents: null, amountHidden: false, appointmentDate: null, meta: {}, source: 'ticket', ...o });
const EVENTS = { items: [
  EV({ id: 'ticket:t1:completed', type: 'visit_completed', groupRef: 'ticket:t1', amountHidden: true, meta: { ticketNumber: 4101 } }),
  EV({ id: 'pay:p1', type: 'payment_approved', family: 'money', groupRef: 'ticket:t1', amountHidden: true, source: 'pay', meta: { ticketNumber: 4101 } }),
  EV({ id: 'loyalty:l1', type: 'loyalty_earn', family: 'benefit', groupRef: 'ticket:t1', meta: { points: 65 }, source: 'loyalty' }),
  EV({ id: 'appt:a9:booked', type: 'appointment_booked', family: 'appointment', groupRef: 'appt:a9', appointmentDate: '2026-11-09', source: 'appt' }),
  EV({ id: 'membership:m1', type: 'membership_something_new', family: 'benefit', groupRef: 'membership:mm', source: 'membership' }),
], total: 5, page: 1, pageSize: 25, totalPages: 1, applied: { sort: 'newest' }, period: { today: '2026-11-02' }, freshness: { newestActivityAt: '2026-11-02T15:00:00Z', lastRecordedAt: '2026-11-02T15:00:00Z', readAt: '2026-11-02T15:05:00Z' }, visibility: { money: false } };
const mount = (url = '/tenant/ai/customer-profile/timeline') => render(<MemoryRouter initialEntries={[url]}><POSAICustomerTimelineScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(cs), ...Object.values(tlApi), navigate]) f.mockReset();
  cs.customers.mockResolvedValue(MATCHES); cs.profile.mockResolvedValue(PROFILE); tlApi.events.mockResolvedValue(EVENTS);
});

describe('POSAICustomerTimelineScreen', () => {
  it('keeps title, subtitle, search box and Search; shows the search-first state and loads no history before a choice', async () => {
    mount();
    expect(screen.getByText('Customer Timeline')).toBeInTheDocument();
    expect(screen.getByTestId('tlx-search-btn')).toHaveTextContent('Search');
    expect(screen.getByText(/Search for a customer by name, phone or email/)).toBeInTheDocument();
    expect(tlApi.events).not.toHaveBeenCalled(); expect(cs.profile).not.toHaveBeenCalled();
  });

  it('search lists separate records (similar names / shared phone stay separate); choosing one loads its summary and timeline', async () => {
    mount();
    fireEvent.change(screen.getByTestId('tlx-search'), { target: { value: '609-555-0101' } });
    fireEvent.click(screen.getByTestId('tlx-search-btn'));
    await waitFor(() => expect(cs.customers).toHaveBeenCalledWith({ q: '609-555-0101', page: 1, pageSize: 10 }));
    expect(await screen.findAllByTestId('tlx-match')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('tlx-select')[0]);
    await waitFor(() => expect(cs.profile).toHaveBeenCalledWith(C1));
    await waitFor(() => expect(tlApi.events).toHaveBeenCalledWith(C1, expect.objectContaining({ page: 1, pageSize: 25 })));
    expect(await screen.findByTestId('tlx-kpi-points')).toHaveTextContent('65');
    expect(screen.getByTestId('tlx-partial')).toHaveTextContent(/memberships/);          // unavailable is said, never shown as zero
  });

  it('groups one visit\'s events together, hides amounts for the role, and labels an unfamiliar status by its family', async () => {
    mount(`/tenant/ai/customer-profile/timeline?customer=${C1}`);
    const groups = await screen.findAllByTestId('tlx-group');
    expect(within(groups[0]).getByText('Visit · ticket #4101')).toBeInTheDocument();
    expect(within(groups[0]).getAllByTestId('tlx-event')).toHaveLength(3);
    expect(within(groups[0]).getAllByText('Amount hidden')).toHaveLength(2);
    expect(within(groups[0]).getByText('65 pts')).toBeInTheDocument();
    expect(screen.getByText('Benefits update')).toBeInTheDocument();
    expect(eventLabel('appointment_no_show', 'appointment')).toBe('No-show');
  });

  it('category, date preset, sort, page size and search-inside are server queries that reset to page 1', async () => {
    mount(`/tenant/ai/customer-profile/timeline?customer=${C1}&page=3`);
    await screen.findAllByTestId('tlx-group');
    fireEvent.click(screen.getByTestId('fam-money'));
    await waitFor(() => expect(tlApi.events).toHaveBeenLastCalledWith(C1, expect.objectContaining({ family: 'money', page: 1 })));
    fireEvent.click(screen.getByTestId('preset-last_90'));
    await waitFor(() => expect(tlApi.events).toHaveBeenLastCalledWith(C1, expect.objectContaining({ preset: 'last_90' })));
    fireEvent.change(screen.getByTestId('flt-sort'), { target: { value: 'recently_added' } });
    await waitFor(() => expect(tlApi.events).toHaveBeenLastCalledWith(C1, expect.objectContaining({ sort: 'recently_added' })));
    fireEvent.change(screen.getByTestId('tlx-inner'), { target: { value: 'gel' } });
    fireEvent.submit(screen.getByTestId('tlx-inner').closest('form')!);
    await waitFor(() => expect(tlApi.events).toHaveBeenLastCalledWith(C1, expect.objectContaining({ q: 'gel' })));
    fireEvent.change(screen.getByTestId('tlx-pagesize'), { target: { value: '50' } });
    await waitFor(() => expect(tlApi.events).toHaveBeenLastCalledWith(C1, expect.objectContaining({ pageSize: 50 })));
  });

  it('the detail overlay re-reads the event, shows the visit\'s services and technicians, and opens the owning module', async () => {
    tlApi.event.mockResolvedValue({ event: EVENTS.items[1], visit: { ticketId: 't1', ticketNumber: 4101, checkedInAt: null, startedAt: null, serviceDoneAt: null, paidAt: null, totals: null,
      services: [{ id: 'l1', service: 'Gel Manicure', technician: 'Lan Nguyễn', minutes: 45 }, { id: 'l2', service: 'Nail Art', technician: 'Mai Ho', minutes: 20 }], technicians: ['Lan Nguyễn', 'Mai Ho'] } });
    mount(`/tenant/ai/customer-profile/timeline?customer=${C1}`);
    fireEvent.click((await screen.findAllByTestId('tlx-event'))[1]);
    await waitFor(() => expect(tlApi.event).toHaveBeenCalledWith(C1, 'pay:p1'));
    expect(await screen.findAllByTestId('ov-service')).toHaveLength(2);
    expect(screen.queryByTestId('ov-total')).toBeNull();                                  // totals hidden for the role
    fireEvent.click(screen.getByTestId('ov-checkout'));
    expect(navigate).toHaveBeenCalledWith('/tenant/payments/transactions?ticket=t1');
  });

  it('Check Customer Timeline System shows each area in the POS language', async () => {
    tlApi.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [
      { key: 'duplicates', state: 'WARNING', count: 2 }, { key: 'tenant_isolation', state: 'PASSED', count: 0 }] });
    mount();
    fireEvent.click(screen.getByTestId('tlx-check'));
    expect(await screen.findByTestId('chk-duplicates-state')).toHaveTextContent('Warning');
    expect(screen.getByTestId('chk-duplicates')).toHaveTextContent(/Nothing is merged automatically/);
    expect(screen.getByTestId('chk-tenant_isolation-state')).toHaveTextContent('Passed');
  });
});
