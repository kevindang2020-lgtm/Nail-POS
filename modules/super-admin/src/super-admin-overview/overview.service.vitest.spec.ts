import { describe, it, expect } from 'vitest';
import { buildOverview, pctDelta, quickActionsPermissions, activityPresentation } from './overview-core';
import { SuperAdminOverviewService } from './overview.service';
import { InMemoryOverviewRepository, EMPTY_FACTS } from './overview.repository';
import type { OverviewFacts } from './overview.dto';

const facts: OverviewFacts = {
  ...EMPTY_FACTS,
  tenantStatusCounts: [{ status: 'active', count: 1862 }, { status: 'pending', count: 37 }, { status: 'suspended', count: 125 }, { status: 'cancelled', count: 82 }],
  activeSalons: 1862,
  newApplications: 28,
  paymentSetupNeeded: 37,
  monthlyCardVolumeCents: 324_000_000,
  priorMonthCardVolumeCents: 274_000_000,
  openSupportSessions: 56,
  systemHealthPercent: 99.9,
  systemHealthLabel: 'All Systems Online',
  salesSeries: [{ label: 'Jan', valueCents: 100000 }, { label: 'Feb', valueCents: 150000 }],
  hardwareStatusCounts: [{ status: 'delivered', count: 1126 }, { status: 'in_transit', count: 382 }, { status: 'pending', count: 117 }],
  topTenants: [{ rank: 1, tenantId: 't1', name: 'Luxe Nails & Spa', city: 'Houston', state: 'TX', monthlyVolumeCents: 12485000, growthPercent: 24.5 }],
  recentApplications: [{ id: 'app1', salonName: 'Glow Nail Spa', owner: 'Emily Johnson', city: 'Austin', state: 'TX', phone: '512-555-8765', status: 'new', date: '2026-05-08' }],
  platformKpis: { activeUsers: 8642, totalLocations: 3317, technicians: 18927, customers: 1320000, totalAppointments: 245320, aiInteractions: 0 },
  aiInteractionsAvailable: false,
};

describe('Super-Admin Overview core', () => {
  it('pctDelta returns null with no/zero baseline and a rounded % otherwise', () => {
    expect(pctDelta(120, null)).toBeNull();
    expect(pctDelta(120, 0)).toBeNull();
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(324, 274)).toBe(18.2);
  });

  it('computes paused/trial MoM trends from snapshot baselines (null until a baseline exists)', () => {
    const noBaseline = buildOverview({ ...facts, pausedTenants: 125, trialTenants: 86 }, 'SUPER_ADMIN');
    expect(noBaseline.kpis.trends.pausedTenants).toBeNull();
    expect(noBaseline.kpis.trends.trialTenants).toBeNull();
    const withBaseline = buildOverview({
      ...facts, pausedTenants: 120, trialTenants: 86,
      trendBaselines: { ...facts.trendBaselines, pausedTenantsPrior: 100, trialTenantsPrior: 80 },
    }, 'SUPER_ADMIN');
    expect(withBaseline.kpis.trends.pausedTenants).toBe(20);   // (120-100)/100
    expect(withBaseline.kpis.trends.trialTenants).toBe(7.5);   // (86-80)/80
  });

  it('assembles KPIs, slices with percents, and a real card-volume trend', () => {
    const o = buildOverview(facts, 'SUPER_ADMIN');
    expect(o.kpis.totalTenants).toBe(1862 + 37 + 125 + 82);
    expect(o.kpis.activeSalons).toBe(1862);
    expect(o.kpis.monthlyCardVolumeCents).toBe(324_000_000);
    expect(o.kpis.trends.monthlyCardVolume).toBe(18.2);          // real prior-month comparison
    expect(o.kpis.trends.totalTenants).toBeNull();               // no snapshot baseline → honest null, not a fake arrow
    const active = o.tenantsByStatus.find((s) => s.status === 'active')!;
    expect(active.label).toBe('Active');
    expect(active.percent).toBeGreaterThan(0);
    // design-parity: the four real tenants.status values map to the dashboard's display labels
    expect(o.tenantsByStatus.find((s) => s.status === 'pending')!.label).toBe('Pending Setup');
    expect(o.tenantsByStatus.find((s) => s.status === 'suspended')!.label).toBe('On Hold');
    expect(o.tenantsByStatus.find((s) => s.status === 'cancelled')!.label).toBe('Cancelled');
    expect(o.tenantsByStatus.reduce((a, b) => a + b.count, 0)).toBe(o.kpis.totalTenants);
    expect(o.hardwarePackageStatus.find((s) => s.status === 'in_transit')!.label).toBe('In Transit');
  });

  it('lists honest blockers for AI interactions and support tickets', () => {
    const o = buildOverview(facts, 'SUPER_ADMIN');
    expect(o.blockers.some((b) => b.module.includes('aiInteractions'))).toBe(true);
    expect(o.blockers.some((b) => b.module.includes('openSupportTickets'))).toBe(true);
    expect(o.platformKpis.aiInteractions).toBe(0);
  });

  it('grants all quick actions to SUPER_ADMIN and none to others', () => {
    expect(Object.values(quickActionsPermissions('SUPER_ADMIN')).every(Boolean)).toBe(true);
    expect(Object.values(quickActionsPermissions('OWNER')).some(Boolean)).toBe(false);
    expect(Object.values(quickActionsPermissions(null)).some(Boolean)).toBe(false);
  });
});

