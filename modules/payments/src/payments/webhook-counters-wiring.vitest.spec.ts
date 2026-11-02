// Constitution 4 §173–175 (BUILD_PLAN Phase 11): the payment and bank webhooks count every delivery by outcome.
import { describe, it, expect, beforeEach } from 'vitest';
import { webhookCounts, resetWebhookCountsForTests } from '@aipowersalon/observability';
import { PaymentWebhookController } from './payment-webhook.controller';
import { BankWebhookController } from '../deposit-reconciliation/deposit-reconciliation.webhook.controller';

const res = () => { const r: any = { code: 0, status(c: number) { r.code = c; return r; }, json() { return r; } }; return r; };
const count = (p: string) => webhookCounts().find((x) => x.provider === p);

describe('webhook counters wiring', () => {
  beforeEach(() => resetWebhookCountsForTests());
  it('payments: processed, duplicate and rejected deliveries are told apart, per processor', async () => {
    const outs = [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true, duplicate: true } }, { status: 401, body: { ok: false } }, { status: 400, body: { ok: false } }, { status: 500, body: { ok: false, code: 'processing_failed' } }];
    const c = new PaymentWebhookController({ handle: async () => outs.shift() } as any);
    for (let i = 0; i < 5; i++) await c.handle('CardPointe', {}, { headers: {}, rawBody: Buffer.from('{}') }, res());
    // wave 3 PAYI §158: a verified delivery whose processing threw is 'failed' (and verified), and every delivery is timed
    const got = count('payments:cardpointe')!;
    expect(got.latency?.n).toBe(5);
    expect(got.latency!.maxMs).toBeGreaterThanOrEqual(0);
    delete (got as any).latency;
    expect(got).toEqual({ provider: 'payments:cardpointe', received: 5, verified: 3, rejected: 2, duplicate: 1, processed: 1, failed: 1 });
  });
  it('bank: signature failure, replayed delivery, and a new deposit', async () => {
    const outs: any[] = [{ status: 401, reason: 'signature_invalid' }, { status: 200, reason: 'already_processed', idempotent: true }, { status: 200, reason: 'accepted', idempotent: false }, { status: 404, reason: 'unknown_endpoint' }];
    const c = new BankWebhookController({ ingest: async () => outs.shift() } as any);
    for (let i = 0; i < 4; i++) await c.ingest('tok', { headers: {}, rawBody: Buffer.from('{}') }, res());
    const bank = count('bank')!; delete (bank as any).latency;
    expect(bank).toEqual({ provider: 'bank', received: 4, verified: 2, rejected: 2, duplicate: 1, processed: 1, failed: 0 });
  });
});
