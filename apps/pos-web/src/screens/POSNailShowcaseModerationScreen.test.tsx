import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSNailShowcaseModerationScreen } from './POSNailShowcaseModerationScreen';

const post = {
  id: 'p1', caption: 'French chrome tips', displayName: 'Sophia N.', status: 'pending_review', postType: 'manual_upload',
  isVerifiedService: false, visibility: 'salon_only', salonName: 'Luxe Nails', technicianName: 'Linh Tran', serviceName: 'Gel X Full Set',
  likeCount: 4, dislikeCount: 0, commentCount: 1, reportCount: 1, photos: [{ id: 'ph1', imageUrl: '/media/x.jpg', thumbnailUrl: '/media/x.jpg' }], createdAt: '2026-06-10T00:00:00Z',
};
const report = { id: 'r1', postId: 'p1', commentId: null, reason: 'inappropriate', details: null, status: 'open', createdAt: '2026-06-11T00:00:00Z' };

const mockFetch = () => vi.fn(async (url: string) => {
  const body = String(url).includes('/reports') ? [report] : [post];
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSNailShowcaseModerationScreen', () => {
  it('renders this salon’s posts and the open report queue with manager actions', async () => {
    globalThis.fetch = mockFetch() as any;
    render(<POSNailShowcaseModerationScreen />);
    expect(await screen.findByText('NailShowcase Moderation')).toBeInTheDocument();
    expect(await screen.findByText('French chrome tips')).toBeInTheDocument();
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(1);   // KPI label + the status pill
    expect(screen.getAllByText('Approve').length).toBeGreaterThan(0);       // pending → can approve
    expect(await screen.findByText(/Post reported/)).toBeInTheDocument();   // report queue row
    expect(screen.getByText('Action taken')).toBeInTheDocument();
  });
});
