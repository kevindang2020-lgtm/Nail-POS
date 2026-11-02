import { describe, it, expect } from 'vitest';
import { buildMarketingOverview, splitByOwner, campaignReference, toDirectoryRow, type CampaignLike } from './marketing-oversight-core';

const mk = (o: Partial<CampaignLike> & { id: string }): CampaignLike => ({
  tenantId: 't1', tenantName: 'Glamour Studio', branchId: 'b1', branchName: 'Downtown', name: 'Campaign', channel: 'email',
  audienceSize: 0, status: 'completed', scheduledAt: null, sentCount: 0, openCount: 0, clickCount: 0, bookingCount: 0, revenueCents: 0, ...o,
});

const campaigns: CampaignLike[] = [
  mk({ id: 'p1', ownerType: 'platform', tenantId: null, name: "Mother's Day Platform Announcement", channel: 'email', audienceSize: 1284741, status: 'scheduled', sentCount: 1000, openCount: 367, clickCount: 98, bookingCount: 1248, revenueCents: 2845000 }),
  mk({ id: 'p2', ownerType: 'platform', tenantId: null, name: 'Summer Hair Care Promo', channel: 'sms', audienceSize: 1201335, status: 'scheduled', sentCount: 1000, openCount: 312, clickCount: 81, bookingCount: 987, revenueCents: 2134000 }),
  mk({ id: 't10231', ownerType: 'tenant', name: 'May Hair Renewal Special', channel: 'email', audienceSize: 12841, status: 'completed', sentCount: 1000, openCount: 342, clickCount: 85, bookingCount: 112, revenueCents: 248000 }),
  mk({ id: 't10487', ownerType: 'tenant', name: 'Weekend Blowout Offer', channel: 'sms', audienceSize: 9632, status: 'in_progress', sentCount: 1000, openCount: 298, clickCount: 79, bookingCount: 86, revenueCents: 198000 }),
  mk({ id: 't10955', ownerType: 'tenant', name: 'Keratin Promo', channel: 'push', audienceSize: 7112, status: 'completed', sentCount: 1000, openCount: 226, clickCount: 54, bookingCount: 57, revenueCents: 222000 }),
];

describe('marketing-oversight engine', () => {
  it('computes the 13 KPIs in order with honest NotConnected for delivery/opt-out', () => {
    const ov = buildMarketingOverview(campaigns);
    expect(ov.kpis.map((k) => k.key)).toEqual([
      'active', 'scheduled', 'completed', 'sms', 'email', 'push', 'audience',
      'delivery_rate', 'open_rate', 'click_rate', 'bookings', 'revenue', 'opt_out_rate',
    ]);
    const byKey = Object.fromEntries(ov.kpis.map((k) => [k.key, k]));
    expect(byKey.active.value).toBe('1');         // one in_progress
    expect(byKey.scheduled.value).toBe('2');
    expect(byKey.completed.value).toBe('2');
    expect(byKey.sms.value).toBe('2');
    expect(byKey.email.value).toBe('2');
    expect(byKey.push.value).toBe('1');
    expect(byKey.bookings.value).toBe((1248 + 987 + 112 + 86 + 57).toLocaleString());
    expect(byKey.delivery_rate.available).toBe(false);
    expect(byKey.opt_out_rate.available).toBe(false);
    expect(byKey.opt_out_rate.unfavorableIfUp).toBe(true);
  });

  it('reconciles channel mix to the total', () => {
    const ov = buildMarketingOverview(campaigns);
    expect(ov.channelMix.reduce((a, c) => a + c.count, 0)).toBe(5);
    expect(ov.channelMix.find((c) => c.channel === 'sms')!.count).toBe(2);
  });

  it('ranks revenue-by-campaign and top campaigns by attributed revenue', () => {
    const ov = buildMarketingOverview(campaigns);
    expect(ov.rankingMetric).toBe('attributed_revenue');
    expect(ov.revenueByCampaign[0].name).toBe("Mother's Day Platform Announcement");
    expect(ov.topCampaigns[0].revenueCents).toBe(2845000);
    expect(ov.topCampaigns[0].deliveryRate).toBeNull();
  });

  it('splits platform vs tenant campaigns and formats references', () => {
    const { platform, tenant } = splitByOwner(campaigns);
    expect(platform).toHaveLength(2);
    expect(tenant).toHaveLength(3);
    expect(platform[0].tenant).toBe('All Tenants');
    expect(tenant[0].tenant).toBe('Glamour Studio');
    expect(campaignReference(campaigns[0]).startsWith('CAMP-PLT-')).toBe(true);
    expect(campaignReference(campaigns[2]).startsWith('CAMP-TNT-')).toBe(true);
  });

  it('directory rows mark delivery + compliance NotConnected', () => {
    const row = toDirectoryRow(campaigns[2]);
    expect(row.deliveryRateAvailable).toBe(false);
    expect(row.complianceAvailable).toBe(false);
    expect(row.openRate).toBe(34.2);
  });
});
