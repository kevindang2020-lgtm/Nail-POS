import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { salonsNearby: vi.fn(), salonDetail: vi.fn(), salonServices: vi.fn(), salonTechnicians: vi.fn().mockResolvedValue({ technicians: [] }), favoriteSalons: vi.fn(), addFavoriteSalon: vi.fn(), removeFavoriteSalon: vi.fn() } }));
const leafletMock = vi.hoisted(() => {
  const chain: any = {}; ['setView', 'addTo', 'on', 'fitBounds', 'eachLayer', 'removeLayer', 'remove', 'invalidateSize'].forEach((k) => (chain[k] = vi.fn(() => chain)));
  return { map: vi.fn(() => chain), tileLayer: vi.fn(() => chain), marker: vi.fn(() => chain), divIcon: vi.fn(() => ({})), latLngBounds: vi.fn(() => ({})), Marker: class {}, chain };
});
vi.mock('leaflet', () => ({ default: leafletMock }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'branch-mine', role: 'CUSTOMER' } }) }));
import { customerApi } from '../api/customerApi';
import { FindSalonsScreen } from './FindSalonsScreen';

const partner = {
  salon_id: 'branch-a', source: 'aipowersalon', name: 'Luxe Nails — Cherry Hill', address: '1 Main St', city: 'Cherry Hill', state: 'NJ', zip: '08002',
  phone: '(856) 555-0101', latitude: 39.9268, longitude: -75.0246, distance_miles: 0.4, rating: null, review_count: null, photos: [],
  is_aipowersalon_partner: true, is_bookable_in_app: true, open_now: null, hours: null, services_preview: ['Gel Manicure', 'Nail Art'],
  price_level: null, booking_url_or_route: '/book/branch-a', google_place_id: null,
};
const googleOnly = {
  ...partner, salon_id: 'g_abc', source: 'google', name: 'Polish Spot', is_aipowersalon_partner: false, is_bookable_in_app: false,
  booking_url_or_route: null, rating: 4.4, review_count: 88, open_now: true, services_preview: [], google_place_id: 'abc', distance_miles: 1.2,
};

describe('FindSalonsScreen (build doc §15–§18)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: [], salons: [] }); });

  it('shows the VERBATIM §15 location copy with both buttons; denial path falls back to manual search', async () => {
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    expect(screen.getByText('Allow location access to find nail salons near you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow Location' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    expect(screen.getByLabelText('Search city or ZIP')).toBeInTheDocument(); // app did not break
  });

  it('manual search renders partner-first results: gold badge, distance, Book Now only when bookable, google attribution + card actions', async () => {
    (customerApi.salonsNearby as any).mockResolvedValue({
      results: [partner, googleOnly], radiusMiles: 10, googleEnabled: true, googleMessage: null, attribution: 'Powered by Google',
    });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: 'Cherry Hill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
    expect((customerApi.salonsNearby as any).mock.calls[0][0]).toEqual({ searchText: 'Cherry Hill' });
    expect(screen.getByText('AIPowerSalon Partner')).toBeInTheDocument();
    expect(screen.getByText(/0\.4 mi/)).toBeInTheDocument();
    expect(screen.getAllByText('Book Now')).toHaveLength(1); // partner only — google salon is NEVER bookable
    expect(screen.getByText('Polish Spot')).toBeInTheDocument();
    expect(screen.getByText(/★ 4\.4 \(88\)/)).toBeInTheDocument();
    expect(screen.getByText('Powered by Google')).toBeInTheDocument();
    expect(screen.getAllByText('Call').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Directions').length).toBeGreaterThanOrEqual(2);
  });

  it('a 5-digit query searches by ZIP and the verbatim Google not-configured message renders', async () => {
    (customerApi.salonsNearby as any).mockResolvedValue({
      results: [partner], radiusMiles: 10, googleEnabled: false,
      googleMessage: 'Nearby Google salon search is not configured yet.', attribution: null,
    });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: '08002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Nearby Google salon search is not configured yet.')).toBeInTheDocument();
    expect((customerApi.salonsNearby as any).mock.calls[0][0]).toEqual({ zip: '08002' });
  });

  it('§18 bottom sheet: partner shows live services with prices; cross-salon booking gives the honest note instead of a Book button', async () => {
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    (customerApi.salonServices as any).mockResolvedValue([{ serviceId: 's1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }]);
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: 'Cherry Hill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByText('Luxe Nails — Cherry Hill'));
    expect(await screen.findByText('$45.00')).toBeInTheDocument();
    expect((customerApi.salonServices as any).mock.calls[0][0]).toBe('branch-a');
    // signed in to branch-mine ≠ branch-a → honest cross-salon note, no in-sheet Book button
    expect(screen.getByText(/signed in with a different salon/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book Appointment' })).not.toBeInTheDocument();
  });
});

describe('FindSalonsScreen favorites (§17/§21)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('partner cards carry a heart; tapping it posts the favorite and refreshes', async () => {
    (customerApi.favoriteSalons as any).mockResolvedValueOnce({ salonIds: [], salons: [] })
      .mockResolvedValueOnce({ salonIds: ['branch-a'], salons: [partner] });
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner, googleOnly], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    (customerApi.addFavoriteSalon as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: 'Cherry Hill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const heart = await screen.findByRole('button', { name: 'Favorite Luxe Nails — Cherry Hill' });
    expect(screen.queryByRole('button', { name: /Favorite Polish Spot/ })).not.toBeInTheDocument(); // no heart on google cards
    fireEvent.click(heart);
    await waitFor(() => expect(customerApi.addFavoriteSalon).toHaveBeenCalledWith('branch-a'));
    expect(await screen.findByRole('button', { name: 'Unfavorite Luxe Nails — Cherry Hill' })).toBeInTheDocument();
  });

  it('shows the favorites strip before any search', async () => {
    (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: ['branch-a'], salons: [partner] });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    expect(await screen.findByText('Your favorite salons')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
  });
});

describe('FindSalonsScreen map view (§17)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: [], salons: [] }); });

  it('List/Map toggle renders; Map mode mounts Leaflet with one pin per located salon', async () => {
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner, googleOnly], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Search by City or ZIP' }));
    fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: 'Cherry Hill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Luxe Nails — Cherry Hill');
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    expect(screen.getByTestId('salon-map')).toBeInTheDocument();
    await waitFor(() => expect(leafletMock.map).toHaveBeenCalledTimes(1));
    expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('openstreetmap.org'), expect.anything());
    expect(leafletMock.marker).toHaveBeenCalledTimes(2); // partner + google, each with coordinates
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    expect(await screen.findByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
  });
});
