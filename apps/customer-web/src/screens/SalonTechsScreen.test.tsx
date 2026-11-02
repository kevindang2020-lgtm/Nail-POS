// SalonTechsScreen (customer): "All Technicians" for one salon (public cards). Verifies card rendering + rating/specialties,
// View Profile nav, the single-salon-session Book rule (Book at your own salon vs. an honest note otherwise), the empty
// state, and the error path. Tech rows are any-typed, so these reads are checked against the backend publicCard shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navMock = vi.fn();
const authState = vi.hoisted(() => ({ principal: { branchId: 'b1' } as any }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navMock, useParams: () => ({ salonId: 'b1' }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../api/customerApi', () => ({ customerApi: { salonTechnicians: vi.fn() } }));

import { customerApi } from '../api/customerApi';
import SalonTechsScreen from './SalonTechsScreen';

const t1 = { publicSlug: 'jane', technicianId: 'tech1', displayName: 'Jane Nguyen', title: 'Senior Artist', avatarUrl: null, averageRating: 4.8, reviewCount: 32, specialties: ['Gel-X', 'Chrome'], featuredPortfolioPhotos: [], badges: ['Top Rated'], isFeatured: true, isBookable: true, nextAvailable: { date: '2026-06-18', startTime: '14:30' } };
const t2 = { publicSlug: 'mary', technicianId: 'tech2', displayName: 'Mary Lee', title: null, avatarUrl: null, averageRating: 0, reviewCount: 0, specialties: [], featuredPortfolioPhotos: [], badges: [], isFeatured: false, isBookable: false, nextAvailable: null };

beforeEach(() => {
  vi.clearAllMocks();
  authState.principal = { branchId: 'b1' };
  (customerApi.salonTechnicians as any).mockResolvedValue({ salonId: 'b1', technicians: [t1, t2] });
});

describe('SalonTechsScreen', () => {
  it('renders technician cards with rating and a Book button at your own salon', async () => {
    render(<SalonTechsScreen />);
    expect(await screen.findByText('Jane Nguyen')).toBeInTheDocument();
    expect(screen.getByText('Mary Lee')).toBeInTheDocument();
    expect(screen.getByText(/4\.8/)).toBeInTheDocument();
    expect(screen.getAllByText('View Profile')).toHaveLength(2);
    expect(screen.getByText('Book')).toBeInTheDocument();       // only t1 is bookable
  });

  it('navigates to a tech profile from View Profile', async () => {
    render(<SalonTechsScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getAllByText('View Profile')[0]);
    expect(navMock).toHaveBeenCalledWith('/techs/jane');
  });

  it('books the tech at your own salon', async () => {
    render(<SalonTechsScreen />);
    await screen.findByText('Jane Nguyen');
    fireEvent.click(screen.getByText('Book'));
    expect(navMock).toHaveBeenCalledWith('/book?techId=tech1');
  });

  it('shows the sign-in note instead of Book at a different salon', async () => {
    authState.principal = { branchId: 'other' };
    render(<SalonTechsScreen />);
    await screen.findByText('Jane Nguyen');
    expect(screen.getByText('Sign in with this salon to book in-app')).toBeInTheDocument();
    expect(screen.queryByText('Book')).not.toBeInTheDocument();
  });

  it('shows the empty state when the salon has no public techs', async () => {
    (customerApi.salonTechnicians as any).mockResolvedValue({ salonId: 'b1', technicians: [] });
    render(<SalonTechsScreen />);
    expect(await screen.findByText('No public technician profiles at this salon yet.')).toBeInTheDocument();
  });

  it('shows an error when technicians cannot be loaded', async () => {
    (customerApi.salonTechnicians as any).mockRejectedValue({ message: 'Could not load technicians.' });
    render(<SalonTechsScreen />);
    expect(await screen.findByText('Could not load technicians.')).toBeInTheDocument();
  });
});
