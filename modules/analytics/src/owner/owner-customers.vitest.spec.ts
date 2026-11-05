import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerCustomersOverview, DateRange } from './owner.dto';

// Owner Customers & Loyalty is read-only aggregate analytics gated by 'owner.dashboard.view'. The service resolves the
// branch scope + period range and delegates to the repo (which does the bScope'd aggregation). No payment-instrument
// data is involved — top spenders are lifetime paid totals only.
const ctx = (perms = ['owner.dashboard.view']): OwnerContext => ({ tenantId: 't1', userId: 'u_owner', role: 'OWNER', permissions: perms } as any);

const overview: OwnerCustomersOverview = {
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  kpis: { totalCustomers: 1240, newCustomers: 86, retentionRatePercent: 62, repeatRatePercent: 48, vipCustomers: 236, loyaltyMembers: 128, giftCardOutstandingCents: 426000, giftCardCount: 31, reviewAverage: 4.8, reviewCount: 512 },
  loyalty: { pointsIssued: 50000, pointsRedeemed: 1260, pointsOutstanding: 48740, rewardRedemptionCount: 18, tiers: [{ tier: 'gold', customers: 40 }, { tier: 'silver', customers: 88 }] },
  topSpenders: [{ customerId: 'c1', name: 'Jennifer W.', lifetimeSpendCents: 128000, visits: 22 }],
  generatedAt: '2026-06-27T15:00:00.000Z',
};

class FakeRepo extends InMemoryOwnerRepository {
  lastBranch: string | null | undefined;
  async allowedBranchIds() { return null; }
  async tenantTimezoneCurrency() { return { timezone: 'America/New_York', currency: 'USD' }; }
  async ownerCustomersOverview(_ctx: OwnerContext, branchId: string | null, _from: DateRange) { this.lastBranch = branchId; return overview; }
}

describe('Owner Customers & Loyalty — read-only aggregate analytics', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.customersOverview(ctx(['owner.finance.view']))).rejects.toThrow(/permission/i);
  });

  it('returns the overview (KPIs, loyalty, top spenders) for an authorized owner', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.customersOverview(ctx(), 'month');
    expect(out.kpis.retentionRatePercent).toBe(62);
    expect(out.kpis.vipCustomers).toBe(236);
    expect(out.kpis.reviewAverage).toBe(4.8);
    expect(out.loyalty.pointsRedeemed).toBe(1260);
    expect(out.topSpenders[0].name).toBe('Jennifer W.');
  });

  it('delegates with the resolved branch scope (all-locations → null)', async () => {
    const repo = new FakeRepo();
    const svc = new OwnerService(repo);
    await svc.customersOverview(ctx(), 'month');
    expect(repo.lastBranch).toBeNull();
  });
});