describe('Super-Admin Overview service', () => {
  it('returns a fully-shaped state from seeded facts', async () => {
    const svc = new SuperAdminOverviewService(new InMemoryOverviewRepository(facts));
    const o = await svc.getState('month', 'SUPER_ADMIN');
    expect(o.kpis.totalTenants).toBeGreaterThan(0);
    expect(o.topPerformingTenants[0].name).toBe('Luxe Nails & Spa');
    expect(o.recentTenantApplications[0].salonName).toBe('Glow Nail Spa');
    expect(o.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('empty repo yields zeros + empty arrays (never fabricated)', async () => {
    const svc = new SuperAdminOverviewService(new InMemoryOverviewRepository());
    const o = await svc.getState('month', 'SUPER_ADMIN');
    expect(o.kpis.totalTenants).toBe(0);
    expect(o.monthlySalesVolume).toEqual([]);
    expect(o.topPerformingTenants).toEqual([]);
  });

  it('monthly-sales-volume endpoint passes the series through with the range', async () => {
    const svc = new SuperAdminOverviewService(new InMemoryOverviewRepository(facts));
    const r = await svc.getMonthlySalesVolume('year');
    expect(r.range).toBe('year');
    expect(r.series.length).toBe(2);
  });

  it('computes month-over-month trends from baselines (real, by metric meaning)', async () => {
    const seeded = new InMemoryOverviewRepository({
      ...facts,
      tenantStatusCounts: [{ status: 'active', count: 110 }, { status: 'pending', count: 10 }], // total 120
      activeSalons: 110,
      monthlyCardVolumeCents: 120000,
      priorMonthCardVolumeCents: 100000,
      trendBaselines: { totalTenantsPrior: 100, activeSalonsPrior: 100, newApplicationsPrior: null, paymentSetupPrior: null, openSupportPrior: null },
    } as any);
    const o = await new SuperAdminOverviewService(seeded).getState('month', 'SUPER_ADMIN');
    expect(o.kpis.trends.totalTenants).toBe(20);        // (120-100)/100
    expect(o.kpis.trends.activeSalons).toBe(10);         // (110-100)/100
    expect(o.kpis.trends.monthlyCardVolume).toBe(20);    // (120k-100k)/100k
    expect(o.kpis.trends.pendingApplications).toBeNull(); // no baseline → null (never a faked arrow)
  });

  it('captureSnapshot is a no-op on the in-memory adapter (no snapshot capability)', async () => {
    const svc = new SuperAdminOverviewService(new InMemoryOverviewRepository(facts));
    const r = await svc.captureSnapshot();
    expect(r.ok).toBe(true);
    expect(r.captured).toBe(false);
  });

  it('activityPresentation maps audit actions to event icons + friendly titles', () => {
    expect(activityPresentation('super_admin_tenant_created').icon).toBe('🟢');
    expect(activityPresentation('tenant_paused')).toEqual({ icon: '⏸️', title: 'Tenant paused' });
    expect(activityPresentation('warning_sent')).toEqual({ icon: '⚠️', title: 'Warning sent' });
    expect(activityPresentation('support_access_opened').icon).toBe('🎧');
    expect(activityPresentation('hardware_package_shipped').icon).toBe('📦');
    expect(activityPresentation('ai_package_activated').icon).toBe('🤖');
    expect(activityPresentation('some_unknown_event')).toEqual({ icon: '📌', title: 'some unknown event' });
  });
});
