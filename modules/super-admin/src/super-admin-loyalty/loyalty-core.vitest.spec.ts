import { describe, it, expect } from 'vitest';
import {
  liabilityCents, tierDistribution, redemptionStatusDistribution, engagementPct, avgRedemptionRatePct,
  rollupKpis, trendOf, type ProfileLike,
} from './loyalty-core';

const prof = (o: Partial<ProfileLike> = {}): ProfileLike => ({ tier: 'Bronze', pointsBalance: 1000, totalEarned: 5000, totalRedeemed: 4000, hasRecentActivity: true, ...o });

describe('loyalty-core liability', () => {
  it('computes liability as points × cents-per-point (decimal-safe integers)', () => {
    expect(liabilityCents(382760, { centsPerPoint: 1 })).toBe(382760);   // $3,827.60 at $0.01/pt
    expect(liabilityCents(1000, { centsPerPoint: 2 })).toBe(2000);
    expect(liabilityCents(0)).toBe(0);
  });
});

describe('loyalty-core distributions', () => {
  it('tier distribution reconciles to the member total and uses tier names dynamically', () => {
    const d = tierDistribution([{ tier: 'Bronze' }, { tier: 'Bronze' }, { tier: 'Silver' }, { tier: 'VIP' }]);
    expect(d.total).toBe(4);
    expect(d.slices.reduce((a, s) => a + s.count, 0)).toBe(4);
    expect(d.slices.find((s) => s.tier === 'Bronze')!.count).toBe(2);
    expect(d.slices.find((s) => s.tier === 'VIP')).toBeTruthy();   // custom tier preserved, not forced to Bronze/Silver/Gold/Platinum
  });

  it('redemption-status distribution treats un-statused redemptions as completed (honest)', () => {
    const d = redemptionStatusDistribution([{}, {}, { status: 'pending' }, { status: 'flagged' }]);
    expect(d.total).toBe(4);
    expect(d.slices.find((s) => s.status === 'redeemed')!.count).toBe(2);
    expect(d.slices.find((s) => s.status === 'pending')!.count).toBe(1);
    expect(d.slices.find((s) => s.status === 'flagged')!.count).toBe(1);
  });
});

describe('loyalty-core rates', () => {
  it('engagement is bounded and rounds to one decimal', () => {
    expect(engagementPct(1000, 472)).toBe(47.2);
    expect(engagementPct(0, 5)).toBe(0);
    expect(engagementPct(10, 999)).toBe(100);   // clamped
  });
  it('avg reward redemption rate = redeemed / eligible issued', () => {
    expect(avgRedemptionRatePct(226, 1000)).toBe(22.6);
    expect(avgRedemptionRatePct(5, 0)).toBe(0);
  });
});

describe('loyalty-core rollup', () => {
  it('rolls up 12 KPIs from real profile aggregates; tier membership = members above base tier', () => {
    const k = rollupKpis({
      profiles: [prof(), prof({ tier: 'Regular', hasRecentActivity: false }), prof({ tier: 'Gold' })],
      redemptionCount: 42, eligibleRewardsIssued: 200, activePrograms: 3, baseTier: 'Regular',
    });
    expect(k.loyaltyMembers).toBe(3);
    expect(k.pointsIssued).toBe(15000);
    expect(k.pointsRedeemed).toBe(12000);
    expect(k.liabilityCents).toBe(3000);            // 3000 outstanding × 1c
    expect(k.rewardsIssued).toBe(42);
    expect(k.tierMembership).toBe(2);               // Bronze + Gold above 'Regular'
    expect(k.engagementPct).toBe(66.7);             // 2 of 3 with activity
    expect(k.avgRedemptionRatePct).toBe(21);        // 42/200
    expect(k.expiredPoints).toBe(0);                // honest — no expiration ledger
    expect(k.suspiciousActivity).toBe(0);           // honest — no suspicious store
  });
});

describe('loyalty-core trends (business-semantic)', () => {
  it('marks increases favorable/unfavorable by business meaning, neutral for liability', () => {
    expect(trendOf('loyaltyMembers', 110, 100)?.favorable).toBe(true);
    expect(trendOf('suspiciousActivity', 20, 10)?.favorable).toBe(false);   // more suspicious = bad
    expect(trendOf('expiredPoints', 20, 10)?.favorable).toBe(false);
    expect(trendOf('liabilityCents', 200, 100)?.favorable).toBeNull();      // increase not auto-good
    expect(trendOf('loyaltyMembers', 100, 100)?.favorable).toBeNull();      // flat
    expect(trendOf('loyaltyMembers', 100, null)).toBeNull();                // no baseline
  });
});
