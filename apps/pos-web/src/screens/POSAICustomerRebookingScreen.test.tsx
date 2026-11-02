// POSAICustomerRebookingScreen — Rebooking Opportunities guide (Nov 1 2026). Title, advisory line, search box and Search
// stay; the page opens on the review queue (no more blank area); with nothing evaluated it says Data Unavailable (not zero);
// cards, tabs, service filter and dates are server queries; the 360° overlay shows evidence; "Open AI Booking Assistant"
// asks the server for the handoff, stores the prefill and opens POS → Booking — it never books; an Already-booked refusal is
// shown; a role without booking permission gets no booking button; the check renders in the POS language.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { rb, store, cat, navigate, perms } = vi.hoisted(() => ({
  rb: { summary: vi.fn(), customers: vi.fn(), customer: vi.fn(), review: vi.fn(), handoff: vi.fn(), history: vi.fn(), check: vi.fn(), refresh: vi.fn() },
  store: vi.fn(), cat: { services: vi.fn() }, navigate: vi.fn(), perms: { deny: [] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posRebookingApi', () => ({ posRebookingApi: rb, storeBookingHandoff: store }));
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: cat }));
vi.mock('../components/TechnicianPickerButton', () => ({ TechnicianPickerButton: ({ emptyLabel }: any) => <button type="button">{emptyLabel}</button> }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAICustomerRebookingScreen } from './POSAICustomerRebookingScreen';

const SUM = { metrics: { evaluated: 7, opportunities: 4, dueForReview: 3, comingDue: 1, reviewed: 0, alreadyBooked: 1, bookedSinceEvaluation: 0, insufficientHistory: 1 }, unavailable: false,
  freshness: { state: 'up_to_date', lastEvaluatedAt: '2026-11-02T14:00:00Z' } };
const ROW = { id: 'c1', name: 'Dee Due', phone: '(•••) •••-0101', state: 'due', opportunitySince: '2026-11-02T14:00:00Z', lastVisitAt: '2026-09-23T15:00:00Z', typicalIntervalDays: 30, completedVisits: 3,
  window: { dueOn: '2026-10-23', endsOn: '2026-11-07' }, lastService: 'Gel Manicure', lastTechnician: 'Lan Nguyễn', suggestedService: { id: 's1', name: 'Gel Manicure', active: true, priceCents: 4500, durationMinutes: 45 },
  booking: { upcoming: false, nextDate: null, bookedSinceEvaluation: false }, review: null };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, unavailable: false, period: { today: '2026-11-02' }, freshness: { lastEvaluatedAt: '2026-11-02T14:00:00Z' } };
const OV = { customerId: 'c1', identity: { id: 'c1', name: 'Dee Due', phone: '(•••) •••-0101', email: null, branch: 'Main' },
  recommendation: { state: 'due', reason: 'Past normal return window (due_for_return)', evidence: ['40 days since last visit vs a ~30-day norm'], opportunitySince: '2026-11-02T14:00:00Z', completedVisits: 3,
    firstVisitAt: '2026-07-25T15:00:00Z', lastVisitAt: '2026-09-23T15:00:00Z', typicalIntervalDays: 30, window: { dueOn: '2026-10-23', endsOn: '2026-11-07' }, minVisitsForCadence: 3 },
  suggestedService: { id: 's1', name: 'Gel Manicure', active: true, priceCents: 4500, durationMinutes: 45 }, technician: { id: 't1', name: 'Lan Nguyễn', visits: 3, of: 3, preferred: true, active: true },
  completedServices: [{ ticketId: 'k1', at: '2026-09-23T15:00:00Z', lines: [{ service: 'Gel Manicure', technician: 'Lan Nguyễn' }] }], bookings: [], memberships: [], caveats: [],
  rule: { version: 'ci-2026-11-02c', evaluatedAt: '2026-11-02T14:00:00Z' }, review: null, history: [] };
const mount = () => render(<MemoryRouter initialEntries={['/tenant/ai/customer-profile/rebooking']}><POSAICustomerRebookingScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(rb), store, cat.services, navigate]) f.mockReset();
  perms.deny = [];
  rb.summary.mockResolvedValue(SUM); rb.customers.mockResolvedValue(LIST); rb.customer.mockResolvedValue(OV);
  cat.services.mockResolvedValue({ items: [{ serviceId: 's1', name: 'Gel Manicure' }, { serviceId: 's2', name: 'Pedicure' }] });
});

