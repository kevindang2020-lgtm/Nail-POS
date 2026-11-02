import { describe, it, expect } from 'vitest';
import { SuperAdminLoyaltyService, type PlatformLoyaltyOverview, type LoyaltyOverviewFilters } from './super-admin-loyalty.service';
import { SuperAdminLoyaltyKyselyRepository } from './super-admin-loyalty.kysely.repository';

const ctx = { userId: 'sa1', email: 'admin@platform.test', ip: '127.0.0.1' };

describe('SuperAdminLoyaltyService', () => {
  it('returns an honest empty overview when no DB is configured (no fabricated data)', async () => {
    const svc = new SuperAdminLoyaltyService(new SuperAdminLoyaltyKyselyRepository(null));
    const o = await svc.getOverview(ctx, {});
    expect(o.kpis).toEqual({ loyaltyMembers: 0, pointsOutstanding: 0, pointsRedeemed: 0, activeRewards: 0, salonsWithLoyalty: 0 });
    expect(o.rewards).toEqual([]);
    expect(o.redemptions).toEqual([]);
    expect(o.tenants).toEqual([]);
    expect(o.tierBreakdown).toEqual([]);
    expect(o.tenantCount).toBe(0);
  });

  it('clamps filters (limit bounded, search/status trimmed/typed)', async () => {
    let seen: LoyaltyOverviewFilters | null = null;
    const repo = { platformLoyaltyOverview: async (f: LoyaltyOverviewFilters) => { seen = f; return {} as PlatformLoyaltyOverview; } };
    const svc = new SuperAdminLoyaltyService(repo);
    await svc.getOverview(ctx, { limit: 999999, search: '  Free Polish  ', status: 'active' });
    expect(seen!.limit).toBe(1000);
    expect(seen!.search).toBe('Free Polish');
    expect(seen!.status).toBe('active');
    await svc.getOverview(ctx, { limit: -5, search: 7 as any });
    expect(seen!.limit).toBe(1);
    expect(seen!.search).toBe('');
  });
});
