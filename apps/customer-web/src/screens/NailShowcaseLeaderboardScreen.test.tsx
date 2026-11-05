import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerNailShowcaseLeaderboardApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerNailShowcaseLeaderboardApi')>()),
  customerNailShowcaseLeaderboardApi: { leaderboard: vi.fn(), myRank: vi.fn() },
}));
vi.mock('../api/customerFollowApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerFollowApi')>()),
  customerFollowApi: { follow: vi.fn(), unfollow: vi.fn(), followers: vi.fn(), following: vi.fn(), followingFeed: vi.fn() },
}));
import { customerNailShowcaseLeaderboardApi } from '../api/customerNailShowcaseLeaderboardApi';
import type { LeaderboardEntry } from '../api/customerNailShowcaseLeaderboardApi';
import { NailShowcaseLeaderboardScreen } from './NailShowcaseLeaderboardScreen';

const entry = (over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank: 1, customerId: 'c1', displayName: 'Sophia N.', score: 1284, likesCount: 500, commentsCount: 140,
  dislikesCount: 16, postsCount: 7, followerCount: 30, isFollowing: false, isMe: false, ...over,
});

describe('NailShowcaseLeaderboardScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all six tier filters and the returned creators, and never shows a non-returned (private) user', async () => {
    (customerNailShowcaseLeaderboardApi.myRank as any).mockResolvedValue({ ranked: false, rank: null, score: 0, likesCount: 0, commentsCount: 0, dislikesCount: 0, postsCount: 0, isPublic: false });
    (customerNailShowcaseLeaderboardApi.leaderboard as any).mockResolvedValue({
      scope: 'platform', period: 'all_time', limit: 10,
      entries: [entry(), entry({ rank: 2, customerId: 'c2', displayName: 'Mia R.' })],
    });
    render(<MemoryRouter><NailShowcaseLeaderboardScreen /></MemoryRouter>);

    for (const t of ['Top 10', 'Top 20', 'Top 30', 'Top 50', 'Top 100', 'Top 500']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
    expect(await screen.findByText('Sophia N.')).toBeInTheDocument();
    expect(screen.getByText('Mia R.')).toBeInTheDocument();
    // A private creator the server excluded is simply never rendered.
    expect(screen.queryByText('Private Pat')).not.toBeInTheDocument();
  });
});
