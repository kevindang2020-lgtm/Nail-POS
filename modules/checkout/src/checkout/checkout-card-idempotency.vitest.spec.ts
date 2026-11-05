import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// Payment idempotency under retries — the classic "double-tap / network-retry must not double-charge" guarantee.
//  • A retry with the SAME explicit idempotency key on an APPROVED charge returns the original result (same
//    paymentId + retref) WITHOUT re-hitting the gateway — capture happens exactly once.
//  • A prior DECLINE is NOT replayed, so the guest can legitimately re-attempt the same card.
//  • Without an explicit key, a sequential re-submit is still blocked by the already-paid guard (no second capture).

function makeProcessor(opts: { declineFirst?: number } = {}) {
  const calls = { capture: 0, lastAmount: 0 };
  let declines = opts.declineFirst || 0;
  const processor: any = {
    name: 'spy',
    async authorizeAndCapture(input: any) {
      calls.capture++; calls.lastAmount = input.amountCents;
      if (declines > 0) { declines--; return { approved: false, retref: 'DECL-' + calls.capture, respstat: 'C', respText: 'Declined' }; }
      return { approved: true, retref: 'RET-' + calls.capture, authCode: 'A1', respstat: 'A', respText: 'Approved' };
    },
    async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
    async refund() { return { approved: true }; },
  };
  return { processor, calls };
}
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected', cardSurchargeEnabled: true } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
const TK = 'tk_2042';

describe('payCard — idempotency under retries', () => {
  it('replays an APPROVED charge on a same-key retry without re-capturing', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const r1: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'IDEM-1' } as any);
    expect(r1.status).toBe('approved');
    expect(calls.capture).toBe(1);
    const r2: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'IDEM-1' } as any);
    expect(r2.status).toBe('approved');
    expect(r2.paymentId).toBe(r1.paymentId);                       // same recorded payment
    expect(r2.processorTransactionId).toBe(r1.processorTransactionId); // same gateway reference
    expect(calls.capture).toBe(1);                                 // gateway was NOT charged a second time
  });

  it('does NOT replay a prior DECLINE — the same card can be re-attempted', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor({ declineFirst: 1 });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const r1: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'IDEM-2' } as any);
    expect(r1.status).toBe('declined');
    expect(calls.capture).toBe(1);
    const r2: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'IDEM-2' } as any);
    expect(r2.status).toBe('approved');                            // retry of a decline is allowed
    expect(calls.capture).toBe(2);                                 // and it re-attempts the gateway
  });

  it('without an explicit key, a sequential re-submit is blocked by the already-paid guard (one capture)', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const r1: any = await svc.payCard(ctx, TK, { cardToken: 'tok' } as any);
    expect(r1.status).toBe('approved');
    expect(calls.capture).toBe(1);
    await expect(svc.payCard(ctx, TK, { cardToken: 'tok' } as any)).rejects.toThrow(/PAYMENT_ALREADY_COMPLETED/);   // wave 3 PAYI §134: the taxonomy code (controller → 409 + sentence)
    expect(calls.capture).toBe(1);                                 // no second capture
  });

  it('a concurrent same-key charge does NOT double-capture — the loser sees the in-flight claim (claim-first)', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    // Simulate a winner that has claimed the key but not yet settled (mid-gateway-capture):
    const claim = await repo.claimPayment(ctx, { paymentId: 'pay_winner', ticketId: TK, method: 'card', amountCents: 5000, tipCents: 0, idempotencyKey: 'RACE-1' });
    expect(claim.claimed).toBe(true);
    // A second request with the SAME key must not charge the gateway:
    const loser: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'RACE-1' } as any);
    expect(loser.status).toBe('processing');
    expect(calls.capture).toBe(0);
    // Once the winner settles approved, a retry replays that exact result without charging:
    await repo.finalizePayment(ctx, 'pay_winner', { status: 'approved', processorTransactionId: 'RWIN' });
    const replay: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'RACE-1' } as any);
    expect(replay.status).toBe('approved');
    expect(replay.processorTransactionId).toBe('RWIN');
    expect(calls.capture).toBe(0);
  });

  it('claimPayment: a second claim with the same key fails in flight, and a decline releases the key', async () => {
    const repo = new ConnectedRepo();
    const a = await repo.claimPayment(ctx, { paymentId: 'p1', ticketId: TK, method: 'card', amountCents: 5000, tipCents: 0, idempotencyKey: 'CLAIM-1' });
    const b = await repo.claimPayment(ctx, { paymentId: 'p2', ticketId: TK, method: 'card', amountCents: 5000, tipCents: 0, idempotencyKey: 'CLAIM-1' });
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(false);                                 // key already reserved
    expect(b.existing?.status).toBe('processing');
    await repo.finalizePayment(ctx, 'p1', { status: 'declined' }); // a decline releases the reservation
    const c = await repo.claimPayment(ctx, { paymentId: 'p3', ticketId: TK, method: 'card', amountCents: 5000, tipCents: 0, idempotencyKey: 'CLAIM-1' });
    expect(c.claimed).toBe(true);                                  // the same card can be re-attempted
  });

  it('respstat B (retry/provider unavailable) leaves payment in processing and never records a decline', async () => {
    const repo = new ConnectedRepo();
    const processor: any = {
      name: 'cardpointe',
      async authorizeAndCapture() {
        return { approved: false, declined: false, retref: 'RET-BUSY', respstat: 'B', respText: 'Device Busy' };
      },
      async voidTransaction() { return { approved: true }; },
      async refund() { return { approved: true }; },
    };
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const r: any = await svc.payCard(ctx, TK, { cardToken: 'tok', idempotencyKey: 'IDEM-B' } as any);
    expect(r.status).toBe('processing');
    expect(r.providerUnavailable).toBe(true);
    const payments = await repo.payments(ctx, TK);
    expect(payments.some((p) => p.status === 'declined')).toBe(false);
  });
});

