// dashboard-core.ts — pure aggregation for the Super-Admin platform overview (no I/O). Computes totals by status,
// new-tenant count within a window, estimated MRR from ACTIVE tenants × plan price, average usage and over-threshold
// counts across ACTIVE tenants, and plan distribution across non-cancelled tenants. Deterministic + unit-tested.
import type { PlatformTenantFact, SuperAdminDashboardOverview, DashboardOptions, PlanDistributionItem } from './dashboard.dto';

export function buildDashboardOverview(facts: PlatformTenantFact[], opts: DashboardOptions): SuperAdminDashboardOverview {
  const prices = opts.planPrices || {};
  const windowDays = opts.newWindowDays ?? 30;
  const threshold = opts.usageThresholdPercent ?? 80;

  const totals = { total: facts.length, active: 0, suspended: 0, pending: 0, trialing: 0, cancelled: 0 };
  for (const f of facts) totals[f.status] += 1;

  const active = facts.filter((f) => f.status === 'active');
  const estimatedMrrCents = active.reduce((sum, f) => sum + (prices[f.planTier] ?? 0), 0);
  const averageUsagePercent = active.length
    ? Math.round(active.reduce((s, f) => s + (Number.isFinite(f.usagePercent) ? f.usagePercent : 0), 0) / active.length)
    : 0;
  const tenantsOverUsage = active.filter((f) => f.usagePercent >= threshold).length;
  const newTenants = facts.filter((f) => f.createdDaysAgo <= windowDays).length;

  const byPlan = new Map<string, number>();
  for (const f of facts) {
    if (f.status === 'cancelled') continue;
    byPlan.set(f.planTier, (byPlan.get(f.planTier) ?? 0) + 1);
  }
  const planDistribution: PlanDistributionItem[] = [...byPlan.entries()]
    .map(([planTier, count]) => ({ planTier, count }))
    .sort((a, b) => (b.count - a.count) || a.planTier.localeCompare(b.planTier));

  return { totals, newTenants, estimatedMrrCents, averageUsagePercent, tenantsOverUsage, planDistribution };
}
