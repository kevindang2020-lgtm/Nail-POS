import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { searchMock, apptMock } = vi.hoisted(() => ({ searchMock: vi.fn(), apptMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, appointments: apptMock } }));
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
    expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Pedicure')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
  it('shows empty state when the customer has no appointments', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); apptMock.mockResolvedValue([]);
    render(<POSAppointmentHistoryScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    expect(await screen.findByText(/No appointments on record/)).toBeInTheDocument();
  });
});
