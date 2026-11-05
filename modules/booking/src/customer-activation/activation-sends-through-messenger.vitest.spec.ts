// activation-sends-through-messenger.vitest.spec — BUILD_PLAN Phase 2 (found during the Oct 2026 audit).
//
// The module bound activation to NotificationsService.send() with systemContext({ tenantId: '' }). send() refuses a
// context without a tenant ("Not authenticated"), so in production NO activation code was ever texted — every request
// answered 503 sms_unavailable. And send() reports a failed handoff as { sent: false } rather than throwing, which the
// old code would have counted as delivered. These tests drive the REAL NotificationsService (mock provider only).
import { describe, it, expect } from 'vitest';
import { MockSmsSender, MockEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from '@aipowersalon/communications';
import { CustomerActivationService, InMemoryTicketStore, type SmsSender } from './customer-activation.service';
import { InMemoryActivationRepo } from './customer-activation.repository';

const repoStub = { log: async () => undefined, listForTenant: async () => [], updateDeliveryByProvider: async () => 0 } as any;

describe('customer activation texts the code through the tenant messenger', () => {
  it('a code request with the real notifications service actually sends the text', async () => {
    const provider = new MockSmsSender();
    const messenger = new NotificationsService(repoStub, provider, new MockEmailSender());
    const sms: SmsSender = messenger;
    const svc = new CustomerActivationService(new InMemoryActivationRepo(), sms, new InMemoryTicketStore());
    const r = await svc.requestCode({ phone: '(856) 555-1234' });
    expect(r.ok).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe('+18565551234');
    expect(provider.sent[0].body).toMatch(/\b\d{6}\b/);
  });

  it('a provider that fails is NOT reported as delivered', async () => {
    const provider = { async send() { throw new Error('carrier down'); } } as any;
    const messenger = new NotificationsService(repoStub, provider, new MockEmailSender());
    const svc = new CustomerActivationService(new InMemoryActivationRepo(), messenger, new InMemoryTicketStore());
    await expect(svc.requestCode({ phone: '(856) 555-1234' })).rejects.toMatchObject({ code: 'sms_unavailable' });
  });
});
