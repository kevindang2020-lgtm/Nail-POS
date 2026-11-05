// notifications.sender-numbers.vitest.spec.ts — per-tenant FROM number. Verifies that when a tenant has a registered
// number the send uses it, and when it doesn't the sender falls back to its default from. Uses the real
// NotificationsService with a mock SMS sender that records the from it was given.
import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
import { MockSmsSender } from '@aipowersalon/notifications';
import { NullSenderNumberResolver, type SenderNumberResolver } from './notifications.sender-numbers';

function build(resolver: SenderNumberResolver) {
  const repo = { log: vi.fn(async (r: any) => ({ ...r, id: 'n1', createdAt: 'now' })), listForTenant: vi.fn(async () => []), updateDeliveryByProvider: vi.fn(async () => ({ updated: 0 })) };
  const sms = new MockSmsSender();
  const email = { send: vi.fn(async () => ({ id: 'e1' })) };
  const meter = { hasCapacity: async () => true, adjust: async () => {} };
  const optOut = { isOptedOut: async () => false, optOut: async () => {}, optIn: async () => {}, list: async () => [] };
  const svc = new NotificationsService(repo as any, sms, email as any, meter as any, optOut as any, resolver);
  return { svc, sms };
}
const ctx = { tenantId: 'ten_1', userId: 'u_1', role: 'MANAGER' } as any;

describe('per-tenant sender number', () => {
  it('uses the tenant\u2019s registered number as the SMS from', async () => {
    const resolver: SenderNumberResolver = { resolveFrom: async (t) => (t === 'ten_1' ? '+18565559999' : null) };
    const { svc, sms } = build(resolver);
    await svc.send(ctx, { channel: 'sms', to: '+15551230000', body: 'hi' } as any);
    expect(sms.sent[0].from).toBe('+18565559999');
  });
  it('falls back to the sender default when the tenant has no registered number', async () => {
    const { svc, sms } = build(new NullSenderNumberResolver());
    await svc.send(ctx, { channel: 'sms', to: '+15551230000', body: 'hi' } as any);
    expect(sms.sent[0].from).toBeUndefined();   // MockSmsSender records undefined → TwilioSmsSender would use cfg.from
  });
});
