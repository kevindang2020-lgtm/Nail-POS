// Appointment History SUNMI guide (Nov 9 2026): six cards over the filters, the salon-wide table, details → the customer's own
// history (money details), and the read-only system check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const m = vi.hoisted(() => ({ summary: vi.fn(), list: vi.fn(), options: vi.fn(), check: vi.fn(), appts: vi.fn(), quick: vi.fn() }));
vi.mock('../api/posAppointmentHistoryApi', () => ({ posAppointmentHistoryApi: { summary: m.summary, list: m.list, options: m.options, check: m.check } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: m.quick, appointments: m.appts } }));
import { POSAppointmentHistoryScreen, nextFutureAppointment } from './POSAppointmentHistoryScreen';

const row = { id: 'p1', date: '2026-11-12', startTime: '10:00', endTime: '11:00', durationMinutes: 60, customerId: 'c1', customer: 'Ana Rivera', phone: '555-1234',
  services: 'Gel Manicure, Pedicure', technician: 'Ben', anyTechnician: false, branch: 'Main', status: 'booked', source: 'online', rescheduled: 2,
  createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z', completedAt: null, canceledAt: null };
const listOf = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, applied: { q: null, status: 'all', dateField: 'scheduled', sort: 'newest', preset: 'all', from: null, to: null }, period: { today: '2026-11-09', timeZone: 'UTC' } });
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.summary.mockResolvedValue({ cards: { appointments: 12, upcoming: 3, completed: 6, canceled: 1, noShows: 1, rescheduled: 2 } });
  m.list.mockResolvedValue(listOf([row]));
  m.options.mockResolvedValue({ technicians: [{ id: 't1', name: 'Ben' }] });
  m.quick.mockResolvedValue({ items: [] });
});

