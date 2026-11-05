// checkout-deals-phase5 — BUILD_PLAN Phase 5 at checkout: what a refund gives back on a discounted ticket, the deals
// hooks on refund / void, the itemized discounts (no fake "DISCOUNT" chip — bug 14), the itemized receipt, and the
// persisted audit (bug 13: it lived only in memory).
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { itemizedReceipt, itemizedDiscounts, couponOf } from './checkout-discount-items';
import { FakeDealsPort } from './test-support/fake-deals-port';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.deals.apply', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.refund', 'checkout.approve_refund', 'pos.checkout.apply_discount', 'pos.checkout.override_total'] } as any;
const TK = 'tk_2041';   // l1 Signature Manicure $55, l2 Gel Add-on $15
const port = () => new FakeDealsPort([{ id: 'MANI20', title: '20% off manicure', rule: { type: 'percent', percent: 20 }, lineIds: ['l1'] }]);
async function paidWithDeal() {
  const repo = new InMemoryCheckoutRepository(); const deals = port(); const svc = new CheckoutService(repo).useDeals(deals);
  await svc.applyOffer(ctx, TK, { dealId: 'MANI20' });
  const due = (await svc.recalculate(ctx, TK, 'cash') as any).totalDueCents;
  await svc.payCash(ctx, TK, { amountReceivedCents: due } as any);
  return { repo, deals, svc };
}

describe('deal-aware refunds', () => {
  it('the refund preview shows what each service was actually paid (price minus its discounts, plus the tax on that)', async () => {
    const { svc } = await paidWithDeal();
    const p: any = await svc.refundAllocationPreview(ctx, TK, 100);
    expect(p.lines).toEqual([
      expect.objectContaining({ serviceLineId: 'l1', priceCents: 5500, netCents: 4400, taxCents: 341, paidCents: 4741 }),   // 7.75% tax
      expect.objectContaining({ serviceLineId: 'l2', priceCents: 1500, netCents: 1500, taxCents: 116, paidCents: 1616 }),
    ]);
  });
  it('refunding a SERVICE refunds what it was paid ($44 + its $3.41 tax, not the $55 menu price) and reverses the deal on that line', async () => {
    const { svc, deals } = await paidWithDeal();
    const r: any = await svc.refundTicket(ctx, TK, { reason: 'chipped polish', serviceLineIds: ['l1'] } as any);
    expect(r.requestedCents).toBe(4741);
    expect(r.refundedCents).toBe(4741);
    expect(deals.refunded).toEqual([{ ticketId: TK, lines: ['l1'], reason: 'chipped polish' }]);
  });
  it('a full refund reverses every deal on the ticket', async () => {
    const { svc, deals, repo } = await paidWithDeal();
    const captured = await repo.paidTotalCents(ctx, TK);
    await svc.refundTicket(ctx, TK, { reason: 'unhappy', amountCents: captured } as any);
    expect(deals.refunded).toEqual([{ ticketId: TK, lines: null, reason: 'unhappy' }]);
  });
  it('an amount-only partial refund keeps the deal (the visit happened)', async () => {
    const { svc, deals } = await paidWithDeal();
    await svc.refundTicket(ctx, TK, { reason: 'goodwill', amountCents: 500 } as any);
    expect(deals.refunded).toEqual([]);
  });
  it('refunding every service never asks for more than was captured (per-line tax rounding)', async () => {
    const { svc, repo } = await paidWithDeal();
    const captured = await repo.paidTotalCents(ctx, TK);
    const r: any = await svc.refundTicket(ctx, TK, { reason: 'all of it', serviceLineIds: ['l1', 'l2'] } as any);
    expect(r.requestedCents).toBeLessThanOrEqual(captured);
    expect(r.complete).toBe(true);
  });
  it('a line that is not on the ticket is refused', async () => {
    const { svc } = await paidWithDeal();
    await expect(svc.refundTicket(ctx, TK, { reason: 'x', serviceLineIds: ['nope'] } as any)).rejects.toThrow(/not on this ticket/);
  });
});

describe('itemized discounts and receipts (bug 14)', () => {
  it('a manual discount is itemized as a manual discount — no "DISCOUNT" coupon chip', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo).useDeals(port());
    await svc.applyDiscount(ctx, TK, { discountCents: 500 } as any);
    const d: any = await svc.detail(ctx, TK);
    expect(d.promotion).toBeNull();
    expect(d.discounts).toEqual([expect.objectContaining({ category: 'manual', amountCents: 500 })]);
  });
  it('a coupon shows as the coupon, a deal as the deal', () => {
    const snap = { applied: [{ id: 'deal-r1', category: 'deal', description: 'Deal: Spring', appliedCents: 900, dealId: 'd1', redemptionId: 'r1', lines: [{ lineId: 'l1', cents: 900 }] }, { id: 'deal-r2', category: 'coupon', description: 'Coupon: SAVE5', appliedCents: 500, lines: [] }] };
    expect(couponOf(snap)).toEqual({ code: 'SAVE5', amountCents: 500 });
    expect(itemizedDiscounts(snap, 1400).map((x) => x.category)).toEqual(['deal', 'coupon']);
  });
  it('the receipt lists each service, the discount taken off it, and what was saved', async () => {
    const { repo } = await paidWithDeal();
    const t: any = await repo.ticket(ctx, TK);
    const r = itemizedReceipt(t, (c) => '$' + (c / 100).toFixed(2));
    expect(r.text).toContain('Signature Manicure  $55.00');
    expect(r.text).toMatch(/20% off manicure\s+-\$11\.00/);
    expect(r.savedCents).toBe(1100);
    expect(r.savingsLine).toBe('You saved $11.00.');
  });
});

describe('the checkout audit is persisted (bug 13)', () => {
  it('every audited action reaches the repository (views excluded); a gift card number is masked', async () => {
    const repo = new InMemoryCheckoutRepository(); const rows: any[] = [];
    (repo as any).persistAudit = async (e: any) => { rows.push(e); };
    const svc = new CheckoutService(repo).useDeals(port());
    await svc.detail(ctx, TK);
    await svc.applyOffer(ctx, TK, { dealId: 'MANI20' });
    (svc as any).log(ctx, 'pos_checkout_gift_card_voided', 'pos_gift_card', 'GC1234567890ABCD', undefined, undefined, {});
    await new Promise((r) => setTimeout(r, 0));
    expect(rows.map((r) => r.actionType)).toContain('pos_checkout_offer_applied');
    expect(rows.some((r) => /_viewed$/.test(r.actionType))).toBe(false);
    expect(rows.find((r) => r.entityType === 'pos_gift_card').entityId).toBe('GC-****-ABCD');
  });
});
