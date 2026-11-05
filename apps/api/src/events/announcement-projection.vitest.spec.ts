// announcement-projection.vitest.spec — Platform Announcements reach the POS of every salon they concern: one
// announcement.* event per salon → platform_announcement_updated in that salon's owner room, its branch-less room and each
// targeted branch room. Ids + version only (never the message text). Before Nov 5 2026 these two event types were missing
// from the registry, so the service passed `undefined` as the event type and no POS was told to refetch.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const B1 = '11111111-1111-4111-8111-111111111111', B2 = '22222222-2222-4222-8222-222222222222';

describe('announcement.* → platform_announcement_updated', () => {
  for (const type of [DOMAIN_EVENTS.ANNOUNCEMENT_PUBLISHED, DOMAIN_EVENTS.ANNOUNCEMENT_CHANGED]) {
    it(type, async () => {
      const tenant: any[] = [], owner: any[] = [];
      const c = new RealtimeProjectionConsumer({
        toTenant: (scope: any, event: any, payload: any) => tenant.push({ scope, event, payload }),
        toOwner: (t: string, event: any, payload: any) => owner.push({ t, event, payload }),
      } as any);
      await c.handle({ eventType: type, tenantId: 't1', aggregateId: 'n1', payload: { announcementId: 'n1', version: 3, action: 'published', branchIds: [B1, B2, 'not-a-uuid'], message: 'secret text' } } as any);
      expect(owner).toEqual([{ t: 't1', event: 'platform_announcement_updated', payload: { announcementId: 'n1', version: 3, action: 'published' } }]);
      expect(tenant.map((x) => x.scope)).toEqual([{ tenantId: 't1', branchId: '' }, { tenantId: 't1', branchId: B1 }, { tenantId: 't1', branchId: B2 }]);
      for (const x of tenant) expect(x.payload).not.toHaveProperty('message');
    });
  }
  it('the event names are tenant-scoped, not platform.* (each salon gets its own event)', () => {
    expect(DOMAIN_EVENTS.ANNOUNCEMENT_PUBLISHED.startsWith('platform.')).toBe(false);
    expect(DOMAIN_EVENTS.ANNOUNCEMENT_CHANGED.startsWith('platform.')).toBe(false);
  });
});
