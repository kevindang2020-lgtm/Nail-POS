import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';
import type { OwnerMarketingOverview } from './owner.dto';

// Owner Marketing & Growth is read-only aggregate analytics gated by 'owner.dashboard.view'. The service resolves the
// branch scope (allowed-set, plus tenant-wide campaigns at the repo layer) and delegates. Marketing performance is shown
// to any owner-app user. These tests cover the gate, the branch-scope guard, and the delegation.
const ctx = (perms: string[], role = 'OWNER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

const overview = (): OwnerMarketingOverview => ({
  kpis: { activeCampaigns: 3, totalCampaigns: 14, totalSent: 8200, openRatePercent: 41.2, clickRatePercent: 9.6, conversionRatePercent: 5.1, campaignRevenueCents: 1860000, campaignCostCents: 240000, roi: 7.8, referrals: 96 },
  channels: [{ channel: 'sms', campaigns: 8, sent: 6000, revenueCents: 1400000 }, { channel: 'email', campaigns: 6, sent: 2200, revenueCents: 460000 }],
  topCampaigns: [{ id: 'c1', name: 'Spring Gel Promo', channel: 'sms', status: 'completed', audienceLabel: 'VIPs', sent: 1200, openRate: 52, clickRate: 14, bookingRate: 8, revenueCents: 540000, costCents: 40000, roi: 13.5, scheduledAt: null }],
  generatedAt: '2026-06-27T15:00:00.000Z',
});

class FakeRepo extends InMemoryOwnerRepository {
  lastBranchIds: string[] | null | undefined;
  constructor(private allowed: string[] | null = null) { super(); }
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return null; }
  async ownerMarketingOverview(_ctx: OwnerContext, branchIds: string[] | null) { this.lastBranchIds = branchIds; return overview(); }
}

describe('Owner Marketing & Growth — read-only campaign analytics', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.marketingOverview(ctx(['owner.settings.view']))).rejects.toThrow(/permission/i);
  });

  it('returns the overview (KPIs, channels, top campaigns) for an authorized owner', async () => {
    const svc = new OwnerService(new FakeRepo());
    const out = await svc.marketingOverview(ctx(['owner.dashboard.view']));
    expect(out.kpis.activeCampaigns).toBe(3);
    expect(out.kpis.roi).toBe(7.8);
    expect(out.kpis.referrals).toBe(96);
    expect(out.channels[0].channel).toBe('sms');
    expect(out.topCampaigns[0].name).toBe('Spring Gel Promo');
  });

  it('forbids a branch outside the owner’s allowed set', async () => {
    const svc = new OwnerService(new FakeRepo(['b1']));
    await expect(svc.marketingOverview(ctx(['owner.dashboard.view']), 'b2')).rejects.toThrow(/assigned branch/i);
  });

  it('delegates with null branch scope for a full owner (all locations)', async () => {
    const repo = new FakeRepo(null);
    const svc = new OwnerService(repo);
    await svc.marketingOverview(ctx(['owner.dashboard.view']));
    expect(repo.lastBranchIds).toBeNull();
  });
});