describe('Appointment History workspace', () => {
  it('shows the six cards and the table', async () => {
    render(<POSAppointmentHistoryScreen />);
    for (const k of ['appointments', 'upcoming', 'completed', 'canceled', 'noshows', 'rescheduled']) expect(await screen.findByTestId(`ahx-kpi-${k}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ahx-kpi-appointments').textContent).toContain('12'));
    const r = await screen.findByTestId('ahx-row');
    expect(within(r).getByText('Ana Rivera')).toBeInTheDocument();
    expect(within(r).getByTestId('ahx-row-moved').textContent).toMatch(/2/);
  });
  it('a card filters the table; the summary ignores status and sort', async () => {
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-kpi-upcoming'));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'upcoming', sort: 'upcoming', page: 1 })));
    fireEvent.change(screen.getByTestId('ahx-technician'), { target: { value: 't1' } });
    await waitFor(() => expect(m.summary).toHaveBeenLastCalledWith(expect.objectContaining({ technician: 't1' })));
    expect(m.summary.mock.calls[m.summary.mock.calls.length - 1][0]).not.toHaveProperty('status');
  });
  it('details open the customer history with money details', async () => {
    m.appts.mockResolvedValue([{ appointmentId: 'a1', startsAt: '2026-07-01T15:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Ben', status: 'completed' }]);
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    const d = await screen.findByTestId('ahx-detail');
    expect(within(d).getByText('Gel Manicure, Pedicure')).toBeInTheDocument();
    fireEvent.click(within(d).getByTestId('ahx-detail-customer'));
    await waitFor(() => expect(m.appts).toHaveBeenCalledWith('c1'));
    expect(await within(await screen.findByTestId('ahx-customer')).findByText('Gel Manicure')).toBeInTheDocument();
  });
  it('runs the read-only system check', async () => {
    m.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-09T10:00:00Z', checks: [{ key: 'past_open_appointments', state: 'WARNING', count: 4 }, { key: 'no_side_effects', state: 'READY' }] });
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-check'));
    const h = await screen.findByTestId('ahx-health');
    expect(await within(h).findByTestId('ahx-chk-past_open_appointments')).toBeInTheDocument();
    expect(within(h).getByText(/before today are still booked/)).toBeInTheDocument();
  });
  it('Appointment History 04: details list the recorded changes — original → new, who, which path — with statuses labelled and ids never raw', async () => {
    m.list.mockResolvedValue(listOf([{ ...row, changes: [
      { id: 'h2', changeType: 'status_changed', field: 'status', oldValue: 'booked', newValue: 'cancelled', actor: 'Dana Desk', actorType: 'user', source: 'online', at: '2026-11-03T15:00:00Z' },
      { id: 'h1', changeType: 'assigned', field: 'technician_id', oldValue: null, newValue: '0b5e7a8c-1111-4222-8333-444455556666', actor: null, actorType: 'system', source: null, at: '2026-11-02T15:00:00Z' },
      { id: 'h0', changeType: 'rescheduled', field: 'start_time', oldValue: '09:00', newValue: '10:00', actor: null, actorType: null, source: null, at: '2026-11-01T15:00:00Z' }] }]));
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    const d = await screen.findByTestId('ahx-detail');
    const rows = within(d).getAllByTestId('ahx-change');
    expect(rows[0]).toHaveTextContent('Status changed · Status · Booked → Cancel'); expect(rows[0]).toHaveTextContent('Dana Desk');
    expect(rows[1]).toHaveTextContent('Technician assigned · Technician · — → (a record)'); expect(rows[1]).toHaveTextContent('System');
    expect(rows[1].textContent).not.toContain('0b5e7a8c');
    expect(rows[2]).toHaveTextContent('Rescheduled · Start time · 09:00 → 10:00'); expect(rows[2]).toHaveTextContent('Not recorded');
  });
  it('Appointment History 04: no recorded change says so; an older server without changes shows nothing', async () => {
    m.list.mockResolvedValue(listOf([{ ...row, changes: [] }]));
    const { unmount } = render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    expect(await screen.findByTestId('ahx-changes-none')).toBeInTheDocument();
    unmount(); m.list.mockResolvedValue(listOf([row]));
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    await screen.findByTestId('ahx-detail');
    expect(screen.queryByTestId('ahx-changes-none')).toBeNull(); expect(screen.queryByTestId('ahx-changes')).toBeNull();
  });
  it('Extras AH-03: a completed appointment shows whether a future one is booked and review-only rebooking shortcuts', async () => {
    m.list.mockResolvedValue(listOf([{ ...row, status: 'completed', completedAt: '2026-11-12T11:00:00Z' }]));
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    m.appts.mockResolvedValue([{ appointmentId: 'a0', startsAt: '2026-07-01T15:00:00Z', status: 'completed' }, { appointmentId: 'a1', startsAt: future, status: 'booked' },
      { appointmentId: 'a2', startsAt: new Date(Date.now() + 2 * 86400_000).toISOString(), status: 'cancelled' }]);
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    const r = await screen.findByTestId('ahx-rebook');
    await waitFor(() => expect(within(r).getByTestId('ahx-rebook-next').textContent).toMatch(/Next appointment already booked/));
    expect(within(r).getByTestId('ahx-rebook-review').getAttribute('href')).toBe('/tenant/ai/customer-profile/rebooking?customerId=c1');
    expect(within(r).getByTestId('ahx-rebook-assistant').getAttribute('href')).toBe('/tenant/ai/booking');
    expect(m.appts).toHaveBeenCalledWith('c1');
  });
  it('Extras AH-03: a booked (not completed) appointment has no rebooking shortcut; nextFutureAppointment ignores past, cancelled and completed', async () => {
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    await screen.findByTestId('ahx-detail');
    expect(screen.queryByTestId('ahx-rebook')).toBeNull();
    const now = Date.parse('2026-11-12T12:00:00Z');
    expect(nextFutureAppointment([{ startsAt: '2026-11-20T15:00:00Z', status: 'confirmed' }, { startsAt: '2026-11-15T15:00:00Z', status: 'booked' }, { startsAt: '2026-11-13T15:00:00Z', status: 'cancelled' }, { startsAt: '2026-11-01T15:00:00Z', status: 'booked' }], now)).toBe('2026-11-15T15:00:00.000Z');
    expect(nextFutureAppointment([{ startsAt: '2026-11-13T15:00:00Z', status: 'completed' }], now)).toBeNull();
  });
  it('extras (Appointment History 12 · A): the details header shows booking ID, scheduled time with the salon time zone, masked contact and a labelled source', async () => {
    m.list.mockResolvedValue({ ...listOf([{ ...row, id: 'ab12cd34-1111-4222-8333-444455556666', phone: '•••-•••-1234', source: 'online' }]), period: { today: '2026-11-09', timeZone: 'America/New_York' } });
    render(<POSAppointmentHistoryScreen />);
    fireEvent.click(await screen.findByTestId('ahx-view'));
    const d = await screen.findByTestId('ahx-detail');
    expect(within(d).getByTestId('ahx-detail-id')).toHaveTextContent('AB12CD34');
    expect(within(d).getByTestId('ahx-detail-id')).toHaveAttribute('title', 'ab12cd34-1111-4222-8333-444455556666');
    expect(within(d).getByTestId('ahx-detail-when')).toHaveTextContent('10:00–11:00 · 60 min · salon time (America/New_York)');
    expect(within(d).getByTestId('ahx-detail-contact')).toHaveTextContent('•••-•••-1234');
    expect(within(d).getByTestId('ahx-detail-source').textContent).not.toBe('online');
  });
});
