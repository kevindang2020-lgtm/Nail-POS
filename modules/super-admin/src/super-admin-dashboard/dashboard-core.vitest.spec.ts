import { describe, it, expect } from 'vitest';
import { buildDashboardOverview } from './dashboard-core';
import type { PlatformTenantFact, DashboardOptions } from './dashboard.dto';

const prices: DashboardOptions['planPrices'] = { Premium: 29900, Standard: 14900, Basic: 4900, Trial: 0 };
const opts: DashboardOptions = { planPrices: prices };

const facts: PlatformTenantFact[] = [
  { status: 'active', planTier: 'Premium', usagePercent: 90, createdDaysAgo: 5 },
  { status: 'active', planTier: 'Standard', usagePercent: 50, createdDaysAgo: 200 },
  { status: 'active', planTier: 'Premium', usagePercent: 85, createdDaysAgo: 400 },
  { status: 'trialing', planTier: 'Trial', usagePercent: 10, createdDaysAgo: 3 },
  { status: 'suspended', planTier: 'Standard', usagePercent: 0, createdDaysAgo: 100 },
  { status: 'cancelled', planTier: 'Basic', usagePercent: 0, createdDaysAgo: 365 },
  { status: 'pending', planTier: 'Basic', usagePercent: 0, createdDaysAgo: 1 },
];

describe('buildDashboardOverview', () => {
  const o = buildDashboardOverview(facts, opts);

  it('totals by status', () => {
    expect(o.totals).toEqual({ total: 7, active: 3, suspended: 1, pending: 1, trialing: 1, cancelled: 1 });
  });

  it('MRR sums plan price for ACTIVE tenants only (2× Premium + 1× Standard)', () => {
    expect(o.estimatedMrrCents).toBe(29900 * 2 + 14900);
  });

  it('average usage + over-threshold are computed across ACTIVE tenants', () => {
    expect(o.averageUsagePercent).toBe(Math.round((90 + 50 + 85) / 3)); // 75
    expect(o.tenantsOverUsage).toBe(2); // 90 and 85 are >= 80
  });

  it('newTenants counts tenants created within the window (default 30 days)', () => {
    expect(o.newTenants).toBe(3); // createdDaysAgo 5, 3, 1
    expect(buildDashboardOverview(facts, { ...opts, newWindowDays: 7 }).newTenants).toBe(3);
    expect(buildDashboardOverview(facts, { ...opts, newWindowDays: 2 }).newTenants).toBe(1);
  });

  it('plan distribution excludes cancelled, sorted by count desc then tier', () => {
    expect(o.planDistribution).toEqual([
      { planTier: 'Premium', count: 2 },
      { planTier: 'Standard', count: 2 },
      { planTier: 'Basic', count: 1 },   // pending Basic (cancelled Basic excluded)
      { planTier: 'Trial', count: 1 },
    ]);
  });

  it('empty input → zeros and empty distribution', () => {
    const e = buildDashboardOverview([], opts);
    expect(e.totals.total).toBe(0);
    expect(e.estimatedMrrCents).toBe(0);
    expect(e.averageUsagePercent).toBe(0);
    expect(e.tenantsOverUsage).toBe(0);
    expect(e.planDistribution).toEqual([]);
  });
});
