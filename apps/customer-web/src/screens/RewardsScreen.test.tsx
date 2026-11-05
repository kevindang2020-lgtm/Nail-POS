import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { loyalty: vi.fn(), rewards: vi.fn(), redeemReward: vi.fn(), wallet: vi.fn(async () => ({ balanceCents: 0, transactions: [] })), referral: vi.fn(async () => null) } }));
import { customerApi } from '../api/customerApi';
import { RewardsScreen } from './RewardsScreen';

describe('RewardsScreen redemption', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists rewards and shows a code after redeeming', async () => {
    (customerApi.loyalty as any).mockResolvedValue({ points: 1250, tier: 'Silver', nextTier: 'Gold', pointsToNextTier: 250, progressPercent: 80 });
    (customerApi.rewards as any).mockResolvedValue({ points: 1250, rewards: [{ id: 'r1', title: 'Free Gel Polish', description: 'On us', pointsCost: 500, affordable: true }] });
    (customerApi.redeemReward as any).mockResolvedValue({ ok: true, code: 'RDMABC1', pointsBalance: 750 });
    render(<MemoryRouter><RewardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem' }));
    await waitFor(() => expect(customerApi.redeemReward).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('RDMABC1')).toBeInTheDocument();
  });
  it('locks rewards the customer cannot afford', async () => {
    (customerApi.loyalty as any).mockResolvedValue({ points: 100, tier: 'Bronze', nextTier: 'Silver', pointsToNextTier: 400, progressPercent: 20 });
    (customerApi.rewards as any).mockResolvedValue({ points: 100, rewards: [{ id: 'r2', title: 'Free Mani', description: '', pointsCost: 5000, affordable: false }] });
    render(<MemoryRouter><RewardsScreen /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Locked' })).toBeDisabled();
  });
  it('shows centered empty rewards card with icon when rewards array is empty', async () => {
    (customerApi.loyalty as any).mockResolvedValue({ points: 1233, tier: 'Silver', nextTier: 'Gold', pointsToNextTier: 267, progressPercent: 82 });
    (customerApi.rewards as any).mockResolvedValue({ points: 1233, rewards: [] });
    render(<MemoryRouter><RewardsScreen /></MemoryRouter>);
    expect(await screen.findByText('No rewards available yet — check back soon.')).toBeInTheDocument();
    expect(screen.getAllByText('🎁').length).toBeGreaterThanOrEqual(1);
  });
});
