// TechProfileScreen (tech, mutation-heavy): the portable public profile. Verifies the hero/ratings render, Save sends the
// transformed payload (comma lists -> arrays, years -> number), a visibility toggle PATCHes the single flag, the photo
// feature action, the "Connect to New Salon" request (+ returned message), and a load error. Field reads are typed; this
// locks the save transformation and the mutation wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/techApi', () => ({
  techApi: {
    profile: vi.fn(), myPhotos: vi.fn(), myRatings: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn(),
    addPhotos: vi.fn(), reorderPhotos: vi.fn(), updatePhoto: vi.fn(), deletePhoto: vi.fn(), publicPreview: vi.fn(),
    setPhotoConsent: vi.fn(), withdrawPhotoConsent: vi.fn(),
    listBeforeAfter: vi.fn(), createBeforeAfter: vi.fn(), updateBeforeAfter: vi.fn(), deleteBeforeAfter: vi.fn(),
    requestMembership: vi.fn(), cancelMembershipRequest: vi.fn(), analytics: vi.fn(),
  },
}));

import { techApi } from '../api/techApi';
import { TechProfileScreen } from './TechProfileScreen';

const profile = (over: any = {}) => ({
  profileId: 'pr1', publicSlug: 'jane', displayName: 'Jane Doe', title: 'Senior Nail Artist', avatarUrl: null,
  bio: 'I love nails', yearsExperience: 5, specialties: ['Gel', 'Chrome'], languages: ['English', 'Spanish'],
  profileLinks: { instagram: 'https://insta/jane' }, profileLinkVisibility: {}, isPublic: true, isBookable: true, marketplaceDiscoveryEnabled: false,
  overallRating: 4.8, ratingCount: 42, portfolioPhotoCount: 6, verifiedCompletedServicesCount: 120,
  servicesHere: [{ serviceId: 'svc1', name: 'Gel Manicure', isPrimary: true }], completionPercent: 85,
  memberships: [{ membershipId: 'm1', tenantId: 't1', branchId: null, salonName: 'Glow Studio', status: 'pending', requestedAt: '2026-06-01' }], ...over,
});
const photos = () => [{ photoId: 'ph1', imageUrl: 'https://img/1', thumbnailUrl: 'https://thumb/1', caption: 'Pink ombre', tags: [], serviceCategory: null, isPublic: true, isFeatured: false, moderationStatus: 'approved', sortOrder: 0, createdAt: '2026-06-01', nailShape: null, nailLength: null, designStyle: null, complexity: null, brand: null, colorName: null, consent: null }];
const ratings = () => ({ overallRating: 4.8, ratingCount: 42, breakdown: { '5': 30, '4': 8, '3': 2, '2': 1, '1': 1 }, recent: [{ rating: 5, comment: 'Amazing!', tags: ['Friendly'], reviewer: 'A. K.', createdAt: '2026-06-10' }] });

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.profile as any).mockResolvedValue(profile());
  (techApi.myPhotos as any).mockResolvedValue(photos());
  (techApi.myRatings as any).mockResolvedValue(ratings());
  (techApi.analytics as any).mockResolvedValue({ windowDays: 30, totals: { profileViews: 0, linkClicks: 0, postTaps: 0, messagesOpened: 0 }, dailyViews: [], topLinks: [], topPosts: [] });
  (techApi.updateProfile as any).mockImplementation((patch: any) => Promise.resolve(profile(patch)));
  (techApi.updatePhoto as any).mockResolvedValue({ ok: true });
  (techApi.setPhotoConsent as any).mockResolvedValue({ ok: true, consent: { approvedUses: ['portfolio'], revoked: false } });
  (techApi.withdrawPhotoConsent as any).mockResolvedValue({ ok: true, consent: { approvedUses: [], revoked: true } });
  (techApi.listBeforeAfter as any).mockResolvedValue([]);
  (techApi.createBeforeAfter as any).mockResolvedValue({ ok: true, setId: 'ba1' });
  (techApi.updateBeforeAfter as any).mockResolvedValue({ ok: true });
  (techApi.deleteBeforeAfter as any).mockResolvedValue({ ok: true });
  (techApi.requestMembership as any).mockResolvedValue({ ok: true, status: 'pending', salonName: 'Glow Studio', message: 'Request sent to Glow Studio.' });
});

afterEach(() => {
  cleanup();
});

describe('TechProfileScreen', () => {
  it('renders the hero and ratings', async () => {
    render(<TechProfileScreen />);
    const names = await screen.findAllByText('Jane Doe');
    expect(names[0]).toBeInTheDocument();      // hero name
    expect(screen.getByText(/85% complete/)).toBeInTheDocument();
    expect(screen.getByText(/6 photos/)).toBeInTheDocument();
  });

  it('saves the transformed profile payload (lists -> arrays, years -> number)', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    fireEvent.click(screen.getByText('Save Profile'));
    await waitFor(() => expect(techApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Jane Doe', title: 'Senior Nail Artist', yearsExperience: 5,
      specialties: ['Gel', 'Chrome'], languages: ['English', 'Spanish'],
    })));
  });

  it('sends per-link visibility when the technician restricts a link to booked customers', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    fireEvent.change(screen.getByLabelText('Instagram visibility'), { target: { value: 'booked_only' } });
    fireEvent.click(screen.getByText('Save Profile'));
    await waitFor(() => expect(techApi.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      profileLinkVisibility: expect.objectContaining({ instagram: 'booked_only' }),
    })));
  });

  it('toggles a single visibility flag', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    const row = screen.getByText('Public profile').parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));                     // currently On -> turn off
    await waitFor(() => expect(techApi.updateProfile).toHaveBeenCalledWith({ isPublic: false }));
  });

  it('features a portfolio photo', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    fireEvent.click(screen.getByText('☆ Feature'));                       // isFeatured false -> true
    await waitFor(() => expect(techApi.updatePhoto).toHaveBeenCalledWith('ph1', { isFeatured: true }));
  });

  it('records customer consent for a photo with the checked public uses', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    fireEvent.click(screen.getByLabelText('Portfolio consent'));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes|Save Consent & Details/i }));
    await waitFor(() => expect(techApi.setPhotoConsent).toHaveBeenCalledWith('ph1', expect.objectContaining({ approvedUses: ['portfolio'] })));
  });

  it('shows the Before & After uploader and warns if a pair is incomplete', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    expect(screen.getByLabelText('Before image')).toBeInTheDocument();
    expect(screen.getByLabelText('After image')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add before/after set'));        // no files chosen
    expect(await screen.findByText(/Add both a before and an after photo/)).toBeInTheDocument();
    expect(techApi.createBeforeAfter).not.toHaveBeenCalled();
  });

  it('sends a connect-to-new-salon request and shows the returned message', async () => {
    render(<TechProfileScreen />);
    await screen.findAllByText('Jane Doe');
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'glow99' } });   // upper-cased by the screen
    fireEvent.click(screen.getByText('Send Request'));
    await waitFor(() => expect(techApi.requestMembership).toHaveBeenCalledWith('GLOW99', undefined));
    expect(await screen.findByText('Request sent to Glow Studio.')).toBeInTheDocument();
  });

  it('shows an error when the profile fails to load', async () => {
    (techApi.profile as any).mockRejectedValue(new Error('profile unavailable'));
    render(<TechProfileScreen />);
    expect(await screen.findByText('profile unavailable')).toBeInTheDocument();
  });
});
