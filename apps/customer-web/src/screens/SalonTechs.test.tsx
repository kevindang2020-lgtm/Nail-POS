// SalonTechs.test.tsx — doc Flow 2/3: per-salon technician list renders + navigates, and the FindTechs sort bar reorders.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SalonTechsScreen from './SalonTechsScreen';
import { FindTechsScreen } from './FindTechsScreen';
import { customerApi } from '../api/customerApi';

vi.mock('../api/customerApi', () => ({
  customerApi: {
    salonTechnicians: vi.fn(), techsNearby: vi.fn(), techFavorites: vi.fn(),
  },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { branchId: 'b-mine' } }) }));

const tech = (over: any = {}) => ({
  technicianId: 't1', publicSlug: 'mia-tran', displayName: 'Mia Tran', title: 'Senior Nail Artist',
  avatarUrl: null, averageRating: 4.9, reviewCount: 126, specialties: ['Gel X', 'Chrome'],
  featuredPortfolioPhotos: [], nextAvailable: { date: '2026-06-13', startTime: '15:15' },
  badges: ['Top Rated'], isBookable: true, isFeatured: false, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('SalonTechsScreen', () => {
  it('renders cards with rating, badges, View Profile → /techs/:slug', async () => {
    (customerApi.salonTechnicians as any).mockResolvedValue({ salonId: 'b-mine', technicians: [tech()] });
    render(
      <MemoryRouter initialEntries={['/salons/b-mine/techs']}>
        <Routes>
          <Route path="/salons/:salonId/techs" element={<SalonTechsScreen />} />
          <Route path="/techs/:slug" element={<div>PROFILE PAGE</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Mia Tran')).toBeTruthy());
    expect(screen.getByText(/4\.9/)).toBeTruthy();
    expect(screen.getByText('Top Rated')).toBeTruthy();
    expect(screen.getByText('Book')).toBeTruthy(); // my salon → bookable in-app
    fireEvent.click(screen.getByText('View Profile'));
    await waitFor(() => expect(screen.getByText('PROFILE PAGE')).toBeTruthy());
  });

  it('shows the honest note instead of Book for a different salon', async () => {
    (customerApi.salonTechnicians as any).mockResolvedValue({ salonId: 'b-other', technicians: [tech()] });
    render(
      <MemoryRouter initialEntries={['/salons/b-other/techs']}>
        <Routes><Route path="/salons/:salonId/techs" element={<SalonTechsScreen />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Mia Tran')).toBeTruthy());
    expect(screen.queryByText('Book')).toBeNull();
    expect(screen.getByText(/Sign in with this salon/)).toBeTruthy();
  });
});

describe('FindTechs sort bar', () => {
  it('Highest Rated reorders; Featured puts the featured tech first', async () => {
    const low = tech({ publicSlug: 'amy', displayName: 'Amy Low', averageRating: 4.1, reviewCount: 8, isFeatured: true });
    const high = tech({ publicSlug: 'zoe', displayName: 'Zoe High', averageRating: 5.0, reviewCount: 40 });
    (customerApi.techsNearby as any).mockResolvedValue({ radiusMiles: 15, results: [low, high] }); // server best-match order
    (globalThis.navigator as any).geolocation = { getCurrentPosition: (okCb: any) => okCb({ coords: { latitude: 39.93, longitude: -75.02 } }) };
    render(<MemoryRouter><FindTechsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Allow Location' }));
    await waitFor(() => expect(screen.getByText('Amy Low')).toBeTruthy());

    fireEvent.click(screen.getByText('Highest Rated'));
    let names = screen.getAllByText(/Amy Low|Zoe High/).map((n) => n.textContent);
    expect(names[0]).toContain('Zoe High');

    fireEvent.click(screen.getByText('Featured'));
    names = screen.getAllByText(/Amy Low|Zoe High/).map((n) => n.textContent);
    expect(names[0]).toContain('Amy Low');
  });
});
