import { describe, it, expect } from 'vitest';
import { SuperAdminStaffService, SuperAdminStaffError, type PlatformStaffOverview, type PlatformStaffDetail, type StaffOverviewFilters } from './super-admin-staff.service';

// The service is thin: it clamps filters and delegates to the repo. These tests pin (a) the null-DB honest-empty path
// via the real Kysely repo, (b) filter clamping, and (c) the not-found → error contract.
import { SuperAdminStaffKyselyRepository } from './super-admin-staff.kysely.repository';

const ctx = { userId: 'sa1', email: 'admin@platform.test', ip: '127.0.0.1' };

describe('SuperAdminStaffService', () => {
  it('returns an honest empty overview when no DB is configured (no fabricated data)', async () => {
    const svc = new SuperAdminStaffService(new SuperAdminStaffKyselyRepository(null));
    const o = await svc.getOverview(ctx, {});
    expect(o.kpis).toEqual({ totalTechnicians: 0, activeTechnicians: 0, tenantsWithStaff: 0, avgTechsPerTenant: 0 });
    expect(o.tenants).toEqual([]);
    expect(o.technicians).toEqual([]);
    expect(o.statusBreakdown).toEqual([]);
    expect(o.tenantCount).toBe(0);
  });

  it('clamps filters (limit bounded, search/status trimmed/typed)', async () => {
    let seen: StaffOverviewFilters | null = null;
    const repo = { platformStaffOverview: async (f: StaffOverviewFilters) => { seen = f; return {} as PlatformStaffOverview; }, staffDetail: async () => null };
    const svc = new SuperAdminStaffService(repo);
    await svc.getOverview(ctx, { limit: 999999, search: '  Anna  ', status: 'active' });
    expect(seen!.limit).toBe(1000);          // capped at max
    expect(seen!.search).toBe('Anna');        // trimmed
    expect(seen!.status).toBe('active');
    await svc.getOverview(ctx, { limit: -5, search: 123 as any });
    expect(seen!.limit).toBe(1);              // floored at min
    expect(seen!.search).toBe('');            // non-string → ''
  });

  it('throws not_found when a technician drill-down is missing', async () => {
    const repo = { platformStaffOverview: async () => ({} as PlatformStaffOverview), staffDetail: async () => null };
    const svc = new SuperAdminStaffService(repo);
    await expect(svc.getStaffDetail(ctx, 'nope')).rejects.toBeInstanceOf(SuperAdminStaffError);
  });

  it('returns the technician on a hit', async () => {
    const detail = { technicianId: 't1', fullName: 'Anna Tran' } as PlatformStaffDetail;
    const repo = { platformStaffOverview: async () => ({} as PlatformStaffOverview), staffDetail: async () => detail };
    const svc = new SuperAdminStaffService(repo);
    await expect(svc.getStaffDetail(ctx, 't1')).resolves.toBe(detail);
  });
});
