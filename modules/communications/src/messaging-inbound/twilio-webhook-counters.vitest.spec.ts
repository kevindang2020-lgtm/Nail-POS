// Constitution 4 §173–175 (BUILD_PLAN Phase 11): the Twilio inbound / status webhooks count deliveries by outcome.
import { describe, it, expect, beforeEach } from 'vitest';
import { webhookCounts, resetWebhookCountsForTests } from '@aipowersalon/observability';
import { TwilioInboundController } from './twilio-inbound.controller';

const req = { headers: { host: 'api.test' }, protocol: 'https', originalUrl: '/webhooks/twilio/sms/inbound' };
const res: any = { set() { return res; }, send() { return res; } };

describe('Twilio webhook counters', () => {
  beforeEach(() => resetWebhookCountsForTests());
  it('a bad signature is rejected; a signed delivery is verified and processed', async () => {
    const outs: any[] = [{ status: 'ignored', reason: 'bad_signature' }, { status: 'opted_out', tenantId: 't' }, { status: 'ignored', reason: 'no_signature_config' }];
    const c = new TwilioInboundController({ handleInbound: async () => outs.shift(), handleStatus: async () => ({ status: 'recorded', updated: 1 }) } as any);
    for (let i = 0; i < 3; i++) await c.inbound(req, res, { From: '+1', To: '+2', Body: 'STOP' }, 'sig');
    await c.status(req, res, { MessageSid: 'SM1', MessageStatus: 'delivered' }, 'sig');
    expect(webhookCounts().find((x) => x.provider === 'twilio')).toEqual({ provider: 'twilio', received: 4, verified: 2, rejected: 2, duplicate: 0, processed: 2, failed: 0 });
  });
});
