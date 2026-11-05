// one-payment-per-ticket.vitest.spec.ts — Oct 6 2026: a ticket takes ONE payment at a time. The customer display's card
// charge on the terminal holds the ticket's checkout lock while the terminal waits for the card; a front-desk payment
// started meanwhile is refused (PAYMENT_IN_PROGRESS) with nothing recorded, instead of being recorded beside the card
// charge (the guest paid twice). The POS payment paths hold the same lock while they record, and always let it go.
import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { PaymentInProgressError } from './checkout.dto';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';

const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'];
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: '11111111-1111-4111-8111-111111111111', role: 'OWNER', permissions: PERMS };
const TK = 'tk_2041';
let repo: InMemoryCheckoutRepository; let lockRepo: InMemoryCheckoutLockRepository; let locks: CheckoutLockService; let svc: CheckoutService;
const display = (ticketId = TK) => locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, userId: '22222222-2222-4222-8222-222222222222', sessionId: 'display-pay:s1', source: 'display' });
const cash = async (ticketId = TK) => svc.payCash(ctx, ticketId, { amountReceivedCents: (await svc.recalculate(ctx, ticketId, 'cash')).totalDueCents } as any);

beforeEach(() => {
  repo = new InMemoryCheckoutRepository(); lockRepo = new InMemoryCheckoutLockRepository(); locks = new CheckoutLockService(lockRepo);
  svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, locks);
});

describe('one payment at a time per ticket', () => {
  it('while the customer pays by card on the terminal, front-desk cash, gift card and split are refused — nothing recorded', async () => {
    await display();
    await expect(cash()).rejects.toBeInstanceOf(PaymentInProgressError);
    await expect(cash()).rejects.toThrow(/paying for this ticket by card on the terminal/);
    await expect(svc.payGiftCard(ctx, TK, { giftCardCode: 'GIFT-50' } as any)).rejects.toBeInstanceOf(PaymentInProgressError);
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'cash', amountCents: 100 }] } as any)).rejects.toBeInstanceOf(PaymentInProgressError);
    expect(await repo.paidTotalCents(ctx, TK)).toBe(0);
  });

  it('when the terminal is done (lock released) the front desk can take the payment', async () => {
    await display();
    await locks.release(ctx.tenantId, TK, 'display-pay:s1');
    expect((await cash()).payment.status).toBe('approved');
  });

  it('another ticket is not affected', async () => {
    await display('tk_2043');
    expect((await cash(TK)).payment.status).toBe('approved');
  });

  it('a front-desk payment holds the ticket while it records, and lets go afterwards — paid or refused', async () => {
    let heldDuring: string | undefined;
    const orig = repo.paidTotalCents.bind(repo);
    repo.paidTotalCents = async (c: any, t: string) => { heldDuring ??= (await lockRepo.getActive(ctx.tenantId, TK))?.source; return orig(c, t); };
    await cash();
    expect(heldDuring).toBe('pos');
    expect(await lockRepo.getActive(ctx.tenantId, TK)).toBeNull();
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: 1 } as any)).rejects.toThrow(/already paid/);   // refused
    expect(await lockRepo.getActive(ctx.tenantId, TK)).toBeNull();                                       // still let go
  });

  it('the display cannot start its charge while the front desk is recording a payment', async () => {
    let displayTried: unknown;
    const orig = repo.paidTotalCents.bind(repo);
    repo.paidTotalCents = async (c: any, t: string) => { if (displayTried === undefined) displayTried = await display().then(() => 'charged', (e) => e?.name); return orig(c, t); };
    await cash();
    expect(displayTried).toBe('LockHeldElsewhereError');
  });

  it('the manager\'s phone checkout is refused as before, with its own words', async () => {
    await locks.acquire({ tenantId: ctx.tenantId, ticketId: TK, userId: ctx.userId, sessionId: 'phone-1', source: 'mobile' });
    await expect(cash()).rejects.toThrow(/mobile device/);
  });

  it('a lock left by a crash expires, so a ticket is never stuck', async () => {
    const short = new CheckoutLockService(lockRepo, 1);
    await short.acquire({ tenantId: ctx.tenantId, ticketId: TK, userId: ctx.userId, sessionId: 'display-pay:crashed', source: 'display' });
    await new Promise((r) => setTimeout(r, 5));
    expect((await cash()).payment.status).toBe('approved');
  });
});
