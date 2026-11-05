import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/customerFollowApi', async (orig) => ({
  ...(await orig<typeof import('../api/customerFollowApi')>()),
  customerFollowApi: { follow: vi.fn(), unfollow: vi.fn(), followers: vi.fn(), following: vi.fn(), followingFeed: vi.fn() },
}));
import { customerFollowApi } from '../api/customerFollowApi';
import { CustomerFollowButton } from './CustomerFollowButton';

describe('CustomerFollowButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('follows when not yet following', async () => {
    (customerFollowApi.follow as any).mockResolvedValue({ following: true, followerCount: 1 });
    render(<CustomerFollowButton customerId="c1" following={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(customerFollowApi.follow).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('button', { name: 'Following' })).toBeInTheDocument();
  });

  it('unfollows when already following', async () => {
    (customerFollowApi.unfollow as any).mockResolvedValue({ following: false, followerCount: 0 });
    render(<CustomerFollowButton customerId="c1" following={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    await waitFor(() => expect(customerFollowApi.unfollow).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });
});
