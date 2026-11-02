// The service half of the Oct 4 2026 gift-card / split double-payment fix (repository half: the .pgtest beside this).
// A payment is priced on what has been paid so far; the guarded write must be handed THAT figure. These tests let a
// competing payment land between pricing and writing — the moment two stations / a double tap collide — and require
// the write to be refused with nothing debited, rather than settling a second time.
import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutInProgressError } from './checkout.dto';

const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'];
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };
const competing = (ticketId: string): any => ({ paymentId: 'pay_other_station', ticketId, method: 'cash', amountCents: 1000, tipCents: 0, status: 'partial', createdAt: new Date().toISOString() });

/** Another station's payment lands right AFTER this request reads what has been paid (its pricing read) — before it
 *  writes. Hooked on the first paid-total read per ticket, so a service that re-read the figure at write time (instead
 *  of passing the one it priced on) would see the other station's payment and wrongly settle a second time. */
class OtherStationLandsFirst extends InMemoryCheckoutRepository {
  private landed = new Set<string>();
  override async paidTotalCents(c: CheckoutContext, ticketId: string): Promise<number> {
    const v = await super.paidTotalCents(c, ticketId);
    if (!this.landed.has(ticketId)) { this.landed.add(ticketId); await this.recordPayment(c, competing(ticketId)); }
    return v;
  }
}

let repo: OtherStationLandsFirst; let svc: CheckoutService;
beforeEach(() => { repo = new OtherStationLandsFirst(); svc = new CheckoutService(repo); });
const giftBalance = async (code: string) => repo.giftBalance(ctx, code);

describe('a payment priced before another station paid is refused, nothing debited', () => {
  it('gift card: CHECKOUT_ALREADY_IN_PROGRESS and the card keeps its balance', async () => {
    const before = await giftBalance('GIFT-50');
    await expect(svc.payGiftCard(ctx, 'tk_2041', { giftCardCode: 'GIFT-50' } as any)).rejects.toBeInstanceOf(CheckoutInProgressError);
    expect(await giftBalance('GIFT-50')).toBe(before);
    expect(await repo.paidTotalCents(ctx, 'tk_2041')).toBe(1000);        // only the other station's payment
  });

  it('split: CHECKOUT_ALREADY_IN_PROGRESS, no segment recorded, the gift card keeps its balance', async () => {
    const total = (await svc.recalculate(ctx, 'tk_2043', 'split')).totalDueCents;
    const before = await giftBalance('GIFT-50');
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [
      { method: 'gift_card', amountCents: 2000, giftCardCode: 'GIFT-50' }, { method: 'cash', amountCents: total - 2000 },
    ] } as any)).rejects.toBeInstanceOf(CheckoutInProgressError);
    expect(await giftBalance('GIFT-50')).toBe(before);
    expect(await repo.paidTotalCents(ctx, 'tk_2043')).toBe(1000);
  });
});

describe('without a competing payment the same calls settle normally', () => {
  it('gift card and split both succeed on the plain repository', async () => {
    const plain = new InMemoryCheckoutRepository(); const s = new CheckoutService(plain);
    expect((await s.payGiftCard(ctx, 'tk_2041', { giftCardCode: 'GIFT-50' } as any)).payment.amountCents).toBe(5000);
    const total = (await s.recalculate(ctx, 'tk_2043', 'split')).totalDueCents;
    const r: any = await s.paySplit(ctx, 'tk_2043', { segments: [{ method: 'cash', amountCents: total }] } as any);
    expect(r.status).toBe('paid');
  });
});
