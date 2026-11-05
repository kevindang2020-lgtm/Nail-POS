import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { availability: vi.fn(), reschedule: vi.fn(), appointments: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { RescheduleScreen } from './RescheduleScreen';

const appt = { appointmentId: 'ap1', serviceName: 'Acrylic Full Set', startTime: new Date().toISOString(), status: 'confirmed', serviceId: 's1', technicianId: 't1', durationMinutes: 60 };

describe('RescheduleScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows conflict-aware slots and reschedules via the real endpoint', async () => {
    (customerApi.availability as any).mockResolvedValue({ date: 'x', serviceId: 's1', durationMinutes: 60, window: { open: '09:00', close: '19:00', stepMinutes: 30 }, slots: [{ startTime: '12:00', available: true, technicianIds: ['t1'] }] });
    (customerApi.reschedule as any).mockResolvedValue({ appointmentId: 'ap1', date: 'x', startTime: '12:00', endTime: '13:00', status: 'confirmed' });
    render(<MemoryRouter initialEntries={[{ pathname: '/appointments/ap1/reschedule', state: { appt } }]}><RescheduleScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '12:00 PM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new time' }));
    await waitFor(() => expect(customerApi.reschedule).toHaveBeenCalledWith('ap1', expect.any(String), '12:00'));
  });
  it('handles a date with no availability', async () => {
    (customerApi.availability as any).mockResolvedValue({ date: 'x', serviceId: 's1', durationMinutes: 60, window: { open: '09:00', close: '19:00', stepMinutes: 30 }, slots: [] });
    render(<MemoryRouter initialEntries={[{ pathname: '/appointments/ap1/reschedule', state: { appt } }]}><RescheduleScreen /></MemoryRouter>);
    expect(await screen.findByText('No available times for this date.')).toBeInTheDocument();
  });
});
