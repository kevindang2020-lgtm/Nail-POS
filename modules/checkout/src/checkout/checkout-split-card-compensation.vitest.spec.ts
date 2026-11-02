import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext, SplitRedemptionError } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// A spy card processor: records capture/void calls so we can assert the compensation flow.
function makeProcessor() {
  const calls = { capture: 0, void: 0, lastVoidRetref: '' };
  const processor: any = {
    name: 'test-processor',
    async authorizeAndCapture() { calls.capture++; return { approved: true, retref: 'RET-123', authCode: 'A1', respstat: 'A', respText: 'Approved' }; },
    async voidTransaction(input: any) { calls.void++; calls.lastVoidRetref = input.retref; return { approved: true, retref: input.retref }; },
    async refund() { return { approved: true }; },
  };
  return { processor, calls };
}

// In-memory repo presenting a CONNECTED card processor; optionally forces the atomic split to roll back.
class ConnectedRepo extends InMemoryCheckoutRepository {
  failSplit = false;
  async settings(ctx: CheckoutContext) { const s = await super.settings(ctx); return { ...s, fiservStatus: 'connected' } as any; }
  async recordSplitAtomic(ctx: CheckoutContext, ticketId: string, segments: any, opts: any): Promise<any> {
    if (this.failSplit) throw new SplitRedemptionError('Gift card GIFT-50 could not be redeemed (balance changed or card inactive)');
    return super.recordSplitAtomic(ctx, ticketId, segments, opts);
  }
}

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.split_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.cash_payment', 'pos.checkout.add_tip'] };

describe('split payment: card capture ordering + rollback compensation', () => {
  it('does NOT capture the card when a gift segment is invalid (gifts are validated first)', async () => {
    const repo = new ConnectedRepo();
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    await expect(
      svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - 100 }, { method: 'gift_card', amountCents: 100, giftCardCode: 'NOT-A-REAL-CARD' }], cardToken: 'tok' } as any),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls.capture).toBe(0); // the card was never charged because the gift segment failed validation first
  });

  it('voids the card capture when the atomic settlement rolls back', async () => {
    const repo = new ConnectedRepo();
    repo.failSplit = true; // force recordSplitAtomic to throw AFTER the card has been captured
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const gift = Math.min(5000, Math.floor(due / 2)); // GIFT-50 has 5000; keep the gift segment within balance
    await expect(
      svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - gift }, { method: 'gift_card', amountCents: gift, giftCardCode: 'GIFT-50' }], cardToken: 'tok' } as any),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls.capture).toBe(1);            // card was captured
    expect(calls.void).toBe(1);               // and then voided on rollback (compensation)
    expect(calls.lastVoidRetref).toBe('RET-123');
  });
});
