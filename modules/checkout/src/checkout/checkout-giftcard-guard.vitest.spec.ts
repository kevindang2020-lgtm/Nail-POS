import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';

// Adversarial coverage for gift-card stored-value integrity at the repository boundary (decrementGift):
//  • redeeming a VOIDED card is a no-op and never resurrects it;
//  • an over-redeem (by > balance) is rejected, not silently clamped — the balance is left untouched;
//  • a normal redeem succeeds, reduces the balance exactly, and a follow-up over-redeem of the remainder is rejected;
//  • a zero/negative redeem is rejected.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: [] };

let repo: InMemoryCheckoutRepository;
beforeEach(() => { repo = new InMemoryCheckoutRepository(); });

describe('decrementGift guards stored value', () => {
  it('refuses to redeem a voided card and leaves it void', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-VOID', amountCents: 5000 });
    await repo.voidGiftCard(ctx, 'GC-VOID');
    const ok = await repo.decrementGift(ctx, 'GC-VOID', 1000);
    expect(ok).toBe(false);
    const card = await repo.getGiftCard(ctx, 'GC-VOID');
    expect(card?.status).toBe('void');
    expect(card?.balanceCents).toBe(0);
    expect(await repo.giftBalance(ctx, 'GC-VOID')).toBeNull(); // void -> not spendable
  });

  it('rejects an over-redeem without clamping the balance', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-OVER', amountCents: 2000 });
    const ok = await repo.decrementGift(ctx, 'GC-OVER', 5000); // more than the balance
    expect(ok).toBe(false);
    expect(await repo.giftBalance(ctx, 'GC-OVER')).toBe(2000); // untouched, NOT clamped to 0
  });

  it('redeems exactly on a valid amount and rejects redeeming the remainder twice', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-OK', amountCents: 5000 });
    expect(await repo.decrementGift(ctx, 'GC-OK', 3000)).toBe(true);
    expect(await repo.giftBalance(ctx, 'GC-OK')).toBe(2000);
    expect(await repo.decrementGift(ctx, 'GC-OK', 5000)).toBe(false); // only 2000 left
    expect(await repo.giftBalance(ctx, 'GC-OK')).toBe(2000);          // still 2000, no double-spend
    expect(await repo.decrementGift(ctx, 'GC-OK', 2000)).toBe(true);  // exact remainder
    const done = await repo.getGiftCard(ctx, 'GC-OK');
    expect(done?.balanceCents).toBe(0);
    expect(done?.status).toBe('redeemed');
  });

  it('rejects a zero or negative redemption', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-ZERO', amountCents: 1000 });
    expect(await repo.decrementGift(ctx, 'GC-ZERO', 0)).toBe(false);
    expect(await repo.decrementGift(ctx, 'GC-ZERO', -500 as any)).toBe(false);
    expect(await repo.giftBalance(ctx, 'GC-ZERO')).toBe(1000);
  });
});
