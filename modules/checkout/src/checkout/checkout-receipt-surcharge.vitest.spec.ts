// checkout-receipt-surcharge.vitest.spec.ts — Visa disclosure (Jul 29, 2026): when a card surcharge is part of the
// total a receipt shows, the receipt itemizes it, exactly like the tip. Zero surcharge → no note (cash-style totals
// stay clean). Closes the four-bucket pass's "receipt-text itemization not verified" remainder.
// Oct 6 2026 (23-inch spec Unit 6): once the ticket is paid the receipt states the PAYMENTS actually taken (the card's
// surcharge only when a card paid it); before payment, the ticket's own method's totals.
import { describe, it, expect } from 'vitest';
import { CheckoutService } from './checkout.service';

const ctx: any = { tenantId: 'luxe001', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.receipts.send'] };

function harness(opts: { surchargeCents: number; paid?: { totalCents: number; surchargeCents: number }; method?: string }) {
  const sent: string[] = []; const methodsAsked: string[] = [];
  const repo: any = {
    ticket: async () => ({ id: 'tk1', customerPhone: '+18565550100', customerEmail: null, method: opts.method }),
    totalsFor: async (_c: any, _id: string, method: string) => { methodsAsked.push(method); return { totalDueCents: 10609, tipCents: 1500, surchargeCents: opts.surchargeCents }; },
    paidBreakdown: async () => opts.paid ?? { totalCents: 0, surchargeCents: 0 },
    recordReceipt: async () => ({ receiptNumber: 'R-77' }),
  };
  const sms: any = { send: async (_to: string, body: string) => { sent.push(body); return { ref: 'x' }; } };
  const svc = new CheckoutService(repo, sms);
  return { svc, sent, methodsAsked };
}

describe('receipt itemizes the card surcharge', () => {
  it('SMS receipt names the surcharge alongside the tip when one was charged', async () => {
    const { svc, sent } = harness({ surchargeCents: 309, paid: { totalCents: 10609, surchargeCents: 309 }, method: 'card' });
    await (svc as any).sendOne(ctx, 'tk1', 'sms');
    expect(sent[0]).toContain('$106.09');
    expect(sent[0]).toContain('$15.00 tip');
    expect(sent[0]).toContain('$3.09 card surcharge');
  });
  it('no surcharge → no surcharge note', async () => {
    const { svc, sent } = harness({ surchargeCents: 0, paid: { totalCents: 10300, surchargeCents: 0 }, method: 'card' });
    await (svc as any).sendOne(ctx, 'tk1', 'sms');
    expect(sent[0]).toContain('$15.00 tip');
    expect(sent[0]).not.toContain('surcharge');
  });
  it('paid in cash: the receipt states the cash taken — no card surcharge, whatever a card total would have been', async () => {
    const { svc, sent, methodsAsked } = harness({ surchargeCents: 309, paid: { totalCents: 10300, surchargeCents: 0 }, method: 'cash' });
    await (svc as any).sendOne(ctx, 'tk1', 'sms');
    expect(sent[0]).toContain('$103.00');
    expect(sent[0]).not.toContain('surcharge');
    expect(methodsAsked).toEqual(['cash']);   // the ticket's own method, never 'card' for everyone
  });
  it('before payment: the ticket\'s own method\'s totals (a card ticket discloses its surcharge)', async () => {
    const { svc, sent } = harness({ surchargeCents: 309, method: 'card' });
    await (svc as any).sendOne(ctx, 'tk1', 'sms');
    expect(sent[0]).toContain('$106.09');
    expect(sent[0]).toContain('$3.09 card surcharge');
  });
});
