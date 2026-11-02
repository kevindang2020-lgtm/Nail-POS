// POSAICustomerRecommendationsScreen — Service Recommendations guide (Nov 1 2026). Title, description, search box and Search
// stay; the page opens on the queue (no more blank area); with nothing evaluated it says Data Unavailable (not zero); the
// reason and price are localized from numbers and today's catalog; cards, tabs and filters are server queries; Refresh is
// one evaluation; the overlay shows catalog, add-ons and qualified technicians; "Open AI Booking Assistant" only stores a
// prefill and opens POS → Booking; an already-booked refusal is shown; no booking button without booking permission.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { sr, store, cat, navigate, perms } = vi.hoisted(() => ({
  sr: { summary: vi.fn(), list: vi.fn(), detail: vi.fn(), review: vi.fn(), handoff: vi.fn(), history: vi.fn(), scans: vi.fn(), refresh: vi.fn(), check: vi.fn() },
  store: vi.fn(), cat: { services: vi.fn() }, navigate: vi.fn(), perms: { deny: [] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posServiceRecommendationsApi', () => ({ posServiceRecommendationsApi: sr }));
vi.mock('../api/posRebookingApi', () => ({ storeBookingHandoff: store }));
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: cat }));
vi.mock('../components/TechnicianPickerButton', () => ({ TechnicianPickerButton: ({ emptyLabel }: any) => <button type="button">{emptyLabel}</button> }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAICustomerRecommendationsScreen } from './POSAICustomerRecommendationsScreen';

const SUM = { metrics: { recommendations: 4, customersWithRecommendations: 3, customersEvaluated: 6, needsReview: 3, recentlyReviewed: 0, associatedBookings: 1, insufficientHistory: 2, neverServed: 1 },
  unavailable: false, freshness: { state: 'up_to_date', lastEvaluatedAt: '2026-11-02T14:00:00Z' } };
const ROW = { id: 'r1', customerId: 'c1', name: 'Ann An', phone: '(•••) •••-0111', type: 'repeat_service', confidence: 'high', state: 'needs_review',
  evidence: { timesCompleted: 3, lastCompletedAt: '2026-10-28T15:00:00Z' }, service: { id: 's1', name: 'Gel Manicure', active: true, priceCents: 4500, durationMinutes: 45, branch: 'Main' },
  technician: { name: 'Lan Nguyễn', active: true }, lastService: 'Gel Manicure', lastVisitAt: '2026-10-28T15:00:00Z', booking: { thisService: false, nextAnyDate: '2026-11-05', associated: false },
  generatedAt: '2026-11-02T14:00:00Z', review: null };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, unavailable: false, period: { today: '2026-11-02' }, freshness: { lastEvaluatedAt: '2026-11-02T14:00:00Z' } };
const DETAIL = { id: 'r1', customerId: 'c1', state: 'needs_review', status: 'open', type: 'repeat_service', confidence: 'high', identity: { id: 'c1', name: 'Ann An', phone: '(•••) •••-0111', email: null },
  evidence: { timesCompleted: 3, lastCompletedAt: '2026-10-28T15:00:00Z' },
  service: { id: 's1', name: 'Gel Manicure', category: 'Manicure', description: 'Long-wear gel polish', active: true, priceCents: 4900, durationMinutes: 45, branch: 'Main', addOns: [{ name: 'Chrome finish', priceCents: 1000, durationDeltaMinutes: 10 }] },
  technicians: { qualified: [{ id: 't1', name: 'Lan Nguyễn', primary: true }], qualifiedTotal: 1, preferred: { id: 't1', name: 'Lan Nguyễn', active: true, qualified: true } },
  history: { visits: [], frequency: [{ serviceId: 's1', service: 'Gel Manicure', count: 3, lastAt: '2026-10-28T15:00:00Z' }] }, bookings: [], memberships: [], otherRecommendations: [],
  outcome: { associatedBooking: false }, caveats: ['availability_not_checked'], generatedAt: '2026-11-02T14:00:00Z', evaluatedAt: '2026-11-02T14:00:00Z', ruleVersion: 'sr-2026-11-02', review: null, activity: [] };
const mount = () => render(<MemoryRouter initialEntries={['/tenant/ai/customer-profile/recommendations']}><POSAICustomerRecommendationsScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(sr), store, cat.services, navigate]) f.mockReset();
  perms.deny = [];
  sr.summary.mockResolvedValue(SUM); sr.list.mockResolvedValue(LIST); sr.detail.mockResolvedValue(DETAIL);
  cat.services.mockResolvedValue({ items: [{ serviceId: 's1', name: 'Gel Manicure' }, { serviceId: 's2', name: 'Spa Pedicure' }] });
});

