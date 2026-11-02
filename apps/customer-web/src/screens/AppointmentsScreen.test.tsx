import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { appointments: vi.fn() } }));
const proposals = { list: vi.fn(async () => [] as any[]) };
vi.mock('../api/customerScheduleProposalsApi', async (orig) => ({ ...(await orig<any>()), customerScheduleProposalsApi: { list: () => proposals.list() } }));
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

  // BUILD_PLAN Phase 7: a pending salon proposal shows a banner that opens /appointments/proposals
  it('shows a banner when the salon proposed a new time; none when nothing is pending', async () => {
    (customerApi.appointments as any).mockResolvedValue(items);
    proposals.list.mockResolvedValueOnce([{ id: 'p1', status: 'customer_notified' }, { id: 'p2', status: 'expired' }]);
    const { unmount } = render(<MemoryRouter><AppointmentsScreen /></MemoryRouter>);
    const banner = await screen.findByTestId('proposal-banner');
    expect(banner).toHaveTextContent('Your salon suggested a new time for 1 appointment');
    expect(banner.getAttribute('href')).toBe('/appointments/proposals');
    unmount();
    proposals.list.mockResolvedValueOnce([{ id: 'p2', status: 'customer_approved' }]);
    render(<MemoryRouter><AppointmentsScreen /></MemoryRouter>);
    await screen.findByText('Acrylic Full Set');
    expect(screen.queryByTestId('proposal-banner')).toBeNull();
  });
});
