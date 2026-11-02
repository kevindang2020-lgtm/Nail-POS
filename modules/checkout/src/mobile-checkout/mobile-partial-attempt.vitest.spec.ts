import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import type { Ctx } from '@aipowersalon/permissions';

const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u_mgr', role: 'MANAGER', permissions: [] };

function setup(totalDueCents: number) {
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const locks = { getStatus: async () => ({ ownedByCaller: true }), active: async () => null } as any;
  const svc = new MobileCheckoutService(undefined as any, {} as any, { unsettledTenders: async () => [] } as any, locks, attempts);
  vi.spyOn(svc as any, 'getTicketDetail').mockResolvedValue({ totals: { totalDueCents } });
  return { svc, attempts };
}

describe('createAttempt — partial / split-tender aware', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('defaults to the whole balance when no amount is given', async () => {
    const { svc } = setup(10000);
    const a = await svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1' });
    expect(a.amountCents).toBe(10000);
  });

  it('accepts a partial, and a later attempt can only take the remaining slice', async () => {
    const { svc, attempts } = setup(10000);
    const first = await svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1', amountCents: 3000 });
    expect(first.amountCents).toBe(3000);
    // The first attempt is 'created' → it reserves 3000, so the remaining is 7000.
    const bal = await svc.getBalanceSummary(ctx, 'tk1');
    expect(bal).toMatchObject({ inFlightCents: 3000, remainingCents: 7000, isFullyPaid: false });
    // A second attempt with no amount takes exactly the remaining 7000.
    const second = await svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K2' });
    expect(second.amountCents).toBe(7000);
    // Now nothing is left to reserve — but nothing is PAID either: the two intents hold the balance (M6-5 live pilot: this
    // used to answer PAYMENT_ALREADY_COMPLETED, telling the phone the customer had paid)
    await expect(svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K3' })).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });   // §190 taxonomy
    void attempts;
  });

  it('rejects an amount larger than the remaining balance', async () => {
    const { svc } = setup(10000);
    await expect(svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1', amountCents: 10001 }))
      .rejects.toMatchObject({ code: 'amount_exceeds_remaining' });
  });

  it('is idempotent: re-posting the same key returns the same attempt, not a second charge', async () => {
    const { svc } = setup(10000);
    const a = await svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1', amountCents: 4000 });
    const b = await svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1', amountCents: 4000 });
    expect(b.id).toBe(a.id);
    // The replay did not reserve a second slice — remaining still reflects a single 4000 attempt.
    expect((await svc.getBalanceSummary(ctx, 'tk1')).remainingCents).toBe(6000);
  });

  it('requires the caller to hold the checkout lock', async () => {
    const { svc } = setup(10000);
    (svc as any).locks = { getStatus: async () => ({ ownedByCaller: false }) };
    await expect(svc.createAttempt(ctx, 'tk1', { sessionId: 's', idempotencyKey: 'K1' }))
      .rejects.toBeInstanceOf(AttemptError);
  });
});
