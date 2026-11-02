import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// Payment-first reload (top-up): createGiftCardReload attaches a PENDING reload to a ticket — the existing card's balance
// does NOT change. Paying the ticket runs afterPaid → activatePendingGiftCardReloads, which credits the card. This makes
// "credit only after payment succeeds" structural, and the credit is idempotent (a retried afterPaid never doubles it).
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.gift_card_issue', 'pos.checkout.gift_card_payment'] };
const TK = 'tk_2042';   // seeded ticket
const TK2 = 'tk_2043';  // a second seeded ticket

// seed an active card of `amount` via the payment-first sale flow, return its code
async function seedCard(repo: InMemoryCheckoutRepository, svc: CheckoutService, amount: number): Promise<string> {
  const sale: any = await svc.createGiftCardSale(ctx, TK, { amountCents: amount });
  await repo.activatePendingGiftCardSales(ctx, TK);
  return sale.code;
}

describe('gift-card reload — payment-first (pending → credit on paid ticket)', () => {
  it('credits an existing card only when the reload ticket is paid', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const code = await seedCard(repo, svc, 5000);
    expect((await repo.getGiftCard(ctx, code))?.balanceCents).toBe(5000);

    const reload: any = await svc.createGiftCardReload(ctx, TK2, { code, amountCents: 3000 });
    expect(reload.status).toBe('pending_payment');
    expect(reload.reference).toMatch(/^GC-\*\*\*\*-/);                 // masked reference, not the code
    expect((await repo.getGiftCard(ctx, code))?.balanceCents).toBe(5000); // NOT credited yet

    expect((await repo.activatePendingGiftCardReloads(ctx, TK2)).activated).toBe(1); // ticket paid
    expect((await repo.getGiftCard(ctx, code))?.balanceCents).toBe(8000);            // 5000 + 3000
  });

  it('reload credit is idempotent — a re-run of afterPaid does not credit twice', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const code = await seedCard(repo, svc, 5000);
    await svc.createGiftCardReload(ctx, TK2, { code, amountCents: 3000 });
    expect((await repo.activatePendingGiftCardReloads(ctx, TK2)).activated).toBe(1);
    expect((await repo.activatePendingGiftCardReloads(ctx, TK2)).activated).toBe(0);
    expect((await repo.getGiftCard(ctx, code))?.balanceCents).toBe(8000); // not doubled
  });

  it('rejects reloading a nonexistent card', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.createGiftCardReload(ctx, TK, { code: 'GC-NOPE9999', amountCents: 3000 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a non-positive reload amount', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const code = await seedCard(repo, svc, 5000);
    await expect(svc.createGiftCardReload(ctx, TK, { code, amountCents: 0 })).rejects.toBeInstanceOf(ValidationError);
  });
});
