import { describe, it, expect } from 'vitest';
import { LoyaltyDashboardService } from './loyalty-dashboard.service';
import type { LoyaltyDashboardData } from './loyalty-dashboard.repository';

const data = (): LoyaltyDashboardData => ({
  rollup: { members: 120, pointsOutstanding: 232620, pointsIssued: 444780, pointsRedeemed: 159540, tenantsWithLoyalty: 2, tiered: 105, membersWithActivity: 60 },
  tierRows: [{ tier: 'Bronze', count: 45 }, { tier: 'Silver', count: 30 }, { tier: 'Regular', count: 15 }, { tier: 'Platinum', count: 15 }, { tier: 'Gold', count: 15 }],
  redemptionsTotal: 60, activeRewards: 3,
  redemptionsByDay: [{ day: '2026-06-25', count: 8, points: 6100 }, { day: '2026-06-26', count: 7, points: 5900 }],
  membersByDay: [{ day: '2026-06-25', count: 17, points: 0 }],
  tenantPerf: [{ tenantId: 'A', tenantName: 'Glamour Studio', activePrograms: 2, members: 60, pointsIssued: 222000, pointsRedeemed: 80000, redemptions: 30, pointsOutstanding: 116000, tiered: 52 }],
  today: { newMembers: 17, redemptions: 8, pointsRedeemed: 6100 },
});

function svc(d: LoyaltyDashboardData) { return new LoyaltyDashboardService({ dashboardData: async () => d } as any); }

describe('LoyaltyDashboardService', () => {
  it('builds 12 KPIs that reconcile to the aggregates', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.kpis.loyaltyMembers).toBe(120);
    expect(o.kpis.pointsIssued).toBe(444780);
    expect(o.kpis.pointsRedeemed).toBe(159540);
    expect(o.kpis.rewardsIssued).toBe(60);
    expect(o.kpis.tierMembership).toBe(105);
    expect(o.kpis.liabilityCents).toBe(232620);          // outstanding × 1c
    expect(o.kpis.activePrograms).toBe(2);
  });

  it('honors a per-point valuation override for liability', async () => {
    const o = await svc(data()).getDashboard({}, { centsPerPoint: 2 });
    expect(o.kpis.liabilityCents).toBe(232620 * 2);
    expect(o.meta.centsPerPoint).toBe(2);
  });

  it('reconciles the tier donut to the member total', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.tierDistribution.slices.reduce((a, s) => a + s.count, 0)).toBe(120);
    expect(o.tierDistribution.slices[0].tier).toBe('Bronze');
  });

  it('keeps points-issued/expired series and at-a-glance honestly null (no event source)', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.pointsActivityTrend.every((d) => d.issued === null && d.expired === null)).toBe(true);
    expect(o.pointsActivityTrend[0].redeemed).toBe(6100);   // redeemed is real
    expect(o.atAGlance.pointsIssued).toBeNull();
    expect(o.atAGlance.expiredPoints).toBeNull();
    expect(o.atAGlance.liabilityChangeCents).toBeNull();
  });

  it('surfaces suspicious review as honest not-connected', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.suspiciousReview.available).toBe(false);
    expect(o.suspiciousReview.rows).toEqual([]);
    expect(o.kpis.suspiciousActivity).toBe(0);
  });

  it('derives top programs and tenant performance from real tenant aggregates', async () => {
    const o = await svc(data()).getDashboard({}, {});
    expect(o.topPrograms[0].tenantName).toBe('Glamour Studio');
    expect(o.topPrograms[0].type).toBe('Tiered');            // has tiered members
    expect(o.tenantPerformance[0].members).toBe(60);
    expect(['Healthy', 'Strong', 'Watch']).toContain(o.tenantPerformance[0].status);
  });
});
