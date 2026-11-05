import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the typed customer API so Home renders against canned, realistic backend shapes (no live backend).
vi.mock('../api/customerApi', () => ({
  customerApi: {
    salon: vi.fn(async () => null),   // Sep 2026 redesign: the home header shows the customer's salon
    salonsNearby: vi.fn(async () => ({ results: [] })),   // …and nearby salons
    home: vi.fn(),
    bookingOptions: vi.fn(),
    notifications: vi.fn(),
    pendingTechRatings: vi.fn(async () => ({ pending: [] })),
    referral: vi.fn(async () => ({ code: 'REFX', shareMessage: 'x', offer: null })),   // Refer a Friend: no funded offer → no money claim
  },
}));
import { customerApi } from '../api/customerApi';
import { HomeScreen } from './HomeScreen';

const home = {
  customerName: 'Jessica Smith',
  loyalty: { points: 1250, tier: 'Silver', nextTier: 'Gold', pointsToNextTier: 750, progressPercent: 62 },
  nextAppointment: { appointmentId: 'a1', serviceName: 'Acrylic Full Set', startTime: new Date().toISOString(), status: 'Confirmed', technicianName: 'Lisa' },
  recentVisitsCount: 4,
};
const options = { services: [{ id: 's1', name: 'Manicure', durationMinutes: 30, priceCents: 2500 }], technicians: [] };
const renderHome = () => render(<MemoryRouter><HomeScreen /></MemoryRouter>);

describe('HomeScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.notifications as any).mockResolvedValue({ unreadCount: 3, items: [] }); });

  it('renders real customer + loyalty data from the backend', async () => {
    (customerApi.home as any).mockResolvedValue(home);
    (customerApi.bookingOptions as any).mockResolvedValue(options);
    renderHome();
    expect(await screen.findByText(/Hello, Jessica/)).toBeInTheDocument();
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.getByText('Silver Member')).toBeInTheDocument();
    expect(screen.getByText(/750 pts to Gold/)).toBeInTheDocument();
    // upcoming appointment (real)
    expect(await screen.findByText('Acrylic Full Set')).toBeInTheDocument();
    expect(screen.getByText(/Technician: Lisa/)).toBeInTheDocument();
    // popular service (real)
    expect(await screen.findByText('Manicure')).toBeInTheDocument();
    // quick actions present and navigable
    expect(screen.getByLabelText('Book Now')).toBeInTheDocument();
    expect(screen.getByLabelText('My Appointments')).toBeInTheDocument();
    // notifications bell shows the real unread count
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeInTheDocument();
  });

  it('shows an honest empty state when there is no upcoming appointment', async () => {
    (customerApi.home as any).mockResolvedValue({ ...home, nextAppointment: undefined });
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [], technicians: [] });
    renderHome();
    expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument();
  });

  it('surfaces a clear error when the backend read fails', async () => {
    (customerApi.home as any).mockRejectedValue(new Error('Could not load your account.'));
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [], technicians: [] });
    renderHome();
    expect(await screen.findByText('Could not load your account.')).toBeInTheDocument();
  });
});
