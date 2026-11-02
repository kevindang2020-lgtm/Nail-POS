import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// Gift-card issue + reload store whole-cent stored value; a fractional amount would put sub-cent value on the card
// and drift every later balance calculation. These lock in that both amounts must be a positive WHOLE number of
// cents — the same integer guard already enforced for discounts, cash tendered, and split segments (previously the
// gift-card path used isFinite, which let a fractional amount through).
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.gift_card_issue'] };

describe('gift-card amount — money-integrity guard', () => {
  it('rejects a FRACTIONAL issue amount (sub-cent guard)', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.issueGiftCard(ctx, { amountCents: 2500.5 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a ZERO or NEGATIVE issue amount', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.issueGiftCard(ctx, { amountCents: 0 } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.issueGiftCard(ctx, { amountCents: -1000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a FRACTIONAL reload amount on the payment-first reload (checked before the ticket / card lookup)', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.createGiftCardReload(ctx, 't_any', { code: 'GC-ANY', amountCents: 100.5 as any })).rejects.toBeInstanceOf(ValidationError);
  });

  it('has NO direct, payment-less reload (mandate P0 §142) — the only way value reaches a card is a paid ticket', () => {
    const svc: any = new CheckoutService(new InMemoryCheckoutRepository());
    expect(typeof svc.reloadGiftCard).toBe('undefined');
    expect(typeof svc.createGiftCardReload).toBe('function');
  });

  it('accepts a valid whole-cent issue and returns the card balance', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    const card: any = await svc.issueGiftCard(ctx, { amountCents: 5000 });
    expect(card.code).toBeTruthy();
    expect(card.balanceCents).toBe(5000);
    expect(Number.isInteger(card.balanceCents)).toBe(true);
  });
});

describe('gift-card issuance — server-enforced sale settings', () => {
  it('rejects issuance when gift cards are turned off', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { enabled: false };
    const svc = new CheckoutService(repo);
    await expect(svc.issueGiftCard(ctx, { amountCents: 5000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects issuance when POS gift-card sales are turned off', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { posSalesEnabled: false };
    const svc = new CheckoutService(repo);
    await expect(svc.issueGiftCard(ctx, { amountCents: 5000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an amount below the configured minimum', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { minAmountCents: 2500 };
    const svc = new CheckoutService(repo);
    await expect(svc.issueGiftCard(ctx, { amountCents: 1000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an amount above the configured maximum', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { maxAmountCents: 10000 };
    const svc = new CheckoutService(repo);
    await expect(svc.issueGiftCard(ctx, { amountCents: 20000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts an amount within the configured range', async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.giftCardSaleSettingsOverride = { minAmountCents: 2500, maxAmountCents: 20000 };
    const svc = new CheckoutService(repo);
    const card: any = await svc.issueGiftCard(ctx, { amountCents: 10000 });
    expect(card.balanceCents).toBe(10000);
  });

  it('is idempotent by key — a retried issuance returns the same card, not a second one', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    const a: any = await svc.issueGiftCard(ctx, { amountCents: 5000, idempotencyKey: 'sale-1' } as any);
    const b: any = await svc.issueGiftCard(ctx, { amountCents: 5000, idempotencyKey: 'sale-1' } as any);
    expect(b.code).toBe(a.code);            // same card
    expect(b.balanceCents).toBe(5000);      // balance not doubled by the retry
  });
});
