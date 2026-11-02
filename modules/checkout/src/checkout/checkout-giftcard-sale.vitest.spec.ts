import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// Payment-first POS sale: createGiftCardSale creates a PENDING card tied to a ticket (no stored value, not redeemable);
// paying the ticket runs afterPaid → activatePendingGiftCardSales, which flips it to active with its purchased value.
// This makes "activate only after payment succeeds" structural, and activation is idempotent (pending → active only).
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.gift_card_issue', 'pos.checkout.gift_card_payment'] };
const TK = 'tk_2042';

describe('gift-card sale — payment-first (pending → activate on paid ticket)', () => {
  it('creates a pending, non-spendable card and activates it only when the ticket is paid', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const sale: any = await svc.createGiftCardSale(ctx, TK, { amountCents: 10000 });
    expect(sale.status).toBe('pending_payment');
    expect(sale.reference).toMatch(/^GC-\*\*\*\*-/);           // masked public reference, not the code
    expect(await repo.getGiftCard(ctx, sale.code)).toBeNull(); // pending: no spendable card yet
    const r = await repo.activatePendingGiftCardSales(ctx, TK); // ticket paid
    expect(r.activated).toBe(1);
    const active: any = await repo.getGiftCard(ctx, sale.code);
    expect(active?.balanceCents).toBe(10000);
    expect(active?.status).toBe('active');
  });

  it('activation is idempotent — a re-run of afterPaid does not mint value twice', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const sale: any = await svc.createGiftCardSale(ctx, TK, { amountCents: 5000 });
    expect((await repo.activatePendingGiftCardSales(ctx, TK)).activated).toBe(1);
    expect((await repo.activatePendingGiftCardSales(ctx, TK)).activated).toBe(0);
    const active: any = await repo.getGiftCard(ctx, sale.code);
    expect(active?.balanceCents).toBe(5000);                   // not doubled
  });

  it('enforces sale settings before creating a pending sale', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { maxAmountCents: 5000 };
    const svc = new CheckoutService(repo);
    await expect(svc.createGiftCardSale(ctx, TK, { amountCents: 20000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a sale attached to a nonexistent ticket', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.createGiftCardSale(ctx, 'tk_nope', { amountCents: 5000 } as any)).rejects.toBeTruthy();
  });
});
