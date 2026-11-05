// posCheckoutApi.payment-keys.test.ts — cash, gift-card and split payments carry an Idempotency-Key (Constitution 5
// §61–66, Oct 4 2026): a retry after a lost answer re-sends the SAME key and the server replays the first result
// instead of answering 409. Without a key the header is absent (older callers keep working).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posCheckoutApi } from './posCheckoutApi';
const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });
const capture = () => { const calls: { url: string; key: string | null }[] = []; globalThis.fetch = vi.fn(async (url: any, init: any) => {
  const h = new Headers(init?.headers); calls.push({ url: String(url), key: h.get('Idempotency-Key') });
  return new Response(JSON.stringify({ payment: { paymentId: 'p1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}) as any; return calls; };

describe('payment Idempotency-Key', () => {
  it('cash, gift card and split send the key they are given, on the right route', async () => {
    const calls = capture();
    await posCheckoutApi.payCash('t1', { amountReceivedCents: 10000 } as any, 'key-cash-00000001');
    await posCheckoutApi.payGiftCard('t1', { giftCardCode: 'GC-1' } as any, 'key-gift-00000001');
    await posCheckoutApi.paySplit('t1', { segments: [] } as any, 'key-split-0000001');
    expect(calls.map((c) => [c.url.replace(/^.*\/tickets\//, ''), c.key])).toEqual([
      ['t1/pay/cash', 'key-cash-00000001'], ['t1/pay/gift-card', 'key-gift-00000001'], ['t1/pay/split', 'key-split-0000001']]);
  });
  it('no key → no header (callers that do not pass one are unchanged)', async () => {
    const calls = capture();
    await posCheckoutApi.payCash('t1', { amountReceivedCents: 10000 } as any);
    expect(calls[0].key).toBeNull();
  });
  it('the screen\'s intent keys: a retry of the SAME payment reuses the key; a changed amount gets a new one', () => {
    const k = createIntentKeys();
    const a = k.keyFor('pay:t1:cash', { amountReceivedCents: 10000 });
    expect(k.keyFor('pay:t1:cash', { amountReceivedCents: 10000 })).toBe(a);       // lost answer → retry → same key → replay
    expect(k.keyFor('pay:t1:cash', { amountReceivedCents: 12000 })).not.toBe(a);   // a different payment is a different intent
    expect(a.length).toBeGreaterThanOrEqual(8);                                     // the server's key format (8–200 chars)
  });
});
