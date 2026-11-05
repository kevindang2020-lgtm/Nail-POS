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

const empty = { results: [], radiusMiles: 30, googleEnabled: false, googleMessage: null, attribution: null };
const search = async (q: string) => {
  await screen.findByRole('button', { name: 'Search' });
  fireEvent.change(screen.getByLabelText('Search city or ZIP'), { target: { value: q } });
  fireEvent.click(await screen.findByRole('button', { name: 'Search' })); // label is '…' while the initial load runs
};
const lastQuery = () => { const c = (customerApi.salonsNearby as any).mock.calls; return c[c.length - 1][0]; };

// The redesigned Find Salons screen opens with the search box and nearby partner salons (30 mi) already loaded,
// instead of a location-permission prompt. "Near Me" asks for location on demand.
describe('FindSalonsScreen (build doc §15–§18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: [], salons: [] });
    (customerApi.salonsNearby as any).mockResolvedValue(empty);
  });

  it('opens with the search box and loads nearby partner salons; Near Me is offered', async () => {
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    expect(screen.getByLabelText('Search city or ZIP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Near Me/ })).toBeInTheDocument();
    await waitFor(() => expect(customerApi.salonsNearby).toHaveBeenCalledWith({ radiusMiles: 30 }));
  });

  it('manual search renders results: partner badge, distance, Book Now only when bookable, Google attribution', async () => {
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    (customerApi.salonsNearby as any).mockResolvedValue({
      results: [partner, googleOnly], radiusMiles: 10, googleEnabled: true, googleMessage: null, attribution: 'Powered by Google',
    });
    await search('Cherry Hill');
    expect(await screen.findByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ searchText: 'Cherry Hill' });
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText(/0\.4 mi/)).toBeInTheDocument();
    expect(screen.getAllByText('Book Now')).toHaveLength(1); // partner only — a Google listing is NEVER bookable in-app
    expect(screen.getByText('Polish Spot')).toBeInTheDocument();
    expect(screen.getByText(/★ 4\.4 \(88\)/)).toBeInTheDocument();
    expect(screen.getByText('Powered by Google')).toBeInTheDocument();
    expect(screen.getAllByText('Directions').length).toBeGreaterThanOrEqual(2);
  });

  it('a 5-digit query searches by ZIP and the verbatim Google not-configured message renders', async () => {
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    (customerApi.salonsNearby as any).mockResolvedValue({
      results: [partner], radiusMiles: 10, googleEnabled: false,
      googleMessage: 'Nearby Google salon search is not configured yet.', attribution: null,
    });
    await search('08002');
    expect(await screen.findByText('Nearby Google salon search is not configured yet.')).toBeInTheDocument();
    expect(lastQuery()).toEqual({ zip: '08002' });
  });

  it('§18 bottom sheet: a partner shows live services with prices and can be booked', async () => {
    (customerApi.salonServices as any).mockResolvedValue([{ serviceId: 's1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }]);
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    await search('Cherry Hill');
    fireEvent.click(await screen.findByText('Luxe Nails — Cherry Hill'));
    expect(await screen.findByText('$45.00')).toBeInTheDocument();
    expect((customerApi.salonServices as any).mock.calls[0][0]).toBe('branch-a');
    expect(screen.getAllByText('Book Now').length).toBe(2); // card + sheet
  });

  it('§18 bottom sheet: a Google-only listing has no Book button', async () => {
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [googleOnly], radiusMiles: 10, googleEnabled: true, googleMessage: null, attribution: 'Powered by Google' });
    await search('Cherry Hill');
    fireEvent.click(await screen.findByText('Polish Spot'));
    expect(screen.queryByText('Book Now')).not.toBeInTheDocument();
    expect(customerApi.salonServices).not.toHaveBeenCalled();
  });
});

describe('FindSalonsScreen favorites (§17/§21)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.salonsNearby as any).mockResolvedValue(empty); });

  it('partner cards carry a heart; tapping it posts the favorite and refreshes', async () => {
    (customerApi.favoriteSalons as any).mockResolvedValueOnce({ salonIds: [], salons: [] })
      .mockResolvedValue({ salonIds: ['branch-a'], salons: [partner] });
    (customerApi.addFavoriteSalon as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner, googleOnly], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    await search('Cherry Hill');
    const heart = await screen.findByRole('button', { name: 'Favorite Luxe Nails — Cherry Hill' });
    expect(screen.queryByRole('button', { name: /Favorite Polish Spot/ })).not.toBeInTheDocument(); // no heart on google cards
    fireEvent.click(heart);
    await waitFor(() => expect(customerApi.addFavoriteSalon).toHaveBeenCalledWith('branch-a'));
    expect((await screen.findAllByRole('button', { name: 'Unfavorite Luxe Nails — Cherry Hill' })).length).toBeGreaterThan(0);
  });

  it('shows the favorites strip before any search', async () => {
    (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: ['branch-a'], salons: [partner] });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    expect(await screen.findByText(/your favorite salons/i)).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
  });
});

describe('FindSalonsScreen map view (§17)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.favoriteSalons as any).mockResolvedValue({ salonIds: [], salons: [] }); });

  it('List/Map toggle; Map mode mounts Leaflet with one pin per located salon', async () => {
    (customerApi.salonsNearby as any).mockResolvedValue({ results: [partner, googleOnly], radiusMiles: 10, googleEnabled: false, googleMessage: null, attribution: null });
    render(<MemoryRouter><FindSalonsScreen /></MemoryRouter>);
    await screen.findByText('Luxe Nails — Cherry Hill');
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByTestId('salon-map')).toBeVisible();
    await waitFor(() => expect(leafletMock.map).toHaveBeenCalledTimes(1));
    expect(leafletMock.tileLayer).toHaveBeenCalledWith(expect.stringContaining('openstreetmap.org'), expect.anything());
    // One pin per located salon (partner + google); the layer is rebuilt when the view changes.
    expect(new Set((leafletMock.marker as any).mock.calls.map((c: any[]) => c[1].title))).toEqual(new Set(['Luxe Nails — Cherry Hill', 'Polish Spot']));
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('Luxe Nails — Cherry Hill')).toBeVisible();
  });
});
