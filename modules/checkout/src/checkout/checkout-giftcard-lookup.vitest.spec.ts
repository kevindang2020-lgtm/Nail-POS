import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { InMemoryGiftCardLookupThrottle } from './gift-card-lookup-throttle';

// Redeem/lookup by the customer-facing 16-digit number (spec §13–14): a receptionist enters the number the customer
// reads; the backend resolves it to the card's code, previews balance/status without leaking the code, and redeems.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'] };
const TK = 'tk_2042';
const NUM = '1111222233334444';

describe('gift-card lookup + redeem by 16-digit number', () => {
  it('resolves a spaced 16-digit number to the code; passes a code through; nulls an unknown number', async () => {
    const repo = new InMemoryCheckoutRepository();
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 5000, cardNumber: NUM });
    expect(await repo.resolveGiftCardCode(ctx, '1111 2222 3333 4444')).toBe('GC-ABC1'); // number → code
    expect(await repo.resolveGiftCardCode(ctx, 'GC-ABC1')).toBe('GC-ABC1');              // code passes through
    expect(await repo.resolveGiftCardCode(ctx, '9999 8888 7777 6666')).toBeNull();       // unknown number
  });

  it('previews balance/status without exposing the code, and hides a miss', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 5000, cardNumber: NUM });
    const found: any = await svc.giftCardLookup(ctx, '1111 2222 3333 4444');
    expect(found.found).toBe(true);
    expect(found.balanceCents).toBe(5000);
    expect(found.redeemableHere).toBe(true);
    expect(found.cardNumberMasked).toBe('•••• •••• •••• 4444');
    expect(found.reference).toMatch(/^GC-\*\*\*\*-/);
    expect(found.code).toBeUndefined();                       // never leaks the redeemable code
    const miss: any = await svc.giftCardLookup(ctx, '9999888877776666');
    expect(miss.found).toBe(false);
    expect(miss.balanceCents).toBeUndefined();                // no "almost" hint
  });

  it('redeems a gift card by its 16-digit number at checkout', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 20000, cardNumber: NUM });
    const res: any = await svc.payGiftCard(ctx, TK, { giftCardCode: '1111 2222 3333 4444' });
    expect(res.payment.method).toBe('gift_card');
    expect((await repo.getGiftCard(ctx, 'GC-ABC1'))!.balanceCents).toBeLessThan(20000); // balance decremented
  });

  it('splits with a gift card identified by its 16-digit number', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 20000, cardNumber: NUM });
    const due = (await repo.totalsFor(ctx, TK, 'split'))!.totalDueCents;
    const res: any = await svc.paySplit(ctx, TK, { segments: [
      { method: 'gift_card', amountCents: 2000, giftCardCode: '1111 2222 3333 4444' },
      { method: 'cash', amountCents: due - 2000 },
    ] });
    expect(res.status).toBe('paid');
    expect((await repo.getGiftCard(ctx, 'GC-ABC1'))!.balanceCents).toBe(18000); // 2000 redeemed by number
  });

  it('rate-limits repeated failed lookups but never counts a real card', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new InMemoryGiftCardLookupThrottle());
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 5000, cardNumber: NUM });
    // a real card can be looked up as often as needed — successes never count toward the limit
    for (let i = 0; i < 15; i++) expect((await svc.giftCardLookup(ctx, NUM)).found).toBe(true);
    // 10 misses are allowed, then further lookups are blocked
    for (let i = 0; i < 10; i++) expect((await svc.giftCardLookup(ctx, '9999 8888 7777 0000')).found).toBe(false);
    await expect(svc.giftCardLookup(ctx, '9999 8888 7777 1111')).rejects.toThrow(/too many/i);
  });

  it('replaces a lost/stolen card: mints a new card once and retires the original', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new InMemoryGiftCardLookupThrottle());
    await repo.issueGiftCard(ctx, { code: 'GC-ABC1', amountCents: 5000, cardNumber: NUM });
    const res = await svc.replaceGiftCard(ctx, NUM);
    expect(res.ok).toBe(true);
    expect(res.balanceCents).toBe(5000);
    expect(res.newReference).toMatch(/^GC-\*\*\*\*-/);
    expect(!!res.newCardNumber && /^\d{16}$/.test(res.newCardNumber!)).toBe(true);
    // The original is now retired — replacing it again is refused.
    expect((await svc.replaceGiftCard(ctx, NUM)).ok).toBe(false);
  });

  it('refuses to replace without the gift-card permission', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new InMemoryGiftCardLookupThrottle());
    const noPerm: CheckoutContext = { ...ctx, permissions: ['pos.checkout.view'] };
    await expect(svc.replaceGiftCard(noPerm, NUM)).rejects.toThrow(/gift_card_payment/);
  });
});
