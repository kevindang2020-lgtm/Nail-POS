// checkout-giftcard-sale-refund.vitest.spec.ts — Gift Cards guide (Nov 4 2026): refunding a ticket that SOLD or RELOADED a
// gift card takes that value back off the card (the card used to stay funded — the money went out twice).
//   • the card's value is the LAST part of a ticket a refund reaches (everything else on the ticket is refunded first)
//   • a line refund never touches the card
//   • value already spent (or moved to a replacement card) refuses the refund BEFORE any money moves
//   • a voided card holds nothing to take back, so its sale can be refunded
//   • a card with an unpaid reload cannot be voided
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext, type GiftCardTicketValue } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.refund', 'checkout.approve_refund', 'pos.checkout.void'] } as any;
const TK = 'tk_2042';   // a seeded in-memory ticket (one service line, l3)

class GiftRepo extends InMemoryCheckoutRepository {
  cards: GiftCardTicketValue[] = [];
  reversals: { amountCents: number; refundPaymentId: string }[] = [];
  pendingReload: string | null = null;
  async giftCardValueOnTicket() { return this.cards.map((c) => ({ ...c })); }
  async reverseGiftCardValueForRefund(_c: CheckoutContext, _t: string, amountCents: number, refundPaymentId: string) {
    this.reversals.push({ amountCents, refundPaymentId });
    let left = amountCents;
    for (const c of this.cards) { const take = Math.min(left, c.creditedCents - c.reversedCents, c.balanceCents); c.reversedCents += take; c.balanceCents -= take; left -= take; }
    return { reversedCents: amountCents - left, shortCents: left };
  }
  async pendingGiftCardReloadTicket() { return this.pendingReload; }
  async voidGiftCardById() { return { ok: true as const, priorBalanceCents: 0 }; }
}
function setup(cards: Partial<GiftCardTicketValue>[], paid: { method: string; amountCents: number }[] = [{ method: 'cash', amountCents: 10000 }]) {
  const repo = new GiftRepo();
  repo.cards = cards.map((c, i) => ({ giftCardId: 'g' + i, last4: '111' + i, status: 'active', balanceCents: 10000, creditedCents: 10000, reversedCents: 0, kind: 'sale', ...c }));
  const P = (repo as any).P(ctx) as any[];
  paid.forEach((p, i) => P.push({ paymentId: 'pay' + i, ticketId: TK, method: p.method, amountCents: p.amountCents, tipCents: 0, status: 'approved', createdAt: new Date().toISOString() }));
  return { repo, svc: new CheckoutService(repo) };
}

describe('refunding a gift-card sale takes the value back off the card', () => {
  it('a full refund of a $100 card sale takes $100 off the card, once', async () => {
    const { svc, repo } = setup([{}]);
    const r: any = await svc.refund(ctx, 'pay0', { reason: 'changed mind' } as any);
    expect(r.status).toBe('refunded');
    expect(repo.reversals).toEqual([{ amountCents: 10000, refundPaymentId: r.refundId }]);
    expect(repo.cards[0].balanceCents).toBe(0);
  });

  it('services + a card on one ticket: the services are refunded first, the card value last', async () => {
    const { svc, repo } = setup([{ creditedCents: 5000, balanceCents: 5000 }], [{ method: 'cash', amountCents: 9000 }]);   // $40 of services + a $50 card
    await svc.refund(ctx, 'pay0', { reason: 'service redo', amountCents: 4000 } as any);
    expect(repo.reversals).toEqual([]);                                   // only the services' share so far
    await svc.refund(ctx, 'pay0', { reason: 'and the card', amountCents: 2000 } as any);
    expect(repo.reversals.map((x) => x.amountCents)).toEqual([2000]);     // now the refund reaches the card
    expect(repo.cards[0].balanceCents).toBe(3000);
  });

  it('a line refund never touches the card', async () => {
    const { svc, repo } = setup([{ creditedCents: 5000, balanceCents: 5000 }], [{ method: 'cash', amountCents: 9000 }]);
    const r: any = await svc.refund(ctx, 'pay0', { reason: 'line', amountCents: 9000, serviceLineIds: ['l3'] } as any);
    expect(r.status).toBe('refunded');
    expect(repo.reversals).toEqual([]);
  });

  it('value already spent refuses the refund before any money moves', async () => {
    const { svc, repo } = setup([{ balanceCents: 2500 }]);
    await expect(svc.refund(ctx, 'pay0', { reason: 'refund' } as any)).rejects.toMatchObject({ code: 'GIFT_CARD_VALUE_SPENT', params: { last4: '1110', balanceCents: 2500, neededCents: 10000 } });
    expect(await repo.refundedTotalCents(ctx, 'pay0')).toBe(0);
    // what is still on the card can be refunded
    const r: any = await svc.refund(ctx, 'pay0', { reason: 'what is left', amountCents: 2500 } as any);
    expect(r.status).toBe('refunded'); expect(repo.cards[0].balanceCents).toBe(0);
  });

  it('a card replaced since points the cashier at the new card; a voided card refunds with nothing to take back', async () => {
    const moved = setup([{ status: 'replaced', balanceCents: 0 }]);
    await expect(moved.svc.refund(ctx, 'pay0', { reason: 'refund' } as any)).rejects.toMatchObject({ code: 'GIFT_CARD_VALUE_MOVED' });
    const voided = setup([{ status: 'void', balanceCents: 0 }]);
    expect(((await voided.svc.refund(ctx, 'pay0', { reason: 'refund' } as any)) as any).status).toBe('refunded');
  });

  it('refundTicket (the split refund) reverses once for the whole amount', async () => {
    const { svc, repo } = setup([{}], [{ method: 'cash', amountCents: 6000 }, { method: 'cash', amountCents: 4000 }]);
    const r: any = await svc.refundTicket(ctx, TK, { amountCents: 10000, reason: 'refund all' } as any);
    expect(r).toMatchObject({ refundedCents: 10000, complete: true });
    expect(repo.reversals.map((x) => x.amountCents)).toEqual([10000]);
  });
});

describe('a card with an unpaid reload cannot be voided', () => {
  it('refuses with the ticket to finish or void first', async () => {
    const { svc, repo } = setup([]);
    repo.pendingReload = 'tk_reload_9';
    await expect(svc.voidGiftCardFromScreen(ctx, 'g0', 'lost card')).rejects.toMatchObject({ code: 'GIFT_CARD_RELOAD_PENDING', params: { ticketId: 'tk_reload_9' } });
    repo.pendingReload = null;
    expect((await svc.voidGiftCardFromScreen(ctx, 'g0', 'lost card')).status).toBe('void');
  });
});
