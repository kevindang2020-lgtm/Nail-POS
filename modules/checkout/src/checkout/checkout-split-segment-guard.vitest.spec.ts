import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// Money-integrity hardening for split tenders: paySplit checks that segments SUM to the amount due, but each
// segment must also be a POSITIVE WHOLE number of cents. Without the per-segment guard, a negative segment paired
// with a larger positive one satisfies the sum check while over-charging the card (e.g. [card 12000, cash -2000]
// for a 10000 due would charge the card 12000), and a fractional segment introduces sub-cent drift. Critically,
// every rejection must happen BEFORE the processor is ever asked to capture — a malformed request must charge nothing.

function makeProcessor() {
  const calls = { capture: 0, lastAmount: 0 };
  const processor: any = {
    name: 'spy-processor',
    async authorizeAndCapture(input: any) { calls.capture++; calls.lastAmount = input.amountCents; return { approved: true, retref: 'RET-1', respstat: 'A', respText: 'Approved' }; },
    async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
    async refund() { return { approved: true }; },
  };
  return { processor, calls };
}
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected', cardSurchargeEnabled: true } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.split_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.cash_payment', 'pos.checkout.add_tip'] };
const TK = 'tk_2043';

describe('paySplit — per-segment money-integrity guard', () => {
  it('rejects a NEGATIVE segment (that still sums to due) and never charges the processor', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, TK, 'split'))!.totalDueCents;
    // sum = (due + 2000) + (-2000) = due, so the sum check would pass — only the per-segment guard catches this.
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'card', amountCents: due + 2000 }, { method: 'cash', amountCents: -2000 }], cardToken: 'tok' } as any))
      .rejects.toThrow(/positive whole number of cents/i);
    expect(calls.capture).toBe(0); // nothing was charged
  });

  it('rejects a FRACTIONAL (non-integer) segment and never charges the processor', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'card', amountCents: 100.5 }, { method: 'cash', amountCents: 100 }], cardToken: 'tok' } as any))
      .rejects.toThrow(/positive whole number of cents/i);
    expect(calls.capture).toBe(0);
  });

  it('rejects a ZERO-amount segment', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, TK, 'split'))!.totalDueCents;
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'card', amountCents: due }, { method: 'cash', amountCents: 0 }], cardToken: 'tok' } as any))
      .rejects.toThrow(/positive whole number of cents/i);
    expect(calls.capture).toBe(0);
  });

  it('rejects an empty segment list', async () => {
    const repo = new ConnectedRepo(); const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    await expect(svc.paySplit(ctx, TK, { segments: [], cardToken: 'tok' } as any))
      .rejects.toThrow(/at least one payment segment/i);
  });

  it('still accepts a valid positive-integer split (guard does not break the happy path)', async () => {
    const repo = new ConnectedRepo(); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, TK, 'split'))!.totalDueCents;
    const res: any = await svc.paySplit(ctx, TK, { segments: [{ method: 'card', amountCents: due - 2000 }, { method: 'cash', amountCents: 2000 }], cardToken: 'tok' } as any);
    expect(res.status).toBe('paid');
    expect(calls.capture).toBe(1);
  });
});
