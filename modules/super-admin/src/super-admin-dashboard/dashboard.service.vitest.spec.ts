import { describe, it, expect } from 'vitest';
import { SuperAdminDashboardService } from './dashboard.service';
import { InMemoryDashboardRepository } from './dashboard.repository';
import { buildDashboardOverview } from './dashboard-core';
import type { PlatformTenantFact } from './dashboard.dto';

const facts: PlatformTenantFact[] = [
  { status: 'active', planTier: 'Premium', usagePercent: 90, createdDaysAgo: 2 },
  { status: 'active', planTier: 'Standard', usagePercent: 40, createdDaysAgo: 90 },
  { status: 'trialing', planTier: 'Trial', usagePercent: 5, createdDaysAgo: 1 },
];
const planPrices = { Premium: 29900, Standard: 14900, Trial: 0 };

describe('SuperAdminDashboardService', () => {
  it('returns the aggregated overview from the port', async () => {
    const svc = new SuperAdminDashboardService(new InMemoryDashboardRepository({ facts, planPrices }));
    const o = await svc.getOverview();
    expect(o).toEqual(buildDashboardOverview(facts, { planPrices }));
    expect(o.estimatedMrrCents).toBe(29900 + 14900);
    expect(o.totals.total).toBe(3);
  });

  it('passes window/threshold overrides to the aggregator', async () => {
    const svc = new SuperAdminDashboardService(new InMemoryDashboardRepository({ facts, planPrices }));
    expect((await svc.getOverview({ newWindowDays: 1 })).newTenants).toBe(1);   // only createdDaysAgo<=1
    expect((await svc.getOverview({ usageThresholdPercent: 95 })).tenantsOverUsage).toBe(0);
  });

  it('empty port (no DB) → zeros, never fabricated', async () => {
    const svc = new SuperAdminDashboardService(new InMemoryDashboardRepository());
    const o = await svc.getOverview();
    expect(o.totals.total).toBe(0);
    expect(o.estimatedMrrCents).toBe(0);
    expect(o.planDistribution).toEqual([]);
  });
});
