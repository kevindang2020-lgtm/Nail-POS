// NailShowcasePostDetailScreen (customer): post detail with photo gallery, like/dislike, comments (add/delete-own/report),
// Book Similar, and report/delete. Verifies the render (caption/author/salon/tags/comments + Delete-vs-Report), the like
// reaction call, posting a comment (+ draft clear), deleting an own comment, the comments-off state, and Book Similar nav.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navMock, useParams: () => ({ postId: 'p1' }) }));
vi.mock('../api/customerNailShowcaseApi', () => ({ customerNailShowcaseApi: {
  post: vi.fn(), comments: vi.fn(), react: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(), reportComment: vi.fn(), reportPost: vi.fn(), deletePost: vi.fn(),
} }));

import { customerNailShowcaseApi } from '../api/customerNailShowcaseApi';
import { NailShowcasePostDetailScreen } from './NailShowcasePostDetailScreen';

const post = (over: any = {}) => ({
  id: 'p1', caption: 'Chrome French tips', tags: ['Chrome', 'French Tips'], visibility: 'salon_only', postType: 'manual_upload', status: 'active',
  isVerifiedService: true, allowComments: true, displayName: 'Jane D.',
  salonTenantId: 't1', branchId: 'b1', technicianId: 'tech1', serviceId: 's1',
  salonName: 'Lotus Nails', technicianName: 'Mary', serviceName: 'Gel-X',
  likeCount: 12, dislikeCount: 1, commentCount: 2, reportCount: 0,
  myReaction: null, isMine: false, photos: [{ id: 'ph1', imageUrl: '/i1.jpg', thumbnailUrl: '/t1.jpg', sortOrder: 0, caption: 'front' }], createdAt: '2026-06-15T00:00:00.000Z', ...over,
});
const comments = [
  { id: 'c1', postId: 'p1', displayName: 'Me', commentText: 'Love this!', status: 'active', isMine: true, createdAt: '2026-06-16T00:00:00.000Z' },
  { id: 'c2', postId: 'p1', displayName: 'Sara', commentText: 'Gorgeous', status: 'active', isMine: false, createdAt: '2026-06-16T00:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  (customerNailShowcaseApi.post as any).mockResolvedValue(post());
  (customerNailShowcaseApi.comments as any).mockResolvedValue(comments);
  for (const m of ['react', 'addComment', 'deleteComment', 'reportComment', 'reportPost', 'deletePost'] as const) (customerNailShowcaseApi[m] as any).mockResolvedValue({});
});

describe('NailShowcasePostDetailScreen', () => {
  it('renders the post, photos and comments with the right per-comment action', async () => {
    render(<NailShowcasePostDetailScreen />);
    expect(await screen.findByText('Chrome French tips')).toBeInTheDocument();
    expect(screen.getByText(/Jane D\./)).toBeInTheDocument();
    expect(screen.getByText('Lotus Nails')).toBeInTheDocument();
    expect(screen.getByAltText('front')).toBeInTheDocument();
    expect(screen.getByText('Love this!')).toBeInTheDocument();
    expect(screen.getByText('Gorgeous')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();    // c1 is mine
    expect(screen.getByText('Report')).toBeInTheDocument();    // c2 is not
  });

  it('sends a like reaction', async () => {
    render(<NailShowcasePostDetailScreen />);
    await screen.findByText('Chrome French tips');
    fireEvent.click(screen.getByRole('button', { name: /❤️/ }));
    await waitFor(() => expect(customerNailShowcaseApi.react).toHaveBeenCalledWith('p1', 'like'));
  });

  it('posts a comment and clears the draft', async () => {
    render(<NailShowcasePostDetailScreen />);
    await screen.findByText('Chrome French tips');
    const input = screen.getByPlaceholderText('Add a comment…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nice!' } });
    fireEvent.click(screen.getByText('Post'));
    await waitFor(() => expect(customerNailShowcaseApi.addComment).toHaveBeenCalledWith('p1', 'Nice!'));
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('deletes an own comment', async () => {
    render(<NailShowcasePostDetailScreen />);
    await screen.findByText('Love this!');
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(customerNailShowcaseApi.deleteComment).toHaveBeenCalledWith('c1'));
  });

  it('hides the comment box when comments are off', async () => {
    (customerNailShowcaseApi.post as any).mockResolvedValue(post({ allowComments: false }));
    render(<NailShowcasePostDetailScreen />);
    expect(await screen.findByText('Comments are turned off for this post.')).toBeInTheDocument();
    expect(screen.queryByText('Post')).not.toBeInTheDocument();
  });

  it('books a similar service carrying service and tech ids', async () => {
    render(<NailShowcasePostDetailScreen />);
    await screen.findByText('Chrome French tips');
    fireEvent.click(screen.getByText('Book This Look'));
    expect(navMock).toHaveBeenCalledWith('/book?serviceId=s1&technicianId=tech1');
  });
});
