// CustomerTechProfileScreen (public tech profile, read-only, any-typed): hero + rating, portfolio gallery with tag filter,
// about, reviews, available-at salons, favorite heart, and the book sheet with the honest single-salon-session rule.
// Confirms the screen's ~30 untyped field reads line up with the backend /customer/techs/:slug view, and the booking gate.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const navMock = vi.fn();
const authState = vi.hoisted(() => ({ principal: { branchId: 'br1' } as any }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ slug: 'jane-nails' }), useNavigate: () => navMock }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../api/customerApi', () => ({ customerApi: { techProfile: vi.fn(), techFavorites: vi.fn(), addTechFavorite: vi.fn(), removeTechFavorite: vi.fn() } }));

import { customerApi } from '../api/customerApi';
import { CustomerTechProfileScreen } from './CustomerTechProfileScreen';

const profile = (over: any = {}) => ({
  publicSlug: 'jane-nails', displayName: 'Jane Nguyen', title: 'Senior Nail Artist', avatarUrl: null,
  bio: 'Ten years of chrome and gel-x.', yearsExperience: 10, wouldBookAgainPct: 92,
  specialties: ['Gel-X', 'Chrome'], languages: ['English', 'Vietnamese'], profileLinks: { instagram: 'https://instagram.com/jane' },
  averageRating: 4.8, reviewCount: 12,
  ratingBreakdown: [{ star: 5, pct: 80 }, { star: 4, pct: 15 }, { star: 3, pct: 5 }, { star: 2, pct: 0 }, { star: 1, pct: 0 }],
  isBookable: true, badges: ['Top Rated'],
  portfolio: [
    { photoId: 'ph1', imageUrl: '/i1.jpg', thumbnailUrl: '/t1.jpg', caption: 'Chrome French', tags: ['Chrome'], serviceCategory: null, isFeatured: true, nailShape: 'Almond', nailLength: 'Long', designStyle: 'Chrome', complexity: 'Detailed', brand: null, colorName: 'Silver' },
    { photoId: 'ph2', imageUrl: '/i2.jpg', thumbnailUrl: '/t2.jpg', caption: 'Gel-X almond', tags: ['Gel-X'], serviceCategory: null, isFeatured: false, nailShape: null, nailLength: null, designStyle: null, complexity: null, brand: null, colorName: null },
  ],
  reviews: [{ rating: 5, reviewText: 'Amazing work!', tags: ['Would Book Again'], reviewer: 'Sarah M.', serviceName: 'Gel-X Full Set', createdAt: '2026-05-01T00:00:00.000Z' }],
  availableAt: [{ salonId: 'br1', technicianId: 'tech1', salonName: 'Lotus Nails', address: '123 Main St, Cherry Hill, NJ', nextAvailableAt: { date: '2026-06-18', startTime: '14:30' }, services: [{ serviceId: 's1', name: 'Gel-X Full Set', durationMinutes: 60, priceCents: 6500, isPrimary: true }] }],
  beforeAfter: [{ setId: 'ba1', beforeImageUrl: '/b1.jpg', beforeThumbnailUrl: '/b1.jpg', afterImageUrl: '/a1.jpg', afterThumbnailUrl: '/a1.jpg', servicePerformed: 'Acrylic full set', designNotes: 'Chrome ombré', productsUsed: null, durationMinutes: 75 }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.principal = { branchId: 'br1' };
  (customerApi.techProfile as any).mockResolvedValue(profile());
  (customerApi.techFavorites as any).mockResolvedValue({ slugs: [], techs: [] });
  (customerApi.addTechFavorite as any).mockResolvedValue({ ok: true, publicSlug: 'jane-nails', displayName: 'Jane Nguyen' });
  (customerApi.removeTechFavorite as any).mockResolvedValue({ ok: true });
});

describe('CustomerTechProfileScreen', () => {
  it('renders the hero, reviews, portfolio and available-at salons', async () => {
    render(<CustomerTechProfileScreen />);
    expect(await screen.findByText('Jane Nguyen')).toBeInTheDocument();
    expect(screen.getByText('4.8 ★')).toBeInTheDocument();
    expect(screen.getByText('Ten years of chrome and gel-x.')).toBeInTheDocument();   // bio
    expect(screen.getByText('Amazing work!')).toBeInTheDocument();                     // review text
    expect(screen.getByText('Sarah M.')).toBeInTheDocument();                          // reviewer
    expect(screen.getByAltText('Chrome French')).toBeInTheDocument();                  // portfolio photo
    expect(screen.getByText('Lotus Nails')).toBeInTheDocument();                       // available-at salon
  });

  it('shows an error when the profile cannot be loaded', async () => {
    (customerApi.techProfile as any).mockRejectedValue({ message: 'This profile is not available.' });
    render(<CustomerTechProfileScreen />);
    expect(await screen.findByText('This profile is not available.')).toBeInTheDocument();
  });

  it('adds the tech to favorites from the heart', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByLabelText('Add to favorites'));
    await waitFor(() => expect(customerApi.addTechFavorite).toHaveBeenCalledWith({ publicSlug: 'jane-nails' }));
    expect(screen.getByLabelText('Remove from favorites')).toBeInTheDocument();
  });

  it('books at the customer\'s own salon from the book sheet', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByText('Book With This Tech'));
    fireEvent.click(await screen.findByText('Book Appointment'));
    expect(navMock).toHaveBeenCalledWith('/book?techId=tech1');
  });

  it('shows the call-to-book note for a salon the customer is not signed in with', async () => {
    authState.principal = { branchId: 'someone-else' };
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByText('Book With This Tech'));
    expect(await screen.findByText(/call to book, or sign in with an account for this salon/i)).toBeInTheDocument();
    expect(screen.queryByText('Book Appointment')).not.toBeInTheDocument();
  });

  it('filters the portfolio gallery by style tag', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    expect(screen.getByAltText('Chrome French')).toBeInTheDocument();
    expect(screen.getByAltText('Gel-X almond')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('portfolio-tag-filter')).getByText('Gel-X'));
    expect(screen.queryByAltText('Chrome French')).not.toBeInTheDocument();
    expect(screen.getByAltText('Gel-X almond')).toBeInTheDocument();
  });

  it('filters the portfolio gallery by a structured nail-shape facet (not a tag)', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(within(screen.getByTestId('portfolio-tag-filter')).getByText('Almond')); // ph1.nailShape only
    expect(screen.getByAltText('Chrome French')).toBeInTheDocument();
    expect(screen.queryByAltText('Gel-X almond')).not.toBeInTheDocument();
  });

  it('shows before & after sets with labels and the service performed', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    expect(screen.getByText('Before & After')).toBeInTheDocument();
    expect(screen.getByText('BEFORE')).toBeInTheDocument();
    expect(screen.getByText('AFTER')).toBeInTheDocument();
    expect(screen.getByAltText('Before — Acrylic full set')).toBeInTheDocument();
    expect(screen.getByAltText('After — Acrylic full set')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /before and after comparison/i })).toBeInTheDocument();
    expect(screen.getByText('Chrome ombré')).toBeInTheDocument();
  });

  it('offers Book This Look from a portfolio photo and carries it into the booking flow', async () => {
    render(<CustomerTechProfileScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByLabelText('Chrome French'));   // open the lightbox for ph1
    fireEvent.click(screen.getByText('Book This Look'));       // start a look-anchored booking
    expect(screen.getByText('Booking this look')).toBeInTheDocument();   // the modal now references the chosen look
  });
});
