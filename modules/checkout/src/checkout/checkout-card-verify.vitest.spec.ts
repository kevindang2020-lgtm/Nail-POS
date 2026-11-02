// checkout-card-verify.vitest.spec.ts — Functional Decision 22: "If terminal connectivity is lost mid-transaction, do not
// automatically void or retry the charge. Set state to unknown / pending verification. Query the processor and wait for
// provider status. Only retry when processor state is known or idempotency guarantees safety."
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, STALE_ATTEMPT_MS, NOT_FOUND_RELEASE_MS } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] } as any;
const TK = 'tk_2042';
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; }
}
/** A processor whose charge call is lost in transit (throws) and whose inquiry answers with `inquiry` (or throws). */
function lostChargeProcessor(inquiry: (() => any) | 'unreachable' | 'no-api') {
  const calls = { charge: 0, inquire: 0, void: 0 };
  const p: any = {
    name: 'spy',
    async authorizeAndCapture() { calls.charge++; throw new Error('ETIMEDOUT reading from terminal'); },
    async voidTransaction() { calls.void++; return { approved: true }; },
    async refund() { return { approved: true }; },
  };
  if (inquiry !== 'no-api') p.inquireByOrderId = async () => { calls.inquire++; if (inquiry === 'unreachable') throw new Error('ECONNREFUSED'); return inquiry(); };
  return { p, calls };
}
async function lostCharge(svc: CheckoutService) {
  await expect(svc.payCard(ctx, TK, { cardToken: 'tok' } as any)).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN/);   // the answer never came back
}
const age = (repo: InMemoryCheckoutRepository, ms: number) => { const p = (repo as any).P(ctx).find((x: any) => x.status === 'processing'); p.createdAt = new Date(Date.now() - ms).toISOString(); return p; };
afterEach(() => vi.useRealTimers());

describe('Functional Decision 22 — a card charge whose answer was lost is VERIFIED with the processor, never retried or voided blindly', () => {
  it('the processor says APPROVED → the payment completes (ticket paid) with the processor reference; nothing is charged again', async () => {
    const repo = new ConnectedRepo(); let amount = 0;
    const { p, calls } = lostChargeProcessor(() => ({ transactions: [{ retref: 'RET-77', approved: true, declined: false, amountCents: amount, authCode: 'A9' }] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await lostCharge(svc);
    amount = age(repo, 0).amountCents;
    const v: any = await svc.verifyCardPayment(ctx, TK);
    expect(v).toMatchObject({ status: 'approved', processorTransactionId: 'RET-77', approvedAmountCents: amount });
    expect((await repo.ticket(ctx, TK) as any).status).toBe('paid');
    expect(calls).toEqual({ charge: 1, inquire: 1, void: 0 });
  });

  it('the processor says DECLINED → the decline is recorded and the card can be re-attempted', async () => {
    const repo = new ConnectedRepo(); let amount = 0;
    const { p } = lostChargeProcessor(() => ({ transactions: [{ retref: 'DEC-1', approved: false, declined: true, amountCents: amount }] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await lostCharge(svc); amount = age(repo, 0).amountCents;
    expect((await svc.verifyCardPayment(ctx, TK)).status).toBe('declined');
    expect((await repo.cardPaymentsForTicket(ctx, TK))[0].idempotencyKey).toBeUndefined();   // claim released
  });

  it('no record at the processor YET → pending (nothing changes); no record after 5 minutes → failed, claim released, a new charge may proceed', async () => {
    const repo = new ConnectedRepo();
    const { p, calls } = lostChargeProcessor(() => ({ transactions: [] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await lostCharge(svc);
    age(repo, 60_000);
    const pending: any = await svc.verifyCardPayment(ctx, TK);
    expect(pending.status).toBe('pending');
    expect(pending.retryAfterSeconds).toBeGreaterThan(0);
    expect((await repo.cardPaymentsForTicket(ctx, TK))[0].status).toBe('processing');
    age(repo, NOT_FOUND_RELEASE_MS + 1000);
    expect((await svc.verifyCardPayment(ctx, TK)).status).toBe('failed');
    const row = (await repo.cardPaymentsForTicket(ctx, TK))[0];
    expect(row.status).toBe('failed'); expect(row.idempotencyKey).toBeUndefined();
    // the released claim lets staff run the card again (the processor is still flaky here, so it throws again)
    await lostCharge(svc);
    expect(calls.charge).toBe(2);
    expect(calls.void).toBe(0);
  });

  it('processor UNREACHABLE, or no inquiry API → unknown; the payment is left exactly as it was', async () => {
    for (const mode of ['unreachable', 'no-api'] as const) {
      const repo = new ConnectedRepo();
      const { p, calls } = lostChargeProcessor(mode);
      const svc = new CheckoutService(repo, undefined, undefined, p);
      await lostCharge(svc); age(repo, NOT_FOUND_RELEASE_MS + 1000);
      const v: any = await svc.verifyCardPayment(ctx, TK);
      expect(v.status).toBe('unknown');
      expect((await repo.cardPaymentsForTicket(ctx, TK))[0].status).toBe('processing');   // still unresolved — not guessed
      expect(calls.void).toBe(0); expect(calls.charge).toBe(1);
    }
  });

  it('only a transaction for THIS attempt counts — a different amount or an already-recorded reference is ignored', async () => {
    const repo = new ConnectedRepo(); let amount = 0;
    const { p } = lostChargeProcessor(() => ({ transactions: [
      { retref: 'OTHER-AMT', approved: true, declined: false, amountCents: amount + 500 },
      { retref: 'ALREADY', approved: true, declined: false, amountCents: amount },
    ] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await lostCharge(svc);
    const row = age(repo, 1000); amount = row.amountCents;
    (repo as any).P(ctx).push({ ...row, paymentId: 'pay_old', status: 'declined', processorTransactionId: 'ALREADY', idempotencyKey: undefined });
    expect((await svc.verifyCardPayment(ctx, TK)).status).toBe('pending');      // neither match → not approved
  });

  it('a POS retry on an attempt stuck > 30 s asks the processor automatically and reports its answer instead of "processing"', async () => {
    const repo = new ConnectedRepo(); let amount = 0;
    const { p, calls } = lostChargeProcessor(() => ({ transactions: [{ retref: 'RET-AUTO', approved: true, declined: false, amountCents: amount }] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await lostCharge(svc);
    amount = age(repo, STALE_ATTEMPT_MS + 1000).amountCents;
    const r: any = await svc.payCard(ctx, TK, { cardToken: 'tok' } as any);
    expect(r.status).toBe('approved');
    expect(r.processorTransactionId).toBe('RET-AUTO');
    expect(calls.charge).toBe(1);                        // the retry did NOT charge the card a second time
  });

  it('nothing waiting → none', async () => {
    const { p } = lostChargeProcessor(() => ({ transactions: [] }));
    expect((await new CheckoutService(new ConnectedRepo(), undefined, undefined, p).verifyCardPayment(ctx, TK)).status).toBe('none');
  });
});
