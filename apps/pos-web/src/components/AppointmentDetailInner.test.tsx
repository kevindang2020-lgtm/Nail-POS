import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const appointment = vi.fn();
const checkIn = vi.fn();
// Sep 2026: Check In goes through the check-in module's route (posCheckInApi.appointmentCheckIn), not the booking client
vi.mock('../api/posCheckInApi', () => ({ posCheckInApi: { appointmentCheckIn: (...a: any[]) => checkIn(...a) } }));
vi.mock('../api/posBookingApi', () => ({
  posBookingApi: { appointment: (...a: any[]) => appointment(...a), checkIn: (...a: any[]) => checkIn(...a), startService: vi.fn(), moveToQueue: vi.fn() },
}));

import { AppointmentDetailInner, type AppointmentRow } from './AppointmentDetailInner';

let mockPerms: string[] | null = null; // null => unknown (fail-open, all actions show)
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: mockPerms === null ? { role: 'owner' } : { role: 'staff', permissions: mockPerms }, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));

const row: AppointmentRow = {
  appointmentId: 'a1', customerName: 'Grace Kim', customerPhone: '(555) 111-2222', isVip: true,
  technicianName: 'Mia Johnson', services: [{ serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }],
  source: 'online_booking', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'confirmed', notes: 'Allergic to acetone',
};

beforeEach(() => { appointment.mockReset(); checkIn.mockReset(); appointment.mockResolvedValue(row); checkIn.mockResolvedValue({}); mockPerms = null; });

describe('AppointmentDetailInner (iPad appointment view — real data)', () => {
  it('loads the real appointment and shows customer, technician, service, total and notes', async () => {
    render(<AppointmentDetailInner appointmentId="a1" />);
    await waitFor(() => expect(screen.getByText('Grace Kim')).toBeTruthy());
    expect(appointment).toHaveBeenCalledWith('a1');
    expect(screen.getByText('Mia Johnson')).toBeTruthy();
    expect(screen.getByText('Gel Manicure')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Allergic to acetone/)).toBeTruthy();
  });

  it('Check In calls the real endpoint and refreshes the record', async () => {
    const onChanged = vi.fn();
    render(<AppointmentDetailInner appointmentId="a1" initial={row} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Check In'));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith('a1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides actions the current role lacks permission for (server still enforces)', async () => {
    mockPerms = ['pos.booking.check_in'];
    render(<AppointmentDetailInner appointmentId="a1" initial={row} />);
    await waitFor(() => expect(screen.getByText('Grace Kim')).toBeTruthy());
    expect(screen.getByText('Check In')).toBeTruthy();
    expect(screen.queryByText('Start Service')).toBeNull();
    expect(screen.queryByText('Move to Queue')).toBeNull();
  });

  it('renders an error state when the load fails', async () => {
    appointment.mockRejectedValueOnce(new Error('nope'));
    render(<AppointmentDetailInner appointmentId="a1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
