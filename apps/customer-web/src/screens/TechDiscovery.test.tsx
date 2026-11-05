// TechDiscovery.test.tsx — P4 customer surfaces: nearby cards, public profile + Book gating, rating submit.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FindTechsScreen } from './FindTechsScreen';
import { CustomerTechProfileScreen } from './CustomerTechProfileScreen';
import { RateTechScreen } from './RateTechScreen';
import { customerApi } from '../api/customerApi';

vi.mock('../api/customerApi', () => ({
  customerApi: {
    techsNearby: vi.fn(), techProfile: vi.fn(), submitTechRating: vi.fn(), pendingTechRatings: vi.fn(),
    techFavorites: vi.fn(async () => ({ slugs: [], techs: [] })), addTechFavorite: vi.fn(async () => ({ ok: true })), removeTechFavorite: vi.fn(async () => ({ ok: true })),
    myTechRating: vi.fn(async () => ({ exists: false })), updateTechRating: vi.fn(),
  },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { branchId: 'b1' } }) }));

const card = { badges: ['Top Rated'], nextAvailable: { date: '2026-06-13', startTime: '09:00' }, isFeatured: true, publicSlug: 'mia-tran', displayName: 'Mia Tran', title: 'Senior Nail Artist', avatarUrl: null, averageRating: 4.9, reviewCount: 32, specialties: ['Gel X', 'Chrome'], featuredPortfolioPhotos: ['/media/a.jpg'], isBookable: true, salonId: 'b2', salonName: 'Palace Nails', distanceMiles: 1.2, rankScore: 80 };
const profile = {
  publicSlug: 'mia-tran', displayName: 'Mia Tran', title: 'Senior Nail Artist', avatarUrl: null, bio: 'Chrome specialist.',
  yearsExperience: 7, specialties: ['Gel X'], languages: ['English'], profileLinks: { linkme: 'https://linkme.example/mia' },
  averageRating: 5, reviewCount: 2, ratingBreakdown: [{ star: 5, pct: 100 }, { star: 4, pct: 0 }, { star: 3, pct: 0 }, { star: 2, pct: 0 }, { star: 1, pct: 0 }],
  isBookable: true, portfolio: [{ photoId: 'p1', imageUrl: '/media/a.jpg', thumbnailUrl: '/media/a.jpg', caption: 'Chrome set', tags: [], isFeatured: true }],
  reviews: [{ rating: 5, reviewText: 'Beautiful tips', tags: ['Clean Work'], reviewer: 'Jessica L.', serviceName: 'Gel Manicure', createdAt: new Date().toISOString() }],
  badges: ['Top Rated'],
  availableAt: [
    { salonId: 'b1', technicianId: 't1', salonName: 'Luxe Nails', address: '1 Main St', bookingRoute: '/book/b1', nextAvailableAt: { date: '2026-06-13', startTime: '09:00' }, services: [{ serviceId: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, isPrimary: true }] },
    { salonId: 'b2', technicianId: 't9', salonName: 'Palace Nails', address: '2 King St', bookingRoute: '/book/b2', nextAvailableAt: null, services: [] },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('FindTechsScreen (P4)', () => {
  it('asks for location, then renders ranked tech cards', async () => {
    (customerApi.techsNearby as any).mockResolvedValue({ radiusMiles: 15, results: [card] });
    (globalThis.navigator as any).geolocation = { getCurrentPosition: (okCb: any) => okCb({ coords: { latitude: 39.93, longitude: -75.02 } }) };
    render(<MemoryRouter><FindTechsScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Allow Location' }));
    expect(await screen.findByText('Mia Tran')).toBeInTheDocument();
    expect(screen.getByText(/Palace Nails · 1.2 mi/)).toBeInTheDocument();
    expect(customerApi.techsNearby).toHaveBeenCalledWith({ lat: 39.93, lng: -75.02, radiusMiles: 15, q: undefined, minRating: undefined });
    expect(screen.getAllByText(/Featured/).length).toBeGreaterThan(0); // card chip + sort button both render
    expect(screen.getByText(/Next:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '4★+' }));
    await waitFor(() => expect(customerApi.techsNearby).toHaveBeenLastCalledWith({ lat: 39.93, lng: -75.02, radiusMiles: 15, q: undefined, minRating: 4 }));
  });
});

describe('CustomerTechProfileScreen (P4)', () => {
  it('renders the premium profile and gates booking per salon (my salon books, other shows the honest note)', async () => {
    (customerApi.techProfile as any).mockResolvedValue(profile);
    render(<MemoryRouter initialEntries={['/techs/mia-tran']}><Routes><Route path="/techs/:slug" element={<CustomerTechProfileScreen />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Mia Tran')).toBeInTheDocument();
    expect(screen.getByText('Nail Design Gallery')).toBeInTheDocument();
    expect(screen.getByText('Jessica L.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View LinkMe Profile' })).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Book With This Tech' }));
    expect(await screen.findByText('Book Mia Tran')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Appointment' })).toBeInTheDocument(); // my salon (b1)
    expect(screen.getByText(/signed in with a different salon/)).toBeInTheDocument(); // other salon (b2)
    expect(screen.getAllByText('Top Rated').length).toBeGreaterThan(0); // badge chip
    expect(screen.getByText('Services I do here')).toBeInTheDocument();
    expect(screen.getAllByText(/Next available:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Service: Gel Manicure/)).toBeInTheDocument(); // review service line
  });

  it('favorite heart toggles through the tech-favorites API', async () => {
    (customerApi.techProfile as any).mockResolvedValue(profile);
    (customerApi.techFavorites as any).mockResolvedValue({ slugs: [], techs: [] });
    render(<MemoryRouter initialEntries={['/techs/mia-tran']}><Routes><Route path="/techs/:slug" element={<CustomerTechProfileScreen />} /></Routes></MemoryRouter>);
    const heart = await screen.findByRole('button', { name: 'Add to favorites' });
    fireEvent.click(heart);
    await waitFor(() => expect(customerApi.addTechFavorite).toHaveBeenCalledWith({ publicSlug: 'mia-tran' }));
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument();
  });
});

describe('RateTechScreen (P4)', () => {
  it('submits stars + whitelist tags and shows the thank-you copy', async () => {
    (customerApi.submitTechRating as any).mockResolvedValue({ ok: true, message: 'Thank you! Your rating helps customers choose the right technician.' });
    render(<MemoryRouter initialEntries={['/rate-tech/tk1/t1?name=Mia%20Tran']}><Routes><Route path="/rate-tech/:ticketId/:technicianId" element={<RateTechScreen />} /></Routes></MemoryRouter>);
    expect(screen.getByText('How was your service with Mia Tran?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clean Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Rating' }));
    await waitFor(() => expect(customerApi.submitTechRating).toHaveBeenCalledWith('tk1', { technicianId: 't1', rating: 5, reviewText: undefined, tags: ['Clean Work'], isPublic: true }));
    expect(await screen.findByText('Thank you! Your rating helps customers choose the right technician.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book again with Mia Tran' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '♡ Favorite this tech' })).toBeInTheDocument();
  });

  it('loads an existing rating into edit mode and PATCHes within the window (doc 7-day rule)', async () => {
    (customerApi.myTechRating as any).mockResolvedValue({ exists: true, ratingId: 'rv1', rating: 5, reviewText: 'Great', tags: ['Friendly'], editable: true, editableUntil: new Date(Date.now() + 86400000).toISOString() });
    (customerApi.updateTechRating as any).mockResolvedValue({ ok: true, message: 'Your rating was updated.' });
    render(<MemoryRouter initialEntries={['/rate-tech/tk1/t1?name=Mia%20Tran']}><Routes><Route path="/rate-tech/:ticketId/:technicianId" element={<RateTechScreen />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/you can update it within 7 days/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Rating' }));
    await waitFor(() => expect(customerApi.updateTechRating).toHaveBeenCalledWith('tk1', 'rv1', { rating: 4, reviewText: 'Great', tags: ['Friendly'] }));
    expect(await screen.findByText('Your rating was updated.')).toBeInTheDocument();
  });
});
