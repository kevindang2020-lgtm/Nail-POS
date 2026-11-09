import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { searchMock, apptMock } = vi.hoisted(() => ({ searchMock: vi.fn(), apptMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, appointments: apptMock } }));
vi.mock('../api/posAppointmentHistoryApi', () => ({ posAppointmentHistoryApi: { summary: vi.fn().mockResolvedValue({ cards: { appointments: 0, upcoming: 0, completed: 0, canceled: 0, noShows: 0, rescheduled: 0 } }), list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0, applied: { q: null, status: 'all', dateField: 'scheduled', sort: 'newest', preset: 'all', from: null, to: null }, period: { today: '2026-11-09', timeZone: 'UTC' } }), options: vi.fn().mockResolvedValue({ technicians: [] }), check: vi.fn() } }));
import { POSAppointmentHistoryScreen } from './POSAppointmentHistoryScreen';
beforeEach(() => { searchMock.mockReset(); apptMock.mockReset(); });

const cust = { customerId: 'c1', fullName: 'Ana Rivera', phone: '555-1234', visitsCount: 7 };
const appts = [
  { appointmentId: 'a1', startsAt: '2026-07-01T15:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Ben', status: 'completed' },
  { appointmentId: 'a2', startsAt: '2026-07-10T18:00:00Z', serviceName: 'Pedicure', technicianName: 'Cara', status: 'booked' },
];

describe('POSAppointmentHistoryScreen', () => {
  it('searches, picks a customer, and shows their appointment history', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); apptMock.mockResolvedValue(appts);
    render(<POSAppointmentHistoryScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    const hit = await screen.findByText('Ana Rivera');
    fireEvent.click(hit);
    await waitFor(() => expect(apptMock).toHaveBeenCalledWith('c1'));
    const dlg = await screen.findByTestId('ahx-customer');
    expect(await within(dlg).findByText('Gel Manicure')).toBeInTheDocument();
    expect(within(dlg).getByText('Pedicure')).toBeInTheDocument();
    expect(within(dlg).getByText('Completed')).toBeInTheDocument();
  });
  it('shows empty state when the customer has no appointments', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); apptMock.mockResolvedValue([]);
    render(<POSAppointmentHistoryScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    expect(await screen.findByText(/No appointments on record/)).toBeInTheDocument();
  });
});
