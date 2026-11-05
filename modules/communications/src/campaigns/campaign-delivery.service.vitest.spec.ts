import { describe, it, expect } from 'vitest';
import { CampaignDeliveryService } from './campaign-delivery.service';
import { InMemoryDeliveryRepo } from './campaign-delivery.repository';

// Delivery data is TENANT-OWNED. These reads used to have no tenant filter at all, on a TenantAuthGuard route —
// so any salon's staff could see every other salon's delivery failures and rollups.
const T = InMemoryDeliveryRepo.SEED_TENANT;

describe('CampaignDeliveryService', () => {
  it('returns real delivery + opt-out KPIs from rollups', async () => {
    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo({ totals: { attempted: 1000, delivered: 974, optedOut: 8 } }));
    expect(await svc.deliveryKpis(T)).toEqual({ deliveryRate: 97.4, optOutRate: 0.8 });
  });

  it('summarizes failures into reference buckets and lists them', async () => {
    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo({ failures: [{ category: 'invalid_phone_email', count: 3 }, { category: 'opted_out', count: 2 }, { category: 'channel_error', count: 1 }] }));
    const summary = await svc.failureSummary(T);
    expect(summary.available).toBe(true);
    expect(summary.total).toBe(6);
    expect(summary.byCategory.find((c) => c.label === 'Invalid Phone/Email')!.count).toBe(3);
    const list = await svc.listFailures(T, { category: 'opted_out' });
    expect(list).toHaveLength(2);
    expect(list.every((f) => f.retryable === false)).toBe(true); // opted_out is permanent
    expect(list[0].maskedDestination).not.toContain('@example'); // masked, not raw
  });

  it('reports empty failure summary as available with zero total', async () => {
    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo());
    const s = await svc.failureSummary(T);
    expect(s.available).toBe(true);
    expect(s.total).toBe(0);
  });

  it('returns null KPIs when there are no rollups', async () => {
    const svc = new CampaignDeliveryService(new InMemoryDeliveryRepo());
    expect(await svc.deliveryKpis(T)).toEqual({ deliveryRate: null, optOutRate: null });
  });
});
