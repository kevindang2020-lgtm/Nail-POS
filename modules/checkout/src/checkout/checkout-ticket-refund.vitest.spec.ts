// checkout-ticket-refund.vitest.spec.ts — Functional Decision 20 (split-payment refunds) and the commission rule of
// Decision 10 ("refunds reverse the CORRESPONDING commission") on split tickets.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.refund', 'checkout.approve_refund'] } as any;
const TK = 'tk_2042';
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; }
}
function setup(opts: { cardRefundFails?: boolean } = {}) {
  const repo = new ConnectedRepo();
  const P = (repo as any).P(ctx) as any[];
  const now = new Date().toISOString();
  P.push({ paymentId: 'pay_card', ticketId: TK, method: 'card', amountCents: 6000, tipCents: 0, status: 'approved', processorTransactionId: 'RET-CARD', createdAt: now });
  P.push({ paymentId: 'pay_cash', ticketId: TK, method: 'cash', amountCents: 4000, tipCents: 0, status: 'approved', createdAt: now });
  const gateway = { refunds: [] as any[] };
  const processor: any = { name: 'spy', async authorizeAndCapture() { throw new Error('no'); }, async voidTransaction() { return { ok: true }; },
    async refund(i: any) { gateway.refunds.push(i); return opts.cardRefundFails ? { ok: false, respstat: 'C', respText: 'Refund declined' } : { ok: true, retref: 'RF-' + gateway.refunds.length }; } };
  const comp = { reversals: [] as any[], async snapshotPaidTicket() {}, async reverseForRefund(_c: any, _t: string, kind: any) { comp.reversals.push(kind); } };
  const svc = new CheckoutService(repo, undefined, undefined, processor, undefined, undefined, comp as any);
  return { repo, svc, gateway, comp };
}

describe('Functional Decision 20 — a refund amount is split across the original tenders by the backend', () => {
  it('preview: $50 on $60 card + $40 cash → $30 card + $20 cash', async () => {
    const { svc } = setup();
    const p: any = await svc.refundAllocationPreview(ctx, TK, 5000);
    expect(p.allocations.map((a: any) => [a.method, a.amountToRefundCents])).toEqual([['card', 3000], ['cash', 2000]]);
    expect(p.refundableCents).toBe(10000);
  });

  it('refundTicket refunds each part to its OWN method — $30 back on the card through the processor, $20 cash', async () => {
    const { svc, repo, gateway } = setup();
    const r: any = await svc.refundTicket(ctx, TK, { amountCents: 5000, reason: 'Service redo' } as any);
    expect(r).toMatchObject({ refundedCents: 5000, complete: true });
    expect(r.tenders.map((t: any) => [t.method, t.amountCents, t.status])).toEqual([['card', 3000, 'refunded'], ['cash', 2000, 'refunded']]);
    expect(gateway.refunds).toEqual([{ retref: 'RET-CARD', amountCents: 3000, idempotencyKey: expect.stringMatching(/^refund:/) }]);   // Oct 23 merge: a stable per-refund key (a retry never refunds twice)              // the card got ITS share, nothing more
    expect(await repo.refundedTotalCents(ctx, 'pay_card')).toBe(3000);
    expect(await repo.refundedTotalCents(ctx, 'pay_cash')).toBe(2000);
  });

  it('never more than a tender paid: a second refund uses what is LEFT; more than the ticket has left is refused', async () => {
    const { svc } = setup();
    await svc.refundTicket(ctx, TK, { amountCents: 5000, reason: 'part 1' } as any);
    const r2: any = await svc.refundTicket(ctx, TK, { amountCents: 5000, reason: 'part 2' } as any);
    expect(r2.tenders.map((t: any) => [t.method, t.amountCents])).toEqual([['card', 3000], ['cash', 2000]]);
    await expect(svc.refundTicket(ctx, TK, { amountCents: 1, reason: 'too much' } as any)).rejects.toThrow(/exceeds/);
  });

  it('the card is refunded FIRST; if the processor declines it, no cash is handed back', async () => {
    const { svc, repo } = setup({ cardRefundFails: true });
    const r: any = await svc.refundTicket(ctx, TK, { amountCents: 5000, reason: 'x' } as any);
    expect(r).toMatchObject({ refundedCents: 0, complete: false });
    expect(r.tenders).toHaveLength(1);
    expect(r.tenders[0]).toMatchObject({ method: 'card', status: 'failed' });
    expect(await repo.refundedTotalCents(ctx, 'pay_cash')).toBe(0);
  });

  it('a reason is required', async () => {
    const { svc } = setup();
    await expect(svc.refundTicket(ctx, TK, { amountCents: 100, reason: ' ' } as any)).rejects.toThrow(/reason/i);
  });
});

describe('Decision 10 on split tickets — commission reversal is judged against the WHOLE ticket', () => {
  it('refunding the whole $40 CASH tender of a $100 ticket is NOT a full refund — it no longer reverses all commission', async () => {
    const { svc, comp } = setup();
    await svc.refund(ctx, 'pay_cash', { reason: 'cash part back', amountCents: 4000 } as any);
    expect(comp.reversals.find((k) => k.type === 'full')).toBeUndefined();
  });
  it('once every tender is fully refunded, the commission reverses in FULL — exactly once per refund call', async () => {
    const { svc, comp } = setup();
    await svc.refundTicket(ctx, TK, { amountCents: 10000, reason: 'whole visit' } as any);
    expect(comp.reversals.filter((k) => k.type === 'full')).toHaveLength(1);
  });
  it('a partial ticket refund naming lines reverses those lines ONCE — not once per tender', async () => {
    const { svc, comp } = setup();
    await svc.refundTicket(ctx, TK, { amountCents: 5000, reason: 'one service', serviceLineIds: ['l3'] } as any);
    expect(comp.reversals.filter((k) => k.type === 'partial')).toHaveLength(1);
  });
});
