// FindTechsScreen (customer marketplace discovery): location consent -> nearby techs across salons, with client-side sort and
// radius/rating filters. Verifies the allow-location flow + result rendering, the denied path, the empty state, the rating
// re-sort, the radius filter re-query, and tapping a result card navigating to that tech.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navMock }));
vi.mock('../api/customerApi', () => ({ customerApi: { techsNearby: vi.fn() } }));

import { customerApi } from '../api/customerApi';
import { FindTechsScreen } from './FindTechsScreen';

const t1 = { publicSlug: 'jane', displayName: 'Jane Nguyen', title: 'Senior Artist', avatarUrl: null, averageRating: 4.8, reviewCount: 32, specialties: ['Gel-X', 'Chrome'], featuredPortfolioPhotos: [], badges: ['Top Rated'], isFeatured: true, nextAvailable: { date: '2026-06-18', startTime: '14:30' }, salonName: 'Lotus Nails', distanceMiles: 2.3 };
const t2 = { publicSlug: 'mary', displayName: 'Mary Lee', title: null, avatarUrl: null, averageRating: 4.2, reviewCount: 10, specialties: [], featuredPortfolioPhotos: [], badges: [], isFeatured: false, nextAvailable: null, salonName: 'Polish Bar', distanceMiles: 1.1 };

let geo: { getCurrentPosition: any };
beforeEach(() => {
  vi.clearAllMocks();
  (customerApi.techsNearby as any).mockResolvedValue({ radiusMiles: 15, results: [t2, t1] });   // server order: Mary, then Jane
  geo = { getCurrentPosition: vi.fn((success: any) => success({ coords: { latitude: 39.9, longitude: -75.0 } })) };
  Object.defineProperty(global.navigator, 'geolocation', { value: geo, configurable: true, writable: true });
});

const cardTexts = (c: HTMLElement) => Array.from(c.querySelectorAll('button.cust-card')).map((b) => b.textContent || '');

describe('FindTechsScreen', () => {
  it('allows location and renders nearby techs', async () => {
    render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    expect(await screen.findByText('Jane Nguyen')).toBeInTheDocument();
    expect(screen.getByText('Mary Lee')).toBeInTheDocument();
    expect(screen.getByText(/Lotus Nails/)).toBeInTheDocument();
    expect(customerApi.techsNearby).toHaveBeenCalledWith(expect.objectContaining({ lat: 39.9, lng: -75.0, radiusMiles: 15 }));
  });

  it('shows the denied state when location is refused', async () => {
    geo.getCurrentPosition.mockImplementation((_s: any, err: any) => err());
    render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    expect(await screen.findByText(/Location is off/)).toBeInTheDocument();
  });

  it('shows the empty state when no techs are found', async () => {
    (customerApi.techsNearby as any).mockResolvedValue({ radiusMiles: 15, results: [] });
    render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    expect(await screen.findByText(/No techs found within 15 miles/)).toBeInTheDocument();
  });

  it('re-sorts results by rating on the client', async () => {
    const { container } = render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    await screen.findByText('Jane Nguyen');
    expect(cardTexts(container)[0]).toContain('Mary Lee');     // default = server order
    fireEvent.click(screen.getByText('Highest Rated'));
    expect(cardTexts(container)[0]).toContain('Jane Nguyen');  // 4.8 sorts above 4.2
  });

  it('re-queries when the radius filter changes', async () => {
    render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByText('5 mi'));
    await waitFor(() => expect((customerApi.techsNearby as any).mock.calls.at(-1)[0]).toMatchObject({ radiusMiles: 5 }));
  });

  it('navigates to a tech profile when a result is tapped', async () => {
    (customerApi.techsNearby as any).mockResolvedValue({ radiusMiles: 15, results: [t1] });
    render(<FindTechsScreen />);
    fireEvent.click(screen.getByText('Allow Location'));
    fireEvent.click((await screen.findByText('Jane Nguyen')).closest('button') as HTMLElement);
    expect(navMock).toHaveBeenCalledWith('/techs/jane');
  });
});
