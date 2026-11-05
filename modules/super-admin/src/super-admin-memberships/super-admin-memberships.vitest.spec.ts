import { describe, it, expect } from 'vitest';
import { SuperAdminMembershipsKyselyRepository } from './super-admin-memberships.kysely.repository';
import { SuperAdminMembershipsService, SuperAdminMembershipsError } from './super-admin-memberships.service';

describe('SuperAdminMemberships platform overview', () => {
  it('returns an honest empty overview when no DB is configured (no fabricated data)', async () => {
    const o = await new SuperAdminMembershipsKyselyRepository(null).platformOverview({ rangeDays: 30, expiringWindowDays: 7, revenueRange: 'this_month' });
    expect(o.kpis.totalMembers).toBe(0);
    expect(o.kpis.membershipRevenueCents).toBe(0);
    expect(o.plans).toEqual([]);
    expect(o.members).toEqual([]);
    expect(o.tenantCount).toBe(0);
    expect(o.summary.renewalRatePct).toBeNull();
    expect(o.summary.churnRatePct).toBeNull();
  });

  it('clamps out-of-range filters before querying', async () => {
    const empty = await new SuperAdminMembershipsKyselyRepository(null).platformOverview({ rangeDays: 30, expiringWindowDays: 7, revenueRange: 'this_month' });
    const seen: Array<{ rangeDays: number; expiringWindowDays: number; revenueRange: string }> = [];
    const svc = new SuperAdminMembershipsService({
      platformOverview: async (f) => { seen.push(f); return empty; },
      planDetail: async () => null,
      memberDetail: async () => null,
    });
    await svc.getOverview({}, { rangeDays: 9999, expiringWindowDays: 0, revenueRange: 'bogus' });
    await svc.getOverview({}, { revenueRange: 'this_year' });
    expect(seen[0].rangeDays).toBe(365);                  // clamped to max
    expect(seen[0].expiringWindowDays).toBe(1);           // clamped to min
    expect(seen[0].revenueRange).toBe('this_month');      // invalid range falls back
    expect(seen[1].revenueRange).toBe('this_year');       // valid range passes through
  });

  it('raises a not-found error for plan/member detail when the record is absent', async () => {
    const repo = new SuperAdminMembershipsKyselyRepository(null); // null DB → detail returns null
    const svc = new SuperAdminMembershipsService(repo);
    await expect(svc.getPlanDetail({}, 'missing')).rejects.toBeInstanceOf(SuperAdminMembershipsError);
    await expect(svc.getMemberDetail({}, 'missing')).rejects.toBeInstanceOf(SuperAdminMembershipsError);
  });
});
