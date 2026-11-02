// customer-phone-projection.vitest.spec — Phase 3: a phone change reaches every open POS profile through the outbox
// projection (Constitution 13 §343), as customer_profile_updated with the customer id only.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

// §43 (Oct 21 2026): every projected payload also carries the resource envelope { resourceType, resourceId, resourceVersion };
// these assertions are about the DOMAIN fields, so the envelope is stripped before comparing.
const bare = (p: any) => { const { resourceType: _t, resourceId: _i, resourceVersion: _v, resourceVersionSource: _s, ...rest } = p ?? {}; return rest; };
describe('customer.phone_* → customer_profile_updated', () => {
  for (const type of [DOMAIN_EVENTS.CUSTOMER_PHONE_ACTIVATED, DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_FAILED, DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_COMPLETED]) {
    it(type, async () => {
      const sent: any[] = [];
      const c = new RealtimeProjectionConsumer({ toTenant: (scope: any, event: any, payload: any) => sent.push({ scope, event, payload }) } as any);
      await c.handle({ eventType: type, tenantId: 't1', branchId: 'b1', aggregateId: 'cust-1', payload: { newPhoneMasked: '••••0181' } } as any);
      expect(sent).toHaveLength(1);
      expect(sent[0].event).toBe('customer_profile_updated');
      expect(bare(sent[0].payload)).toEqual({ customerId: 'cust-1' });
      expect(sent[0].scope).toMatchObject({ tenantId: 't1' });
    });
  }
});
