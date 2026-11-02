import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// Charging fix: a gift card SOLD or RELOADED on a ticket is added to what the customer owes (untaxed), so the payment
// actually collects it. The charge is keyed on the ticket (sale_ticket_id / hold) so it stays stable when the pending
// card flips to active at payment. A ticket with no gift card is completely unaffected.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_issue', 'pos.checkout.gift_card_payment'] };
const TK = 'tk_2042', TK2 = 'tk_2043';

describe('gift-card charge folds into the ticket total', () => {
  it('adds a sold card to the total, untaxed, and leaves a plain ticket unchanged', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const before = (await repo.totalsFor(ctx, TK, 'cash'))!;
    await svc.createGiftCardSale(ctx, TK, { amountCents: 5000 });
    const after = (await repo.totalsFor(ctx, TK, 'cash'))!;
    expect(after.totalDueCents).toBe(before.totalDueCents + 5000); // +$50
    expect(after.taxCents).toBe(before.taxCents);                  // gift card NOT taxed
    expect(after.giftCardChargeCents).toBe(5000);
    // a different ticket with no gift card is untouched
    const plain = (await repo.totalsFor(ctx, TK2, 'cash'))!;
    expect(plain.giftCardChargeCents).toBe(0);
  });

  it('a cash payment collects the higher total (services + gift card)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const services = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    await svc.createGiftCardSale(ctx, TK, { amountCents: 5000 });
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    expect(due).toBe(services + 5000);
    const res: any = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(res.payment.amountCents).toBe(due);                     // charged the full amount incl. the card
    expect(res.changeDueCents).toBe(0);
  });

  it('keeps the charge in the total after the card activates on payment (stable)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    await svc.createGiftCardSale(ctx, TK, { amountCents: 5000 });
    const during = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    await repo.activatePendingGiftCardSales(ctx, TK);              // ticket paid → card goes active
    const afterActivation = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    expect(afterActivation).toBe(during);                          // total does NOT drop
  });

  it('adds a reload amount to the ticket total too', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const sale: any = await svc.createGiftCardSale(ctx, TK2, { amountCents: 5000 });
    await repo.activatePendingGiftCardSales(ctx, TK2);            // an active card to reload
    const before = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    await svc.createGiftCardReload(ctx, TK, { code: sale.code, amountCents: 3000 });
    const after = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    expect(after).toBe(before + 3000);
  });
});
