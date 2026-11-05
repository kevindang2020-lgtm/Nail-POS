import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { appointments: vi.fn(), checkIn: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { CheckInScreen } from './CheckInScreen';

describe('CheckInScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('checks in a today appointment via the real endpoint', async () => {
    (customerApi.appointments as any).mockResolvedValue([{ appointmentId: 'ap1', serviceName: 'Acrylic Full Set', startTime: new Date().toISOString(), status: 'confirmed', technicianName: 'Lisa' }]);
    (customerApi.checkIn as any).mockResolvedValue({ ok: true, queueItemId: 'q1' });
    render(<MemoryRouter><CheckInScreen /></MemoryRouter>);
    expect(await screen.findByText('Acrylic Full Set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }));
    await waitFor(() => expect(customerApi.checkIn).toHaveBeenCalledWith('ap1'));
  });
  it('shows an empty state when nothing is checkable today', async () => {
    (customerApi.appointments as any).mockResolvedValue([{ appointmentId: 'ap2', serviceName: 'Gel', startTime: '2020-01-01T10:00:00Z', status: 'confirmed' }]);
    render(<MemoryRouter><CheckInScreen /></MemoryRouter>);
    expect(await screen.findByText('No appointment to check into today')).toBeInTheDocument();
  });
});
