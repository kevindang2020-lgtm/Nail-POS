import { describe, it, expect } from 'vitest';
import { CloverPaymentAdapter, CloverConfig } from './clover.client';
import type { FetchLike, FetchResponseLike } from './cardpointe.client';
import { ProcessorError } from './payment-processor.port';

// JSON-body-aware fake transport: records the last request and parses the JSON body.
function fakeTransport(handler: (url: string, init: any) => FetchResponseLike | Promise<FetchResponseLike>) {
  const calls: { url: string; init: any; body: any }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    let body: any = {}; try { body = init.body ? JSON.parse(init.body as string) : {}; } catch { /* empty */ }
    calls.push({ url, init, body });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}
const ok = (json: any): FetchResponseLike => ({ status: 200, ok: true, json: async () => json, text: async () => JSON.stringify(json) });
const cfg: CloverConfig = { baseUrl: 'https://scl-sandbox.dev.clover.com', apiAccessToken: 'clv_test_123', currency: 'usd' };

describe('CloverPaymentAdapter', () => {
  it('reports its name as clover', () => {
    expect(new CloverPaymentAdapter(cfg, (async () => ok({})) as unknown as FetchLike).name).toBe('clover');
  });

  it('authorizeAndCapture posts a charge in cents with Bearer auth and maps paid -> approved', async () => {
    const t = fakeTransport(() => ok({ id: 'chg_1', paid: true, status: 'succeeded', amount: 1250 }));
    const res = await new CloverPaymentAdapter(cfg, t.fetchImpl).authorizeAndCapture({ account: 'clv_tok', amountCents: 1250, orderId: 'tk_1', idempotencyKey: 'idem-1' });
    expect(res).toMatchObject({ approved: true, declined: false, retref: 'chg_1', respstat: 'A', amountCents: 1250 });
    const c = t.calls[0];
    expect(c.url).toBe('https://scl-sandbox.dev.clover.com/v1/charges');
    expect(c.init.method).toBe('POST');
    expect(c.init.headers.Authorization).toBe('Bearer clv_test_123');
    expect(c.init.headers['Content-Type']).toBe('application/json');
    expect(c.init.headers['idempotency-key']).toBe('idem-1');
    expect(c.body.amount).toBe(1250);            // cents, not a dollar string
    expect(c.body.currency).toBe('usd');
    expect(c.body.source).toBe('clv_tok');
    expect(c.body.capture).toBe(true);
    expect(c.body.external_reference_id).toBe('tk_1');
  });

  it('maps an unpaid charge to a decline', async () => {
    const t = fakeTransport(() => ok({ id: 'chg_2', paid: false, status: 'failed' }));
    const res = await new CloverPaymentAdapter(cfg, t.fetchImpl).authorizeAndCapture({ account: 'clv_x', amountCents: 500 });
    expect(res.approved).toBe(false);
    expect(res.declined).toBe(true);
    expect(res.respstat).toBe('C');
  });

  it('maps a pending / in_progress charge to respstat B (retry/provider unavailable, not decline)', async () => {
    const t = fakeTransport(() => ok({ id: 'chg_3', paid: false, status: 'pending' }));
    const res = await new CloverPaymentAdapter(cfg, t.fetchImpl).authorizeAndCapture({ account: 'clv_x', amountCents: 500 });
    expect(res.approved).toBe(false);
    expect(res.declined).toBe(false);
    expect(res.respstat).toBe('B');
    expect(res.respText).toBe('pending');
  });

  it('refund posts to /v1/refunds with charge + amount', async () => {
    const t = fakeTransport(() => ok({ id: 'rfnd_1', status: 'succeeded' }));
    const res = await new CloverPaymentAdapter(cfg, t.fetchImpl).refund({ retref: 'chg_1', amountCents: 500 });
    expect(res.ok).toBe(true);
    expect(res.retref).toBe('rfnd_1');
    expect(t.calls[0].url).toBe('https://scl-sandbox.dev.clover.com/v1/refunds');
    expect(t.calls[0].body.charge).toBe('chg_1');
    expect(t.calls[0].body.amount).toBe(500);
  });

  it('void maps to a FULL refund (charge only, no amount)', async () => {
    const t = fakeTransport(() => ok({ id: 'rfnd_full', status: 'succeeded' }));
    const res = await new CloverPaymentAdapter(cfg, t.fetchImpl).voidTransaction({ retref: 'chg_1' });
    expect(res.ok).toBe(true);
    expect(t.calls[0].url).toBe('https://scl-sandbox.dev.clover.com/v1/refunds');
    expect(t.calls[0].body.charge).toBe('chg_1');
    expect(t.calls[0].body.amount).toBeUndefined(); // full refund — no amount sent
  });

  it('throws ProcessorError on an HTTP error', async () => {
    const t = fakeTransport(() => ({ status: 402, ok: false, json: async () => ({}), text: async () => 'card_declined' }));
    await expect(new CloverPaymentAdapter(cfg, t.fetchImpl).authorizeAndCapture({ account: 'clv', amountCents: 100 })).rejects.toBeInstanceOf(ProcessorError);
  });
});
