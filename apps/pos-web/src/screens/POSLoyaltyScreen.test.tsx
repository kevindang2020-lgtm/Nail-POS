import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { loyMock } = vi.hoisted(() => ({ loyMock: vi.fn() }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: { state: loyMock } }));
import { POSLoyaltyScreen } from './POSLoyaltyScreen';
beforeEach(() => loyMock.mockReset());

describe('POSLoyaltyScreen', () => {
  it('renders program KPIs, tiers, rewards, and redemptions', async () => {
    loyMock.mockResolvedValue({
      kpis: { memberCount: 2, pointsOutstanding: 620, totalEarnedPoints: 920, totalRedeemedPoints: 300, activeRewards: 1, redemptionCount: 1, pointsRedeemed: 200 },
      tiers: [{ tier: 'VIP', members: 1, points: 500 }, { tier: 'Regular', members: 1, points: 120 }],
      rewards: [{ id: 'r1', title: 'Free Polish', pointsCost: 200, active: true }],
      recentRedemptions: [{ id: 'x1', customerId: 'c1', rewardTitle: 'Free Polish', pointsSpent: 200, createdAt: '2026-07-01T00:00:00Z' }],
    });
    render(<POSLoyaltyScreen />);
    expect(await screen.findByRole('heading', { name: 'Loyalty & Rewards' })).toBeInTheDocument();
    expect(screen.getByText('Points Outstanding')).toBeInTheDocument();
    expect(screen.getByText('620')).toBeInTheDocument();
    expect(screen.getAllByText('Free Polish').length).toBeGreaterThan(0);
    expect(screen.getByText('VIP')).toBeInTheDocument();
  });
  it('shows empty states for a program with no data', async () => {
    loyMock.mockResolvedValue({ kpis: { memberCount: 0, pointsOutstanding: 0, totalEarnedPoints: 0, totalRedeemedPoints: 0, activeRewards: 0, redemptionCount: 0, pointsRedeemed: 0 }, tiers: [], rewards: [], recentRedemptions: [] });
    render(<POSLoyaltyScreen />);
    expect(await screen.findByText(/No members enrolled yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No rewards yet/i)).toBeInTheDocument();   // wording changed with the catalog editor (Oct 2)
  });
});
