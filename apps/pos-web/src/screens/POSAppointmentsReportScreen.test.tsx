// batch 9 guide 5 (Nov 10 2026): outcomes are appointments; the tabs drive the period; the list reuses Appointment History
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const bookMock = vi.fn(), stateMock = vi.fn(), getMock = vi.fn();
let perms: string[] | undefined;
vi.mock('../api/posReportsApi', () => ({ posReportsApi: { booking: (...a: any[]) => bookMock(...a), state: (...a: any[]) => stateMock(...a) } }));
vi.mock('../api/client', async (orig) => ({ ...(await orig() as any), api: { get: (...a: any[]) => getMock(...a) } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms || perms.includes(p) }));
import { POSAppointmentsReportScreen } from './POSAppointmentsReportScreen';

const ov = (over: Record<string, unknown> = {}) => ({ basis: 'scheduled_date', totalBookings: 40, completed: 28, completedPercent: 70, cancelled: 6, cancelledPercent: 15, noShow: 4, noShowPercent: 10, open: 2, openPercent: 5, other: 0, otherPercent: 0, ...over });
const list = { items: [{ id: 'a1', date: '2026-11-09', startTime: '10:00', endTime: '10:45', durationMinutes: 45, customerId: 'c', customer: 'Ann N', phone: '•••-0101', services: 'Gel Manicure', technician: 'Lisa T', anyTechnician: false, branch: 'Main', status: 'no_show', source: 'online', rescheduled: 0, createdAt: '2026-11-01T15:00:00Z', updatedAt: null, completedAt: null, canceledAt: null }],
  total: 1, page: 1, pageSize: 25, totalPages: 1, applied: {}, period: { today: '2026-11-10', timeZone: 'America/New_York' } };
const at = (url = '/tenant/reports/appointments') => render(<MemoryRouter initialEntries={[url]}><POSAppointmentsReportScreen /></MemoryRouter>);
beforeEach(() => { perms = undefined; bookMock.mockReset(); stateMock.mockReset(); getMock.mockReset(); stateMock.mockResolvedValue({ dateRange: { from: '2026-11-01', to: '2026-11-10', timezone: 'America/New_York' } }); getMock.mockResolvedValue(list); });

describe('POSAppointmentsReportScreen', () => {
  it('keeps the four cards, chart and breakdown; shows the Open row so the partition adds up to the total', async () => {
    bookMock.mockResolvedValue(ov());
    at();
    expect(await screen.findByRole('heading', { name: 'Appointments Report' })).toBeInTheDocument();
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
    expect(screen.getAllByText('70.0%').length).toBeGreaterThan(0);
    expect(screen.getByTestId('appt-breakdown')).toHaveTextContent('Still open');
    expect(bookMock).toHaveBeenCalledWith({ preset: 'month' });                // `preset`, not the ignored `period`
  });
  it('a preset changes the period; nothing booked → N/A shares and an empty state with the dates', async () => {
    bookMock.mockResolvedValue(ov({ totalBookings: 0, completed: 0, completedPercent: null, cancelled: 0, cancelledPercent: null, noShow: 0, noShowPercent: null, open: 0 }));
    at();
    fireEvent.click(await screen.findByTestId('preset-today'));
    await waitFor(() => expect(bookMock).toHaveBeenCalledWith({ preset: 'today' }));
    expect(await screen.findByTestId('appt-empty')).toHaveTextContent('2026-11-01');
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(3);
  });
  it('a bar filters the appointment list (Appointment History, newest first) by that outcome', async () => {
    bookMock.mockResolvedValue(ov());
    at();
    expect(await screen.findByText('Ann N')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/pos/appointment-history/appointments', expect.objectContaining({ preset: 'month', dateField: 'scheduled', sort: 'newest', status: 'all', page: 1 }));
    fireEvent.click(screen.getByTestId('appt-bar-no_show'));
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/pos/appointment-history/appointments', expect.objectContaining({ status: 'no_show', page: 1 })));
    expect(await screen.findByTestId('appt-chip')).toHaveTextContent('No-show');
  });
  it('says when the figures are not appointments, and hides the list without the customers permission', async () => {
    perms = ['pos.reports.view'];
    bookMock.mockResolvedValue(ov({ basis: 'paid_tickets' }));
    at();
    expect(await screen.findByTestId('appt-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('appt-list-restricted')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });
});
