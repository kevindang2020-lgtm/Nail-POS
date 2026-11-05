import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerNailShowcaseLeaderboardApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerNailShowcaseLeaderboardApi')>()),
  customerNailShowcaseLeaderboardApi: { leaderboard: vi.fn(), myRank: vi.fn() },
}));
import { customerNailShowcaseLeaderboardApi } from '../api/customerNailShowcaseLeaderboardApi';
import { NailShowcaseMyRankCard } from './NailShowcaseMyRankCard';

const renderCard = () => render(<MemoryRouter><NailShowcaseMyRankCard /></MemoryRouter>);

describe('NailShowcaseMyRankCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows rank, tier and score when the customer is ranked', async () => {
    (customerNailShowcaseLeaderboardApi.myRank as any).mockResolvedValue({ ranked: true, rank: 8, score: 1284, likesCount: 500, commentsCount: 140, dislikesCount: 16, postsCount: 7, isPublic: true });
    renderCard();
    expect(await screen.findByText('#8')).toBeInTheDocument();
    expect(screen.getByText('Top 10')).toBeInTheDocument();
    expect(screen.getByText('Score: 1,284')).toBeInTheDocument();
  });

  it('prompts a private customer to go public', async () => {
    (customerNailShowcaseLeaderboardApi.myRank as any).mockResolvedValue({ ranked: false, rank: null, score: 0, likesCount: 0, commentsCount: 0, dislikesCount: 0, postsCount: 0, isPublic: false });
    renderCard();
    expect(await screen.findByText(/Make it public to appear in NailShowcase rankings/)).toBeInTheDocument();
  });
});
