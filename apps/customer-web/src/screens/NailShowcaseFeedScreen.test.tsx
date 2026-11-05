import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerNailShowcaseApi', () => ({ customerNailShowcaseApi: { feed: vi.fn(), react: vi.fn(), post: vi.fn() } }));
import { customerNailShowcaseApi } from '../api/customerNailShowcaseApi';
import { NailShowcaseFeedScreen } from './NailShowcaseFeedScreen';

const post = {
  id: 'p1', caption: 'French chrome tips ✨', tags: ['Chrome', 'French Tips'], visibility: 'salon_only', postType: 'verified_service',
  status: 'published', isVerifiedService: true, allowComments: true, displayName: 'Sophia N.',
  salonTenantId: 't1', branchId: 'b1', technicianId: 'te1', serviceId: 'sv1',
  salonName: 'Luxe Nails', technicianName: 'Linh Tran', serviceName: 'Gel X Full Set',
  likeCount: 128, dislikeCount: 2, commentCount: 18, reportCount: 0, myReaction: null, isMine: false,
  photos: [{ id: 'ph1', imageUrl: '/media/x.jpg', thumbnailUrl: '/media/x.jpg', sortOrder: 0, caption: null }], createdAt: '2026-06-10T00:00:00Z',
};

describe('NailShowcaseFeedScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a post card with caption, verified badge, and reaction/comment counts', async () => {
    (customerNailShowcaseApi.feed as any).mockResolvedValue({ posts: [post], nextCursor: null });
    render(<MemoryRouter><NailShowcaseFeedScreen /></MemoryRouter>);
    expect(await screen.findByText('French chrome tips ✨')).toBeInTheDocument();
    expect(screen.getByText('Sophia N.')).toBeInTheDocument();
    expect(screen.getByText('✓ Verified Service')).toBeInTheDocument();
    expect(screen.getByText('❤️ 128')).toBeInTheDocument();
    expect(screen.getByText('👎 2')).toBeInTheDocument();
    expect(screen.getByText('💬 18')).toBeInTheDocument();
    expect(screen.getByText('Gel X Full Set')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails')).toBeInTheDocument();
    expect(screen.getAllByText('Book This Look').length).toBeGreaterThan(0);
  });

  it('shows an honest empty state when there are no posts', async () => {
    (customerNailShowcaseApi.feed as any).mockResolvedValue({ posts: [], nextCursor: null });
    render(<MemoryRouter><NailShowcaseFeedScreen /></MemoryRouter>);
    expect(await screen.findByText('No designs here yet')).toBeInTheDocument();
  });

  it('shows an error state when the feed fails to load', async () => {
    (customerNailShowcaseApi.feed as any).mockRejectedValue(new Error('network down'));
    render(<MemoryRouter><NailShowcaseFeedScreen /></MemoryRouter>);
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});
