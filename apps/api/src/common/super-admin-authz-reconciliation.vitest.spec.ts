// super-admin-authz-reconciliation.vitest.spec.ts — CI invariants for the Super Admin reporting surfaces
// (Analytics, Report Builder, Scheduled Reports), per spec §39. Three guarantees:
//   1. AUTHZ — every controller is gated by SuperAdminGuard (no ungated cross-tenant read).
//   2. ISOLATION — a server-derived tenant scope is threaded all the way into the aggregate query.
//   3. RECONCILIATION — composed module figures reconcile (payment methods → revenue, device split → total),
//      and exports carry every KPI (nothing silently dropped).
// (A super-admin-stack.pgtest.ts once claimed to prove the live cross-tenant SQL; it imported files that never existed
// and nothing ran it — deleted in the Constitution 13 open-items close-out. The live isolation proof is the cross-tenant
// pgtest suite in common/.)

import { SuperAdminAnalyticsController, SuperAdminReportBuilderController, SuperAdminScheduledReportsController, SuperAdminAnalyticsService } from '@aipowersalon/super-admin';
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';

const ctx = { userId: 'u1', email: 'admin@aps.test' };

// Platform stub that RECORDS calls and whose figures reconcile by construction.
function makePlatform() {
  const calls: Record<string, any[]> = {};
  const rec = (n: string, fn: (...a: any[]) => any) => (...a: any[]) => { (calls[n] ||= []).push(a); return fn(...a); };
  const platform: any = {
    __calls: calls,
    reports: rec('reports', async () => ({ totals: { totalTenants: 100, activeTenants: 90, platformVolumeCents: 300, aiCallsUsed: 0, supportSessions30d: 0, gatewayErrorTenants: 0 }, monthlyTenantGrowth: [{ month: '2026-05', count: 5 }], monthlyPaymentVolume: [], tenantsByState: [{ state: 'NJ', tenants: 12 }], topTenantsByVolume: [{ tenantId: 't1', tenantName: 'Glam', amountCents: 200 }] })),
    // byMethod sums to 300 == processedVolumeCents (reconciles); device online+offline == total.
    platformPayments: rec('platformPayments', async (_q: any) => ({ kpis: { processedVolumeCents: 300, successfulCount: 3, averageTicketCents: 100 }, monthly: [{ month: '2026-04', count: 1, cents: 100 }, { month: '2026-05', count: 2, cents: 300 }], byMethod: [{ method: 'card', count: 2, cents: 200 }, { method: 'cash', count: 1, cents: 100 }], byBranch: [{ branch: 'Downtown', volumeCents: 300, transactions: 3, successRate: 100 }], byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, cents: 0 })), byStatus: [{ status: 'approved', count: 3 }] })),
    platformAppointments: rec('platformAppointments', async () => ({ total: 10, byStatus: [{ status: 'completed', count: 10 }] })),
    platformCustomers: rec('platformCustomers', async () => ({ kpis: { totalCustomers: 50, activeCustomers: 40, newThisMonth: 5 } })),
    platformDevices: rec('platformDevices', async () => ({ kpis: { totalDevices: 10, online: 7 }, byStatus: [{ status: 'online', count: 7 }] })),
    branchesDashboard: rec('branchesDashboard', async () => ({ directory: [{ name: 'Downtown', status: 'active', revenueMtdCents: 300 }] })),
    topPerformingTenants: rec('topPerformingTenants', async () => ([{ tenantId: 't1', name: 'Glam', revenueCents: 200 }])),
    platformReminders: rec('platformReminders', async () => ({ kpis: { appointmentRemindersSent: 10, remindersSentThisMonth: 4, delivered: 9, failed: 1, deliveryRate: 90 } })),
  };
  return platform;
}
const memberships = { getOverview: vi.fn(async () => ({ kpis: { revenueCents: 0 } })) } as any;

describe('§39 · AUTHZ — Super Admin reporting controllers are guard-gated', () => {
  for (const Controller of [SuperAdminAnalyticsController, SuperAdminReportBuilderController, SuperAdminScheduledReportsController]) {
    it(`${Controller.name} requires SuperAdminGuard`, () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, Controller) || [];
      expect(guards).toContain(SuperAdminGuard);
    });
  }
});

describe('§39 · ISOLATION — server-derived scope reaches the aggregate query', () => {
  it('threads the scoped tenantId into platformPayments / platformDevices', async () => {
    const platform = makePlatform();
    const svc = new SuperAdminAnalyticsService(platform, memberships);
    await svc.analytics(ctx, '30d', { tenantId: 'T1' }, 'none');
    expect(platform.__calls.platformPayments[0][0]).toMatchObject({ tenantId: 'T1' });
    expect(platform.__calls.platformDevices[0][0]).toMatchObject({ tenantId: 'T1' });
  });
  it('passes no tenant filter when unscoped (platform-wide)', async () => {
    const platform = makePlatform();
    const svc = new SuperAdminAnalyticsService(platform, memberships);
    await svc.analytics(ctx, '30d', {}, 'none');
    expect(platform.__calls.platformPayments[0][0]?.tenantId).toBeFalsy();
  });
});

describe('§39 · RECONCILIATION — composed figures add up', () => {
  it('payment-method breakdown reconciles to the revenue KPI', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), memberships);
    const out: any = await svc.analytics(ctx, '30d', {}, 'none');
    const revenue = out.kpis.find((k: any) => k.key === 'revenue').valueCents;
    const methodSum = out.modules.paymentMethods.byMethod.reduce((a: number, m: any) => a + m.cents, 0);
    expect(methodSum).toBe(revenue);
  });
  it('device online + offline equals the device total', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), memberships);
    const out: any = await svc.analytics(ctx, '30d', {}, 'none');
    const d = out.modules.deviceStatus;
    expect(d.online + d.offline).toBe(d.total);
  });
  it('CSV export carries every KPI label (nothing dropped)', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), memberships);
    const out: any = await svc.analytics(ctx, '30d', {}, 'none');
    const csv = Buffer.from((await svc.exportData(ctx, 'csv', '30d', {}, 'none')).base64, 'base64').toString('utf8');
    for (const k of out.kpis) expect(csv).toContain(k.label);
  });
});
