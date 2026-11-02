import { describe, it, expect } from 'vitest';
import { buildTenantDirectoryAggregates } from './tenant-directory-aggregates';
import type { TenantRecord } from './super-admin-tenants-core';

let seq = 0;
function mk(p: Partial<TenantRecord> = {}): TenantRecord {
  seq++;
  return {
    id: `t${seq}`, displayName: `Tenant ${seq}`, tenantCode: `T${seq}`,
    ownerName: 'Owner', ownerEmail: `o${seq}@x.com`, ownerPhone: '', ownerActivated: true,
    primaryCity: 'City', primaryState: 'NJ', branchCount: 1,
    storedStatus: 'active', plan: 'Pro Plan', subscriptionStatus: 'active', aiPackage: 'None',
    monthlyRevenueCents: 1_000_00, usagePercent: 40, fiservConfigured: true, paymentConfigStatus: 'active',
    hardwarePayoffRemainingCents: 0, lastLoginLabel: '2m ago', createdLabel: 'May 08, 2026', createdDaysAgo: 30,
    customers: [100, 1000], technicians: [4, 10], aiCallsLabel: '0', smsLabel: '0',
    ...p,
  };
}

// A representative platform: enterprise/pro/starter, active/trial/pending/suspended, healthy + failing.
function platform(): TenantRecord[] {
  return [
    mk({ plan: 'Enterprise Plan', monthlyRevenueCents: 72_530_00, branchCount: 20, customers: [18642, 20000] }),
    mk({ plan: 'Enterprise Plan', monthlyRevenueCents: 48_752_00, branchCount: 12, customers: [12842, 15000] }),
    mk({ plan: 'Pro Plan', monthlyRevenueCents: 28_965_00, branchCount: 8, customers: [6721, 8000] }),
    mk({ plan: 'Growth Plan', monthlyRevenueCents: 41_380_00, branchCount: 14, customers: [10213, 12000] }),
    mk({ plan: 'Starter Plan', subscriptionStatus: 'trialing', monthlyRevenueCents: 6_120_00, branchCount: 4, customers: [1842, 2000] }),
    mk({ plan: 'Pro Plan', storedStatus: 'pending', subscriptionStatus: 'active', ownerActivated: false,
         fiservConfigured: false, paymentConfigStatus: 'none', monthlyRevenueCents: 0, branchCount: 0, customers: [0, 0], createdDaysAgo: 1 }),
    mk({ plan: 'Growth Plan', storedStatus: 'suspended', subscriptionStatus: 'past_due',
         fiservConfigured: false, paymentConfigStatus: 'disabled', monthlyRevenueCents: 0, branchCount: 6, customers: [1023, 2000] }),
  ];
}

const NOW = new Date('2026-06-29T12:00:00Z').getTime();

describe('tenant-directory aggregation (§7 / §36)', () => {
  it('status distribution sums exactly to the tenant total (§36 reconciliation)', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    const sum = a.statusDistribution.reduce((s, x) => s + x.count, 0);
    expect(sum).toBe(recs.length);
    expect(a.kpis.totalTenants).toBe(recs.length);
  });

  it('status KPIs match the status distribution buckets', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    const find = (k: string) => a.statusDistribution.find((x) => x.key === k)?.count ?? 0;
    expect(a.kpis.activeTenants).toBe(find('active'));
    expect(a.kpis.trialTenants).toBe(find('trial'));
    expect(a.kpis.pendingApprovals).toBe(find('pending'));
    expect(a.kpis.suspendedTenants).toBe(find('suspended'));
    // mutually exclusive: trialing tenant is NOT also counted active
    expect(a.kpis.activeTenants + a.kpis.trialTenants + a.kpis.pendingApprovals + a.kpis.suspendedTenants)
      .toBeLessThanOrEqual(recs.length);
  });

  it('plan distribution sums to total and enterprise KPI matches enterprise plans', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    expect(a.planDistribution.reduce((s, x) => s + x.count, 0)).toBe(recs.length);
    expect(a.kpis.enterpriseTenants).toBe(2);
  });

  it('branch / customer / revenue KPIs are exact integer-cent sums of the records', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    expect(a.kpis.totalBranches).toBe(recs.reduce((s, t) => s + t.branchCount, 0));
    expect(a.kpis.totalCustomers).toBe(recs.reduce((s, t) => s + t.customers[0], 0));
    expect(a.kpis.monthlyRevenueCents).toBe(recs.reduce((s, t) => s + t.monthlyRevenueCents, 0));
  });

  it('health distribution sums to total and flags churn + overdue honestly', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    expect(a.healthDistribution.reduce((s, x) => s + x.count, 0)).toBe(recs.length);
    expect(a.kpis.churnRiskHigh).toBeGreaterThanOrEqual(1); // the suspended/past_due tenant
    expect(a.kpis.overduePayments).toBe(1);
  });

  it('the no-signal pending tenant lands in the unrated band, not a fake score', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    const unrated = a.healthDistribution.find((x) => x.key === 'unrated');
    expect(unrated?.count).toBe(1);
  });

  it('POS devices + support tickets KPIs are honestly null until Phase 2b', () => {
    const a = buildTenantDirectoryAggregates(platform(), { now: NOW });
    expect(a.kpis.activePosDevices).toBeNull();
    expect(a.kpis.openSupportTickets).toBeNull();
    expect(a.healthAlerts.find((x) => x.key === 'subscriptions_expiring_7d')?.available).toBe(false);
  });

  it('growth trend has 12 month-end points, is non-decreasing, and ends at the current total', () => {
    const recs = platform();
    const a = buildTenantDirectoryAggregates(recs, { now: NOW });
    expect(a.growthTrend).toHaveLength(12);
    for (let i = 1; i < a.growthTrend.length; i++) {
      expect(a.growthTrend[i].totalTenants).toBeGreaterThanOrEqual(a.growthTrend[i - 1].totalTenants);
    }
    expect(a.growthTrend[11].totalTenants).toBe(recs.length); // all created before now
  });

  it('is deterministic for a fixed now', () => {
    const recs = platform();
    const a = JSON.stringify(buildTenantDirectoryAggregates(recs, { now: NOW }));
    const b = JSON.stringify(buildTenantDirectoryAggregates(recs, { now: NOW }));
    expect(a).toBe(b);
  });

  it('empty platform yields zeroed KPIs without dividing by zero', () => {
    const a = buildTenantDirectoryAggregates([], { now: NOW });
    expect(a.kpis.totalTenants).toBe(0);
    expect(a.planDistribution).toHaveLength(0);
    expect(a.growthTrend.every((p) => p.totalTenants === 0)).toBe(true);
  });
});
