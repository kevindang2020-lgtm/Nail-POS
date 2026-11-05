import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// Money-integrity hardening for tips supplied on a pay request. The staff pay paths (payCash/payCard/paySplit/
// payGiftCard) accept body.tipCents and previously passed it straight to setTip with no validation — a negative
// tip would UNDER-charge the total and a fractional tip drifts cents. These lock in that any tip on a pay request
// must be a non-negative whole number of cents, rejected BEFORE the gateway is touched.
function makeProcessor() {
  const calls = { capture: 0 };
  const processor: any = { name: 'spy', async authorizeAndCapture() { calls.capture++; return { approved: true, retref: 'R1', respstat: 'A', respText: 'Approved' }; }, async voidTransaction(i: any) { return { approved: true, retref: i.retref }; }, async refund() { return { approved: true }; } };
  return { processor, calls };
}
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected' } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.card_payment', 'pos.checkout.add_tip'] };
const TK = 'tk_2042';

describe('pay paths — tip money-integrity guard', () => {
  it('payCash rejects a NEGATIVE tip', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: 1_000_000, tipCents: -500 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('payCash rejects a FRACTIONAL tip', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: 1_000_000, tipCents: 250.5 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('payCard rejects a negative tip BEFORE charging the gateway', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    await expect(svc.payCard(ctx, TK, { cardToken: 'tok', tipCents: -100 } as any)).rejects.toBeInstanceOf(ValidationError);
    expect(calls.capture).toBe(0); // nothing was charged
  });

  it('still accepts a valid whole-cent tip', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const res = await svc.payCash(ctx, TK, { amountReceivedCents: 1_000_000, tipCents: 500 });
    expect(res.payment.status).toBe('approved');
    expect(res.payment.tipCents).toBe(500); // the tip was applied to the recorded payment
  });
});
