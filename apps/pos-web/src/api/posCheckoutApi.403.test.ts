// posCheckoutApi.403.test.ts — a 403 keeps the server's reason (e.g. a refund past the approval limit "needs an owner or
// manager"); before Oct 2 every 403 became the generic "You do not have permission for this action".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { posCheckoutApi } from './posCheckoutApi';
const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; });
describe('posCheckoutApi 403', () => {
  it('shows the server reason when there is one, the generic text when there is not', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'This refund needs an owner or manager.' }), { status: 403 })) as any;
    await expect(posCheckoutApi.refundTicket('t1', { reason: 'x', amountCents: 100 })).rejects.toThrow('This refund needs an owner or manager.');
    globalThis.fetch = vi.fn(async () => new Response('', { status: 403 })) as any;
    await expect(posCheckoutApi.refundTicket('t1', { reason: 'x', amountCents: 100 })).rejects.toThrow('You do not have permission for this action');
  });
});