describe('POSAICustomerRecommendationsScreen', () => {
  it('keeps the title, description, search box and Search; opens on the queue with six cards and a localized reason', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Service Recommendations' })).toBeInTheDocument();
    expect(screen.getByText(/Suggestions from real visit history and your active services/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name, phone, or email')).toBeInTheDocument();
    expect(screen.getByTestId('srx-search-btn')).toHaveTextContent('Search');
    expect(await screen.findByTestId('kpi-needs')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-evaluated')).toHaveTextContent('6');
    expect(screen.getByTestId('kpi-insufficient')).toHaveTextContent('2');
    expect((await screen.findAllByTestId('srx-reason'))[0]).toHaveTextContent("Completed 3 times — the customer's most frequent service");
    expect(screen.getAllByTestId('srx-price')[0]).toHaveTextContent('45 min');
    expect(screen.getAllByTestId('srx-booking')[0]).toHaveTextContent('Other booking 2026-11-05');
    expect(sr.list).toHaveBeenCalledWith(expect.objectContaining({ tab: 'needs_review', page: 1, pageSize: 25 }));
  });

  it('with nothing evaluated it says Data Unavailable, never zero; Refresh runs one evaluation', async () => {
    sr.summary.mockResolvedValue({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    sr.list.mockResolvedValue({ items: [], total: 0, unavailable: true });
    sr.refresh.mockResolvedValue({ reused: false, scan: { customersEvaluated: 6, generated: 4 } });
    mount();
    expect(await screen.findByTestId('srx-unavailable')).toHaveTextContent(/not "no recommendations"/);
    expect(screen.getByTestId('kpi-needs')).toHaveTextContent('Unavailable');
    fireEvent.click(screen.getByTestId('srx-refresh'));
    expect(await screen.findByTestId('srx-notice')).toHaveTextContent('Evaluation finished: 6 customers, 4 suggestions.');
  });

  it('tabs, type, service, sort and dates drive server queries (page resets to 1)', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('tab-booked'));
    await waitFor(() => expect(sr.list).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'booked', page: 1 })));
    fireEvent.change(screen.getByTestId('flt-type'), { target: { value: 'previously_preferred' } });
    await waitFor(() => expect(sr.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'previously_preferred' })));
    fireEvent.change(await screen.findByTestId('flt-service'), { target: { value: 's2' } });
    await waitFor(() => expect(sr.list).toHaveBeenLastCalledWith(expect.objectContaining({ serviceId: 's2' })));
    fireEvent.change(screen.getByTestId('flt-sort'), { target: { value: 'recently_reviewed' } });
    await waitFor(() => expect(sr.list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'recently_reviewed' })));
    fireEvent.change(screen.getByTestId('flt-datefield'), { target: { value: 'booking' } });
    fireEvent.click(screen.getByTestId('preset-month'));
    await waitFor(() => expect(sr.list).toHaveBeenLastCalledWith(expect.objectContaining({ dateField: 'booking', preset: 'month' })));
  });

  it('the overlay shows today\'s price, add-ons and qualified technicians; Open AI Booking Assistant only stores a prefill', async () => {
    sr.handoff.mockResolvedValue({ customerId: 'c1', customerName: 'Ann An', customerPhone: null, serviceId: 's1', technicianId: 't1', technicianName: 'Lan Nguyễn', date: '2026-11-02', preparedAt: '2026-11-02T15:00:00Z' });
    mount();
    fireEvent.click((await screen.findAllByTestId('srx-view'))[0]);
    expect(await screen.findByTestId('ov-price')).toHaveTextContent('49');
    expect(screen.getByTestId('ov-addons')).toHaveTextContent('Chrome finish');
    expect(screen.getByTestId('ov-technicians')).toHaveTextContent('1 active technician(s) qualified for this service: Lan Nguyễn');
    expect(screen.getByTestId('ov-note')).toHaveTextContent(/not a booking, a purchase requirement or revenue/);
    fireEvent.click(screen.getByTestId('srx-book'));
    await waitFor(() => expect(sr.handoff).toHaveBeenCalledWith('r1', { technicianId: 't1' }));
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ source: 'recommendation', serviceId: 's1', technicianId: 't1' }));
    expect(navigate).toHaveBeenCalledWith('/booking?date=2026-11-02&recommendation=1');
    expect(sr.review).not.toHaveBeenCalled();
  });

  it('the same service already booked is refused with the date; nothing stored; Not applicable sends only the review', async () => {
    sr.handoff.mockRejectedValue({ status: 409, body: { code: 'SR_ALREADY_BOOKED', details: { nextAppointmentDate: '2026-11-06' } } });
    sr.review.mockResolvedValue({ id: 'r1', action: 'not_applicable' });
    mount();
    fireEvent.click((await screen.findAllByTestId('srx-view'))[0]);
    fireEvent.click(await screen.findByTestId('srx-book'));
    expect(await screen.findByTestId('srx-act-err')).toHaveTextContent('already booked for the customer (2026-11-06)');
    expect(store).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('srx-na'));
    await waitFor(() => expect(sr.review).toHaveBeenCalledWith('r1', { action: 'not_applicable', expectedVersion: 0 }));
  });

  it('no booking button without booking permission', async () => {
    perms.deny = ['pos.booking.create'];
    mount();
    fireEvent.click((await screen.findAllByTestId('srx-view'))[0]);
    expect(await screen.findByTestId('srx-mark-reviewed')).toBeInTheDocument();
    expect(screen.queryByTestId('srx-book')).toBeNull();
  });

  it('Check Service Recommendations System renders localized evidence', async () => {
    sr.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T14:05:00Z', reused: false, checks: [
      { key: 'technician_qualifications', state: 'WARNING', count: 1 }, { key: 'records_reconcile', state: 'PASSED', count: 4 }] });
    mount();
    fireEvent.click(screen.getByTestId('srx-check'));
    expect(await screen.findByTestId('chk-technician_qualifications')).toHaveTextContent('no active qualified technician');
    expect(screen.getByTestId('chk-records_reconcile-state')).toHaveTextContent('Passed');
  });
});
