import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService, ValidationError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';

// Adversarial coverage for money-path follow-up payments:
//  • a payment after a partial one collects only the REMAINING balance (no re-charging the full total), and a fully-paid
//    ticket rejects further payment;
//  • a split gift-card segment may not exceed the card's balance, and a rejected split records NOTHING (atomic on
//    validation failure) so a corrected split still works.
// Uses the in-memory repo's seeded fixtures: ticket tk_2041 (~$75) / tk_2043 ($110 + tax); gift cards GIFT-50 = $50.
const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'];
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };

let repo: InMemoryCheckoutRepository;
let svc: CheckoutService;
beforeEach(() => { repo = new InMemoryCheckoutRepository(); svc = new CheckoutService(repo); });

describe('follow-up payment collects only the remaining balance', () => {
  it('partial gift then cash charges the remainder, and a third payment is rejected', async () => {
    const total = (await svc.recalculate(ctx, 'tk_2041', 'gift_card')).totalDueCents;
    const gp = await svc.payGiftCard(ctx, 'tk_2041', { giftCardCode: 'GIFT-50' } as any);
    expect(gp.payment.status).toBe('partial');
    expect(gp.payment.amountCents).toBe(5000); // gift cap

    const cash = await svc.payCash(ctx, 'tk_2041', { amountReceivedCents: 100000 } as any);
    expect(cash.payment.amountCents).toBe(total - 5000);                 // only the remainder, not the full total
    expect(cash.changeDueCents).toBe(100000 - (total - 5000));
    expect(await repo.paidTotalCents(ctx, 'tk_2041')).toBe(total);       // exactly the total captured, never more

    await expect(svc.payCash(ctx, 'tk_2041', { amountReceivedCents: 100000 } as any)).rejects.toThrow(/already paid/i);
  });
});

describe('split payment: gift balance + atomicity', () => {
  it('rejects a gift segment larger than the card balance and records nothing, then a corrected split succeeds', async () => {
    const total = (await svc.recalculate(ctx, 'tk_2043', 'split')).totalDueCents;

    // gift segment 6000 > GIFT-50 balance 5000 -> rejected
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [
      { method: 'cash', amountCents: total - 6000 }, { method: 'gift_card', amountCents: 6000, giftCardCode: 'GIFT-50' },
    ] } as any)).rejects.toThrow(/insufficient/i);

    // atomic: the rejected split must not have recorded the cash segment
    expect(await repo.paidTotalCents(ctx, 'tk_2043')).toBe(0);

    // a corrected split (gift 5000 + cash remainder) still totals the full due and completes
    const ok: any = await svc.paySplit(ctx, 'tk_2043', { segments: [
      { method: 'cash', amountCents: total - 5000 }, { method: 'gift_card', amountCents: 5000, giftCardCode: 'GIFT-50' },
    ] } as any);
    expect(ok.status).toBe('paid');
    expect(ok.payments.length).toBe(2);
    expect(await repo.paidTotalCents(ctx, 'tk_2043')).toBe(total);
  });
});
