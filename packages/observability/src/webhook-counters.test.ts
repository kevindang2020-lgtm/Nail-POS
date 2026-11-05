import { describe, it, expect, beforeEach } from 'vitest';
import { recordWebhook, webhookCounts, webhookProvider, resetWebhookCountsForTests, WEBHOOK_OUTCOMES } from './webhook-counters';
import { registry } from './metrics';

describe('webhook counters (Constitution 4 §173–175)', () => {
  beforeEach(() => resetWebhookCountsForTests());
  it('counts received / verified / rejected / duplicate / processed per provider, in the registry', () => {
    recordWebhook('twilio', 'received'); recordWebhook('twilio', 'verified'); recordWebhook('twilio', 'processed');
    recordWebhook('twilio', 'received'); recordWebhook('twilio', 'rejected');
    recordWebhook('payments:cardpointe', 'received'); recordWebhook('payments:cardpointe', 'verified'); recordWebhook('payments:cardpointe', 'duplicate');
    const c = webhookCounts();
    expect(c.find((x) => x.provider === 'twilio')).toEqual({ provider: 'twilio', received: 2, verified: 1, rejected: 1, duplicate: 0, processed: 1, failed: 0 });
    expect(c.find((x) => x.provider === 'payments:cardpointe')).toEqual({ provider: 'payments:cardpointe', received: 1, verified: 1, rejected: 0, duplicate: 1, processed: 0, failed: 0 });
    expect(registry.exposition()).toMatch(/aipowersalon_webhook_events_total\{provider="twilio",outcome="received"\} 2/);
    expect(WEBHOOK_OUTCOMES).toEqual(['received', 'verified', 'rejected', 'duplicate', 'processed', 'failed']);   // wave 3 PAYI §158: + failed
  });
  it('a provider name from the URL is normalised to a bounded vocabulary', () => {
    expect(webhookProvider('payments', 'CardPointe')).toBe('payments:cardpointe');
    expect(webhookProvider('payments', 'fiserv')).toBe('payments:fiserv');
    expect(webhookProvider('payments', '../../etc/passwd')).toBe('payments:other');
    expect(webhookProvider('bank')).toBe('bank');
  });
});
