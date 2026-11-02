import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// The cumulative-refund cap is now enforced atomically at RESERVATION time (advisory-locked on the payment), so two
// concurrent same-payment refunds can't both pass it and over-refund. A reservation counts toward the cap immediately;
// it is finalized on success and released on a gateway decline/error so the balance is freed for a legitimate retry.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.refund'] };

describe('refund — atomic cumulative cap', () => {
  it('reserveRefundAtomic enforces the cap; a reservation that would exceed is rejected', async () => {
    const repo = new InMemoryCheckoutRepository();
    const a = await repo.reserveRefundAtomic(ctx, { paymentId: 'pay_1', capturedCents: 5000, amountCents: 3000 });
    expect(a.ok).toBe(true);
    const b = await repo.reserveRefundAtomic(ctx, { paymentId: 'pay_1', capturedCents: 5000, amountCents: 3000 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.refundable).toBe(2000); // 5000 captured − 3000 already reserved
  });

  it('release frees a reservation so the balance is refundable again', async () => {
    const repo = new InMemoryCheckoutRepository();
    const a = await repo.reserveRefundAtomic(ctx, { paymentId: 'pay_2', capturedCents: 5000, amountCents: 5000 });
    expect(a.ok).toBe(true);
    expect(await repo.refundedTotalCents(ctx, 'pay_2')).toBe(5000);
    if (a.ok) await repo.releaseRefund(ctx, a.refundId);
    expect(await repo.refundedTotalCents(ctx, 'pay_2')).toBe(0);
    const b = await repo.reserveRefundAtomic(ctx, { paymentId: 'pay_2', capturedCents: 5000, amountCents: 5000 });
    expect(b.ok).toBe(true); // fully refundable again
  });

  it('an in-flight refund (reservation held) makes a concurrent second refund exceed the cap and be rejected', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    await repo.recordPayment(ctx, { paymentId: 'pay_3', ticketId: 'tk_2042', method: 'cash', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: new Date().toISOString() } as any);
    const held = await repo.reserveRefundAtomic(ctx, { paymentId: 'pay_3', capturedCents: 5000, amountCents: 5000 });
    expect(held.ok).toBe(true);
    await expect(svc.refund(ctx, 'pay_3', { amountCents: 1, reason: 'dup' } as any)).rejects.toThrow(/refundable balance/i);
  });

  it('a card refund DECLINED by the gateway (respstat C) releases the reservation (balance not consumed); an answer with NO decline code is held as unknown instead (mandate P0 §228)', async () => {
    const vague: any = { name: 'spy', async refund() { return { ok: false, respText: 'Declined' }; }, async authorizeAndCapture() { return { approved: true, retref: 'X' }; }, async voidTransaction() { return { approved: true }; } };
    class Connected0 extends InMemoryCheckoutRepository { async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; } }
    const repo0 = new Connected0(); const svc0 = new CheckoutService(repo0, undefined, undefined, vague);
    await repo0.recordPayment(ctx, { paymentId: 'pay_4a', ticketId: 'tk_2042', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'RET-1', createdAt: new Date().toISOString() } as any);
    await expect(svc0.refund(ctx, 'pay_4a', { amountCents: 5000, reason: 'x' } as any)).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    expect(await repo0.refundedTotalCents(ctx, 'pay_4a')).toBe(5000);   // the text "Declined" without a decline code proves nothing — the money stays held
    const decliningProcessor: any = { name: 'spy', async refund() { return { ok: false, respstat: 'C', respText: 'Declined' }; }, async authorizeAndCapture() { return { approved: true, retref: 'X' }; }, async voidTransaction() { return { approved: true }; } };
    class Connected extends InMemoryCheckoutRepository { async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; } }
    const repo = new Connected();
    const svc = new CheckoutService(repo, undefined, undefined, decliningProcessor);
    await repo.recordPayment(ctx, { paymentId: 'pay_4', ticketId: 'tk_2042', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'RET-1', createdAt: new Date().toISOString() } as any);
    await expect(svc.refund(ctx, 'pay_4', { amountCents: 5000, reason: 'x' } as any)).rejects.toThrow(/declined/i);
    expect(await repo.refundedTotalCents(ctx, 'pay_4')).toBe(0); // reservation released — not left consuming the balance
  });
});
