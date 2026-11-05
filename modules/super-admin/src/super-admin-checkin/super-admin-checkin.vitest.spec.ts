import { describe, it, expect } from 'vitest';
import { SuperAdminCheckinService, type PlatformCheckinOverview, type CheckinOverviewFilters } from './super-admin-checkin.service';
import { SuperAdminCheckinKyselyRepository } from './super-admin-checkin.kysely.repository';

const ctx = { userId: 'sa1', email: 'admin@platform.test', ip: '127.0.0.1' };

describe('SuperAdminCheckinService', () => {
  it('returns an honest empty overview when no DB is configured (no fabricated data)', async () => {
    const svc = new SuperAdminCheckinService(new SuperAdminCheckinKyselyRepository(null));
    const o = await svc.getOverview(ctx, {});
    expect(o.kpis).toEqual({ activeNow: 0, completedToday: 0, sessionsToday: 0, totalSessions: 0 });
    expect(o.tenants).toEqual([]);
    expect(o.sessions).toEqual([]);
    expect(o.statusBreakdown).toEqual([]);
    expect(o.tenantCount).toBe(0);
  });

  it('clamps filters (limit bounded, search/status trimmed/typed)', async () => {
    let seen: CheckinOverviewFilters | null = null;
    const repo = { platformCheckinOverview: async (f: CheckinOverviewFilters) => { seen = f; return {} as PlatformCheckinOverview; } };
    const svc = new SuperAdminCheckinService(repo);
    await svc.getOverview(ctx, { limit: 999999, search: '  Palace  ', status: 'active' });
    expect(seen!.limit).toBe(1000);
    expect(seen!.search).toBe('Palace');
    expect(seen!.status).toBe('active');
    await svc.getOverview(ctx, { limit: -5, search: 99 as any });
    expect(seen!.limit).toBe(1);
    expect(seen!.search).toBe('');
  });
});
