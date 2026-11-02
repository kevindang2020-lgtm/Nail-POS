import { describe, it, expect } from 'vitest';
import { buildLoyaltyOverview, type LoyaltyProfile, type LoyaltyReward, type LoyaltyRedemption, type LoyaltyContext } from './loyalty.dto';
import { InMemoryLoyaltyRepository } from './loyalty.repository';
import { LoyaltyService, ForbiddenError } from './loyalty.service';

const prof = (o: Partial<LoyaltyProfile> = {}): LoyaltyProfile => ({ customerId: 'c1', tier: 'Regular', pointsBalance: 100, totalEarned: 300, totalRedeemed: 200, ...o });
const reward = (o: Partial<LoyaltyReward> = {}): LoyaltyReward => ({ id: 'r1', title: 'Free Polish', pointsCost: 200, active: true, ...o });
const redemption = (o: Partial<LoyaltyRedemption> = {}): LoyaltyRedemption => ({ id: 'x1', customerId: 'c1', rewardTitle: 'Free Polish', pointsSpent: 200, createdAt: '2026-07-01T00:00:00.000Z', ...o });
const ctx = (o: Partial<LoyaltyContext> = {}): LoyaltyContext => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.view'], ...o });

describe('loyalty — overview builder (pure)', () => {
  it('sums balances/earned/redeemed and groups members into tiers', () => {
    const { kpis, tiers } = buildLoyaltyOverview(
      [prof({ tier: 'VIP', pointsBalance: 500, totalEarned: 800, totalRedeemed: 300 }), prof({ tier: 'Regular', pointsBalance: 100, totalEarned: 100, totalRedeemed: 0 }), prof({ tier: 'VIP', pointsBalance: 250, totalEarned: 250, totalRedeemed: 0 })],
      [reward({ active: true }), reward({ id: 'r2', active: false })],
      [redemption({ pointsSpent: 200 }), redemption({ id: 'x2', pointsSpent: 150 })],
    );
    expect(kpis.memberCount).toBe(3);
    expect(kpis.pointsOutstanding).toBe(850);   // 500+100+250
    expect(kpis.totalEarnedPoints).toBe(1150);  // 800+100+250
    expect(kpis.totalRedeemedPoints).toBe(300);
    expect(kpis.activeRewards).toBe(1);
    expect(kpis.redemptionCount).toBe(2);
    expect(kpis.pointsRedeemed).toBe(350);      // 200+150
    // tiers sorted by points desc: VIP (750) then Regular (100)
    expect(tiers[0]).toEqual({ tier: 'VIP', members: 2, points: 750 });
    expect(tiers[1]).toEqual({ tier: 'Regular', members: 1, points: 100 });
  });
  it('handles an empty program', () => {
    const { kpis, tiers } = buildLoyaltyOverview([], [], []);
    expect(kpis.memberCount).toBe(0); expect(kpis.pointsOutstanding).toBe(0); expect(tiers).toEqual([]);
  });
});

describe('loyalty — service', () => {
  it('returns kpis, tiers, rewards, and recent redemptions', async () => {
    const svc = new LoyaltyService(new InMemoryLoyaltyRepository([prof()], [reward()], [redemption()]));
    const state = await svc.getState(ctx());
    expect(state.kpis.memberCount).toBe(1);
    expect(state.rewards).toHaveLength(1);
    expect(state.recentRedemptions).toHaveLength(1);
  });
  it('rejects an unauthenticated context', async () => {
    const svc = new LoyaltyService(new InMemoryLoyaltyRepository());
    await expect(svc.getState({ tenantId: '', userId: '', role: '', permissions: [] } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
