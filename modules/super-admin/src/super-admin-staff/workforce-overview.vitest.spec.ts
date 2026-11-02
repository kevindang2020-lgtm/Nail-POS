import { describe, it, expect } from 'vitest';
import { SuperAdminStaffService, type WorkforceRaw } from './super-admin-staff.service';

// Composition test: feed the service a fake repo's raw grouped counts and assert the aggregate reconciles, categorizes
// roles, assembles ordered health alerts, and marks unsourced sections as honest gaps (no fabricated values).
const raw: WorkforceRaw = {
  roleCounts: [
    { role: 'TECHNICIAN', count: 2463 }, { role: 'RECEPTION', count: 1000 }, { role: 'FRONT_DESK', count: 205 },
    { role: 'MANAGER', count: 500 }, { role: 'OWNER', count: 118 }, { role: 'CUSTOMER', count: 9999 },
  ],
  statusCounts: [{ status: 'active', count: 3824 }, { status: 'inactive', count: 462 }],
  byTenant: Array.from({ length: 9 }, (_, i) => ({ tenantId: 't' + i, tenantName: 'Tenant ' + i, count: 100 - i })),
  duplicateGroups: 68, accessIssues: 56, missingInfo: 112,
  recentActivity: [{ id: 'a1', actionType: 'user_profile_updated', entityType: 'user', userId: 'u1', tenantId: 't1', at: '2026-05-06T12:00:00Z' }],
  auditToday: [{ actionType: 'profile_updated', count: 128 }, { actionType: 'role_changed', count: 46 }, { actionType: 'login_failed', count: 19 }],
};
function svc() { return new SuperAdminStaffService({ workforceRaw: async () => raw } as any); }
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.getWorkforceOverview', () => {
  it('computes reconciling KPIs and role/status distributions from real counts', async () => {
    const o = await svc().getWorkforceOverview(ctx, {});
    expect(o.kpis.totalWorkers.value).toBe(2463 + 1205 + 618); // customers excluded
    expect(o.kpis.technicians.value).toBe(2463);
    expect(o.kpis.receptionists.value).toBe(1205);
    expect(o.kpis.managers.value).toBe(618);
    expect(o.kpis.activeWorkers.value).toBe(3824);
    expect(o.kpis.inactiveWorkers.value).toBe(462);
    expect(o.roleDistribution.technicians + o.roleDistribution.receptionists + o.roleDistribution.managers + o.roleDistribution.other).toBe(o.roleDistribution.total);
  });

  it('marks unsourced KPIs and chart sections as honest gaps', async () => {
    const o = await svc().getWorkforceOverview(ctx, {});
    expect(o.kpis.branchTransfers).toEqual({ value: null, available: false });
    expect(o.kpis.payrollSyncIssues.available).toBe(false);
    expect(o.kpis.suspiciousPermissionActivity.available).toBe(false);
    expect(o.availabilityDistribution.available).toBe(false);
    expect(o.workforceTrend.available).toBe(false);
    expect(o.payrollSyncRate.available).toBe(false);
    // real ones ARE available
    expect(o.kpis.duplicateProfiles).toEqual({ value: 68, available: true });
    expect(o.kpis.missingEmploymentInfo).toEqual({ value: 112, available: true });
    expect(o.kpis.accountAccessIssues).toEqual({ value: 56, available: true });
  });

  it('rolls workers-by-tenant into top 7 + Others and assembles ordered alerts + audit summary', async () => {
    const o = await svc().getWorkforceOverview(ctx, {});
    expect(o.workersByTenant.rows.length).toBe(8); // 7 + Others
    expect(o.workersByTenant.rows[7].tenantName).toBe('Others');
    expect(o.workersByTenant.total).toBe(o.workersByTenant.rows.reduce((s, r) => s + r.count, 0));
    expect(o.healthAlerts[0]).toMatchObject({ key: 'duplicates', count: 68, available: true });
    expect(o.healthAlerts[2]).toMatchObject({ key: 'payrollFailures', available: false }); // null source
    expect(o.healthAlerts[4]).toMatchObject({ key: 'inactiveUsers', count: 462 });
    expect(o.auditEventSummary[0]).toEqual({ category: 'Profile Updates', count: 128 });
    expect(o.auditEventSummary[1]).toEqual({ category: 'Role Changes', count: 46 });
    expect(o.todaySummary.auditEvents.value).toBe(128 + 46 + 19);
  });

  it('normalizes the directory query before calling the repo (clamps + sort whitelist + role mapping)', async () => {
    let received: any = null;
    const s = new SuperAdminStaffService({ workforceDirectory: async (nq: any) => { received = nq; return { rows: [], total: 0, page: nq.page, pageSize: nq.pageSize, pages: 1, facets: { statuses: [] } }; } } as any);
    await s.getWorkforceDirectory(ctx, { page: '2', pageSize: '999', sort: 'evil; drop', role: 'receptionist', search: '  Sarah ' });
    expect(received.page).toBe(2);
    expect(received.pageSize).toBe(100); // clamped
    expect(received.sort).toBe('name'); // bad sort rejected
    expect(received.roles).toEqual(['RECEPTION', 'FRONT_DESK']);
    expect(received.search).toBe('sarah');
  });
});
