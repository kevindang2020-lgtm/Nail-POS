import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { appointments: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { AppointmentsScreen } from './AppointmentsScreen';

const items = [
  { appointmentId: 'u1', serviceName: 'Acrylic Full Set', startTime: new Date().toISOString(), status: 'confirmed', technicianName: 'Lisa' },
  { appointmentId: 'p1', serviceName: 'Gel Manicure', startTime: '2025-01-02T15:00:00Z', status: 'completed', technicianName: 'Anna' },
  { appointmentId: 'c1', serviceName: 'Pedicure Spa', startTime: '2025-01-03T15:00:00Z', status: 'cancelled' },
];

describe('AppointmentsScreen (My Appointments)', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows real upcoming appointments by default and filters by tab', async () => {
    (customerApi.appointments as any).mockResolvedValue(items);
    render(<MemoryRouter><AppointmentsScreen /></MemoryRouter>);
    expect(await screen.findByText('Acrylic Full Set')).toBeInTheDocument();
    expect(screen.queryByText('Gel Manicure')).not.toBeInTheDocument(); // past hidden on Upcoming
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.queryByText('Acrylic Full Set')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(await screen.findByText('Pedicure Spa')).toBeInTheDocument();
  });
  it('shows an honest empty state for an empty tab', async () => {
    (customerApi.appointments as any).mockResolvedValue([items[0]]);
    render(<MemoryRouter><AppointmentsScreen /></MemoryRouter>);
    await screen.findByText('Acrylic Full Set');
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('No past appointments yet.')).toBeInTheDocument();
  });
});
