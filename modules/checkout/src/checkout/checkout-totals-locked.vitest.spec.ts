// checkout-totals-locked.vitest.spec — Checkout One-Screen + Payment Safety mandate §20 / §37 (Oct 28 2026).
// The bill (manual discount, tip, deal, coupon, reward code, the method's surcharge) may change only while no money is
// moving and none has been taken. Before: applyDiscount had NO guard — a manager could change the discount while a card
// answer was still in the air, or after half the ticket was paid, and the terminal's amount and the ticket's owed amount
// no longer matched; applyTip had no unsettled check.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.apply_discount', 'pos.checkout.override_total', 'pos.checkout.add_tip'] };
const TK = 'tk_2042';
const pay = (status: string, method = 'card', amountCents = 2000) => ({ paymentId: 'pay_' + status + method, ticketId: TK, method, amountCents, tipCents: 0, status, createdAt: new Date().toISOString() }) as any;
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.message; } };

describe('the bill is locked while money moves or after it was taken', () => {
  it('control: a clean ticket takes a discount and a tip', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe('OK');
    expect(await codeOf(svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 300 } as any))).toBe('OK');
  });
  it('a card answer still unknown (processing) → discount, tip and method change are refused; nothing changes', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    await repo.recordPayment(ctx, pay('processing'));
    const before = (await repo.ticket(ctx, TK))!;
    expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe('PAYMENT_STATUS_UNKNOWN');
    expect(await codeOf(svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 300 } as any))).toBe('PAYMENT_STATUS_UNKNOWN');
    expect(await codeOf(svc.recalculate(ctx, TK, 'cash' as any))).toBe('PAYMENT_STATUS_UNKNOWN');
    const after = (await repo.ticket(ctx, TK))!;
    expect(after.discountCents).toBe(before.discountCents); expect(after.tipCents).toBe(before.tipCents);
    expect(svc.auditLog().some((a: any) => a.actionType === 'pos_checkout_totals_change_blocked_unsettled')).toBe(true);
  });
  it('part of the ticket already paid → discount refused (TOTALS_LOCKED_AFTER_CAPTURE), tip refused (TIP_LOCKED_AFTER_CAPTURE)', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    await repo.recordPayment(ctx, pay('approved', 'cash'));
    expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe('TOTALS_LOCKED_AFTER_CAPTURE');
    expect(await codeOf(svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 300 } as any))).toBe('TIP_LOCKED_AFTER_CAPTURE');
    // a partial payment may still switch the remaining tender's method (split): allowed
    expect(await codeOf(svc.recalculate(ctx, TK, 'card' as any))).toBe('OK');
  });
  it('a paid ticket → discount TICKET_ALREADY_PAID', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    await repo.setStatus(ctx, TK, 'paid');
    expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe('TICKET_ALREADY_PAID');
    expect(await codeOf(svc.recalculate(ctx, TK, 'card' as any))).toBe('TICKET_ALREADY_PAID');
  });
  it('a POS or customer-display payment holding the ticket lock → PAYMENT_IN_PROGRESS; a mobile claim keeps editing', async () => {
    for (const [source, want] of [['pos', 'PAYMENT_IN_PROGRESS'], ['display', 'PAYMENT_IN_PROGRESS'], ['mobile', 'OK']] as const) {
      const locks = { async getStatus() { return { locked: true, heldBy: { source } }; } };
      const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, locks as any);
      expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe(want);
    }
  });
  it('a declined / failed earlier card does not lock the bill', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    await repo.recordPayment(ctx, pay('declined'));
    expect(await codeOf(svc.applyDiscount(ctx, TK, { discountCents: 500 }))).toBe('OK');
  });
});

describe('the ticket detail carries the server tenders, paid and balance (§24–§27)', () => {
  it('a partial cash payment → tenders [cash approved], paid 2000, balance = total − 2000', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    await repo.recordPayment(ctx, pay('approved', 'cash'));
    const d: any = await svc.detail(ctx, TK);
    expect(d.tenders.map((t: any) => [t.method, t.status, t.amountCents])).toEqual([['cash', 'approved', 2000]]);
    expect(d.paidCents).toBe(2000); expect(d.balanceCents).toBe(Math.max(0, d.totals.totalDueCents - 2000));
    expect(JSON.stringify(d.tenders)).not.toMatch(/idempotency|processorTransactionId|token/i);
  });
  it('the paid read failing leaves paid/balance OUT (unknown), never 0', async () => {
    const repo = new InMemoryCheckoutRepository(); (repo as any).paidTotalCents = async () => { throw new Error('db down'); };
    const d: any = await new CheckoutService(repo).detail(ctx, TK);
    expect(d.paidCents).toBeUndefined(); expect(d.balanceCents).toBeUndefined();
  });
});