describe('POSAICustomerRebookingScreen', () => {
  it('keeps the title, advisory line, search box and Search; opens on the review queue with the cards', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Rebooking Opportunities' })).toBeInTheDocument();
    expect(screen.getByText(/booking always goes through the AI Booking Assistant/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name, phone, or email')).toBeInTheDocument();
    expect(screen.getByTestId('rbx-search-btn')).toHaveTextContent('Search');
    expect(await screen.findByTestId('kpi-due')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-opportunities')).toHaveTextContent('4');
    expect((await screen.findAllByTestId('rbx-row'))[0]).toHaveTextContent('Dee Due');
    expect(rb.customers).toHaveBeenCalledWith(expect.objectContaining({ tab: 'due_for_review', page: 1, pageSize: 25 }));
  });

  it('with nothing evaluated it says Data Unavailable, never zero', async () => {
    rb.summary.mockResolvedValue({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    rb.customers.mockResolvedValue({ items: [], total: 0, unavailable: true });
    mount();
    expect(await screen.findByTestId('rbx-unavailable')).toHaveTextContent(/not "zero opportunities"/);
    expect(screen.getByTestId('kpi-due')).toHaveTextContent('Unavailable');
  });

  it('cards, tabs, the service filter, sort and dates drive server queries (page resets to 1)', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('kpi-booked'));
    await waitFor(() => expect(rb.customers).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'booked', page: 1 })));
    fireEvent.click(screen.getByTestId('tab-coming_due'));
    await waitFor(() => expect(rb.customers).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'coming_due' })));
    fireEvent.change(await screen.findByTestId('flt-service'), { target: { value: 's2' } });
    await waitFor(() => expect(rb.customers).toHaveBeenLastCalledWith(expect.objectContaining({ serviceId: 's2' })));
    fireEvent.change(screen.getByTestId('flt-sort'), { target: { value: 'most_overdue' } });
    await waitFor(() => expect(rb.customers).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'most_overdue' })));
    fireEvent.change(screen.getByTestId('flt-datefield'), { target: { value: 'suggested_return' } });
    fireEvent.click(screen.getByTestId('preset-last_30'));
    await waitFor(() => expect(rb.customers).toHaveBeenLastCalledWith(expect.objectContaining({ dateField: 'suggested_return', preset: 'last_30' })));
  });

  it('the overlay shows evidence; Open AI Booking Assistant only prepares a prefill and opens POS → Booking', async () => {
    rb.handoff.mockResolvedValue({ customerId: 'c1', customerName: 'Dee Due', customerPhone: null, serviceId: 's1', technicianId: 't1', technicianName: 'Lan Nguyễn', date: '2026-11-02', preparedAt: '2026-11-02T15:00:00Z' });
    mount();
    fireEvent.click((await screen.findAllByTestId('rbx-view'))[0]);
    expect(await screen.findByTestId('ov-note')).toHaveTextContent(/not a booking, a visit or revenue/);
    expect(screen.getByTestId('ov-window')).toHaveTextContent('2026-10-23 to 2026-11-07');
    expect(screen.getByTestId('ov-tech')).toHaveTextContent('Lan Nguyễn · 3 of 3 visits (preferred)');
    fireEvent.click(screen.getByTestId('rbx-book'));
    await waitFor(() => expect(rb.handoff).toHaveBeenCalledWith('c1', { serviceId: 's1', technicianId: 't1' }));
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ source: 'rebooking', customerId: 'c1', serviceId: 's1', date: '2026-11-02' }));
    expect(navigate).toHaveBeenCalledWith('/booking?date=2026-11-02&rebook=1');
    expect(rb.review).not.toHaveBeenCalled();
  });

  it('a booking made since the evaluation is refused with the date; nothing is stored', async () => {
    rb.handoff.mockRejectedValue({ status: 409, body: { code: 'REBOOKING_ALREADY_BOOKED', details: { nextAppointmentDate: '2026-11-06' } } });
    mount();
    fireEvent.click((await screen.findAllByTestId('rbx-view'))[0]);
    fireEvent.click(await screen.findByTestId('rbx-book'));
    expect(await screen.findByTestId('rbx-act-err')).toHaveTextContent('already has an upcoming appointment (2026-11-06)');
    expect(store).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a role without booking permission sees the review actions but no booking button', async () => {
    perms.deny = ['pos.booking.create'];
    mount();
    fireEvent.click((await screen.findAllByTestId('rbx-view'))[0]);
    expect(await screen.findByTestId('rbx-mark-reviewed')).toBeInTheDocument();
    expect(screen.queryByTestId('rbx-book')).toBeNull();
  });

  it('Check Rebooking System renders localized evidence, never the server\'s English', async () => {
    rb.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T14:05:00Z', reused: false, checks: [
      { key: 'bookings_since_evaluation', state: 'WARNING', count: 1 }, { key: 'intelligence_agreement', state: 'PASSED', count: 4 }] });
    mount();
    fireEvent.click(screen.getByTestId('rbx-check'));
    expect(await screen.findByTestId('chk-intelligence_agreement')).toHaveTextContent('equal the Rebooking card on Customer Intelligence');
    expect(screen.getByTestId('chk-bookings_since_evaluation-state')).toHaveTextContent('Warning');
  });
});
