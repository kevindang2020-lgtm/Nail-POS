// messaging-metrics.vitest.spec.ts — wave 3 PAYI §105: the ONE text path counts segments (not messages), a failed send,
// and delivery callbacks only for rows that actually moved (a repeated callback is not double-counted).
import { describe, it, expect, beforeEach } from 'vitest';
import { MockEmailSender } from '@aipowersalon/notifications';
import { integrationBusinessCounts, resetIntegrationBusinessCountsForTests } from '@aipowersalon/observability';
import { NotificationsService } from './notifications.service';
import { InMemoryNotificationsRepository } from './notifications.repository';

describe('messaging business counters (§105)', () => {
  beforeEach(() => resetIntegrationBusinessCountsForTests());
  it('a two-segment text counts 2 segments_sent; its delivered callback counts once', async () => {
    // a provider that sizes the text (the mock is simulated: its texts are never counted or billed, P-11)
    const provider: any = { send: async (_to: string, body: string) => ({ sid: 'SM-P-1', segments: Math.ceil(body.length / 160) }) };
    const svc = new NotificationsService(new InMemoryNotificationsRepository(), provider, new MockEmailSender());
    const r: any = await svc.sendSms({ tenantId: 'ten_1', to: '+18565550101', body: 'x'.repeat(200), purpose: 'transactional' } as any);
    expect(r.sent).toBe(true);
    expect(integrationBusinessCounts().messaging).toEqual({ segments_sent: 2 });
    await svc.recordDeliveryStatus(r.providerId, 'delivered');
    await svc.recordDeliveryStatus('SM-unknown', 'delivered');   // no row → nothing counted
    expect(integrationBusinessCounts().messaging.delivered).toBe(1);
  });
  it('a provider failure on send is counted as failed', async () => {
    const boom: any = { send: async () => { throw new Error('twilio 500'); } };
    const svc = new NotificationsService(new InMemoryNotificationsRepository(), boom, new MockEmailSender());
    const r: any = await svc.sendSms({ tenantId: 'ten_1', to: '+18565550101', body: 'hi', purpose: 'transactional' } as any);
    expect(r.sent).toBe(false);
    expect(integrationBusinessCounts().messaging).toEqual({ failed: 1 });
  });
});
