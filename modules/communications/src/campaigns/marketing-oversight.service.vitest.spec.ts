import { describe, it, expect } from 'vitest';
import { CampaignsService } from './campaigns.service';

// Minimal fake repo exposing listPlatform with a small cross-tenant set (2 platform + 3 tenant campaigns).
const rows: any[] = [
  { id: 'p1', ownerType: 'platform', tenantId: null, name: 'Platform Email', channel: 'email', audienceSize: 1000000, status: 'scheduled', scheduledAt: '2026-05-07T10:00:00Z', sentCount: 1000, openCount: 367, clickCount: 98, bookingCount: 1248, revenueCents: 2845000 },
  { id: 'p2', ownerType: 'platform', tenantId: null, name: 'Platform SMS', channel: 'sms', audienceSize: 900000, status: 'scheduled', scheduledAt: null, sentCount: 1000, openCount: 312, clickCount: 81, bookingCount: 987, revenueCents: 2134000 },
  { id: 't1', ownerType: 'tenant', tenantId: 'ten1', tenantName: 'Glamour Studio', branchId: 'b1', branchName: 'Downtown', name: 'May Renewal', channel: 'email', audienceSize: 12841, status: 'completed', scheduledAt: null, sentCount: 1000, openCount: 342, clickCount: 85, bookingCount: 112, revenueCents: 248000 },
  { id: 't2', ownerType: 'tenant', tenantId: 'ten2', tenantName: 'Luxe Salon', branchId: 'b2', branchName: 'Main', name: 'Blowout', channel: 'sms', audienceSize: 9632, status: 'in_progress', scheduledAt: null, sentCount: 1000, openCount: 298, clickCount: 79, bookingCount: 86, revenueCents: 198000 },
  { id: 't3', ownerType: 'tenant', tenantId: 'ten3', tenantName: 'Hair Lounge', branchId: 'b3', branchName: 'City', name: 'Welcome', channel: 'push', audienceSize: 8745, status: 'completed', scheduledAt: null, sentCount: 1000, openCount: 411, clickCount: 113, bookingCount: 134, revenueCents: 312000 },
];
const fakeRepo: any = { listPlatform: async () => ({ items: rows, pagination: { page: 1, pageSize: 50, totalItems: rows.length, totalPages: 1 } }) };

describe('CampaignsService.getMarketingOverview', () => {
  const svc = new CampaignsService(fakeRepo);

  it('returns 13 KPIs, channel mix, and the platform/tenant directory split', async () => {
    const ov = await svc.getMarketingOverview({ pageSize: 10 });
    expect(ov.kpis).toHaveLength(13);
    expect(ov.counts.platform).toBe(2);
    expect(ov.counts.tenant).toBe(3);
    expect(ov.directory.platform).toHaveLength(2);
    expect(ov.directory.tenant).toHaveLength(3);
    expect(ov.channelMix.reduce((a, c) => a + c.count, 0)).toBe(5);
    // platform-first ordering in the paged list
    expect(ov.directory.page[0].ownerType).toBe('platform');
  });

  it('marks delivery failures + compliance alerts NotConnected (no backing schema)', async () => {
    const ov = await svc.getMarketingOverview();
    expect(ov.deliveryFailures.available).toBe(false);
    expect(ov.complianceAlerts.available).toBe(false);
    const byKey = Object.fromEntries(ov.kpis.map((k) => [k.key, k]));
    expect(byKey.delivery_rate.available).toBe(false);
    expect(byKey.opt_out_rate.available).toBe(false);
  });

  it('filters the directory by channel', async () => {
    const ov = await svc.getMarketingOverview({ channel: 'sms', pageSize: 50 });
    expect(ov.directory.page.every((r) => r.channel === 'sms')).toBe(true);
    expect(ov.directoryTotal).toBe(2);
  });

  it('paginates the combined directory', async () => {
    const ov = await svc.getMarketingOverview({ pageSize: 2 });
    expect(ov.directory.page).toHaveLength(2);
    expect(ov.pagination.totalItems).toBe(5);
    expect(ov.pagination.totalPages).toBe(3);
  });
});
