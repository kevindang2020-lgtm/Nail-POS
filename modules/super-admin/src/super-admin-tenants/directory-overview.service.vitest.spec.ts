import { describe, it, expect } from 'vitest';
import { SuperAdminTenantsService } from './super-admin-tenants.service';
import { InMemorySuperAdminTenantsRepo } from './super-admin-tenants.repository';
import type { DirectoryEnrichmentRaw } from './directory-enrichment';

const NOW = new Date('2026-06-29T12:00:00Z').getTime();
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// In-memory repo seeds a handful of tenants but has no device/app/subscription data, so enrichment is null.
class EnrichedRepo extends InMemorySuperAdminTenantsRepo {
  async directoryEnrichmentRaw(): Promise<DirectoryEnrichmentRaw> {
    return {
      activePosDevices: 137,
      applications: [{ status: 'new' }, { status: 'reviewing' }, { status: 'approved' }, { status: 'converted' }],
      renewals: [
        { tenantId: 'a', tenantName: 'A', plan: 'Pro', currentPeriodEnd: day(3) },   // expiring ≤7d
        { tenantId: 'b', tenantName: 'B', plan: 'Growth', currentPeriodEnd: day(40) },
      ],
    };
  }
}

describe('SuperAdminTenantsService.getDirectoryOverview', () => {
  it('honest path: with no enrichment source, device/ticket KPIs stay null and pipeline/renewals unavailable', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const o = await svc.getDirectoryOverview({ now: NOW });
    expect(o.kpis.activePosDevices).toBeNull();
    expect(o.kpis.openSupportTickets).toBeNull();
    expect(o.onboardingPipeline.available).toBe(false);
    expect(o.upcomingRenewals.available).toBe(false);
    expect(o.healthAlerts.find((a) => a.key === 'subscriptions_expiring_7d')?.available).toBe(false);
    // The derived analytics still work from the seeded records.
    expect(o.kpis.totalTenants).toBeGreaterThan(0);
    expect(o.statusDistribution.reduce((s, x) => s + x.count, 0)).toBe(o.kpis.totalTenants);
  });

  it('enriched path: fills device KPI, builds the pipeline, and reconciles the 7-day-expiry alert', async () => {
    const svc = new SuperAdminTenantsService(new EnrichedRepo());
    const o = await svc.getDirectoryOverview({ now: NOW });
    expect(o.kpis.activePosDevices).toBe(137);
    expect(o.onboardingPipeline.available).toBe(true);
    expect(o.onboardingPipeline.stages.find((s) => s.key === 'received')!.count).toBe(4);
    expect(o.upcomingRenewals.available).toBe(true);
    expect(o.upcomingRenewals.rows[0].tenantId).toBe('a'); // soonest first
    const expiring = o.healthAlerts.find((a) => a.key === 'subscriptions_expiring_7d')!;
    expect(expiring.available).toBe(true);
    expect(expiring.count).toBe(1); // only tenant A within 7 days
  });
});

describe('SuperAdminTenantsService.getState per-row health', () => {
  it('attaches a health score/band to rated rows and leaves no-signal rows unrated', async () => {
    const svc = new SuperAdminTenantsService(new InMemorySuperAdminTenantsRepo());
    const state = await svc.getState({ page: 1, pageSize: 50 });
    expect(state.tenants.length).toBeGreaterThan(0);
    // Every returned row carries the health fields (reusing the same engine as the KPI distribution).
    for (const row of state.tenants) {
      expect(row).toHaveProperty('healthBand');
      if (row.healthScore != null) {
        expect(row.healthScore).toBeGreaterThanOrEqual(0);
        expect(row.healthScore).toBeLessThanOrEqual(100);
        expect(['excellent', 'good', 'average', 'poor', 'critical']).toContain(row.healthBand);
      } else {
        expect(row.healthBand).toBe('unrated');
      }
    }
    // The seed includes an active, paid, trading tenant (rated) — at least one row has a numeric score.
    expect(state.tenants.some((r) => typeof r.healthScore === 'number')).toBe(true);
  });
});
