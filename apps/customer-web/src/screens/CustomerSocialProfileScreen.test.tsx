import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('../api/customerSocialApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerSocialApi')>()),
  customerSocialApi: { myProfile: vi.fn(), updateMyProfile: vi.fn(), profile: vi.fn(), profilePosts: vi.fn(), report: vi.fn(), uploadAvatar: vi.fn() },
}));
vi.mock('../api/customerFollowApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerFollowApi')>()),
  customerFollowApi: { follow: vi.fn(), unfollow: vi.fn(), followers: vi.fn(), following: vi.fn(), followingFeed: vi.fn(), block: vi.fn(), unblock: vi.fn(), blocked: vi.fn() },
}));
import { customerSocialApi } from '../api/customerSocialApi';
import { customerFollowApi } from '../api/customerFollowApi';
import { CustomerSocialProfileScreen } from './CustomerSocialProfileScreen';

const renderAt = (id: string) => render(
  <MemoryRouter initialEntries={[`/social/profile/${id}`]}>
    <Routes><Route path="/social/profile/:customerId" element={<CustomerSocialProfileScreen />} /></Routes>
  </MemoryRouter>,
);

const publicProfile = (over: Record<string, unknown> = {}) => ({
  customerId: 'c1', isMine: false, isPrivate: false, displayName: 'Sophia N.', avatarUrl: null, bio: 'Gel art lover',
  rank: 8, score: 1284, followerCount: 30, followingCount: 12, isFollowing: false, allowFollowers: true,
  showPostsOnProfile: true, showRankOnProfile: true, ...over,
});

describe('CustomerSocialProfileScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows avatar, name, rank and score for a public profile', async () => {
    (customerSocialApi.profile as any).mockResolvedValue(publicProfile());
    (customerSocialApi.profilePosts as any).mockResolvedValue({ posts: [] });
    renderAt('c1');
    expect(await screen.findByText('Sophia N.')).toBeInTheDocument();
    expect(screen.getByText('#8')).toBeInTheDocument();
    expect(screen.getByText('Top 10')).toBeInTheDocument();
    expect(screen.getByText(/Score: 1,284/)).toBeInTheDocument();
  });

  it('shows the private message for someone else\'s private profile', async () => {
    (customerSocialApi.profile as any).mockResolvedValue({ customerId: 'c2', isMine: false, isPrivate: true });
    renderAt('c2');
    expect(await screen.findByText('This profile is private.')).toBeInTheDocument();
  });

  it('shows a Block control on another customer\'s profile and calls block when tapped', async () => {
    (customerSocialApi.profile as any).mockResolvedValue(publicProfile());
    (customerSocialApi.profilePosts as any).mockResolvedValue({ posts: [] });
    (customerFollowApi.block as any).mockResolvedValue({ blocked: true });
    renderAt('c1');
    const blockBtn = await screen.findByText('Block');
    fireEvent.click(blockBtn);
    await waitFor(() => expect(customerFollowApi.block).toHaveBeenCalledWith('c1'));
  });

  it('reflects a blocked profile with an Unblock control instead of Follow', async () => {
    (customerSocialApi.profile as any).mockResolvedValue(publicProfile({ isBlockedByMe: true }));
    (customerSocialApi.profilePosts as any).mockResolvedValue({ posts: [] });
    renderAt('c1');
    expect(await screen.findByText('You blocked this customer')).toBeInTheDocument();
    expect(screen.getByText('Unblock')).toBeInTheDocument();
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });
});
