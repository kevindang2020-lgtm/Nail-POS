// checkout-tip-matrix.vitest.spec.ts — Kevin's Custom Tip spec test matrix (Jul 26, 2026), the unit-level half.
// Pins the exact cents for every preset percentage and custom amount in the spec, the invalid inputs, the
// replace/remove semantics through the real service, and split payment with a tip (segments must cover the
// tip-inclusive due exactly — the tip can never be charged twice).
// Companion coverage: checkout-tip-provenance.pgtest (persistence/tenant+branch isolation/finalized guard/receipt),
// checkout-card-idempotency (retry never double-charges), packages/ui money-input.test (string→cents parsing).
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { tipForPercent } from './checkout.dto';
import { validateCustomTip, DEFAULT_CHECKOUT_SETTINGS } from './checkout-display.dto';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.add_tip', 'pos.checkout.take_payment', 'pos.checkout.split_payment', 'pos.checkout.cash_payment'] };
const TK = 'tk_2042';

describe('preset percentages — exact integer cents (spec tests 2-5)', () => {
  it('15/18/20/25% of $95.00 and $100.00', () => {
    expect(tipForPercent(9500, 15)).toBe(1425);
    expect(tipForPercent(9500, 18)).toBe(1710);
    expect(tipForPercent(9500, 20)).toBe(1900);
    expect(tipForPercent(9500, 25)).toBe(2375);
    expect(tipForPercent(10000, 15)).toBe(1500);
    expect(tipForPercent(10000, 18)).toBe(1800);
    expect(tipForPercent(10000, 20)).toBe(2000);
    expect(tipForPercent(10000, 25)).toBe(2500);
  });
});

describe('custom amounts + invalid inputs (spec tests 6-8, 11-12)', () => {
  const max = DEFAULT_CHECKOUT_SETTINGS.maxTipPercent;
  it('accepts $1.00, $17.50, $100.00 (within the max-percent policy)', () => {
    expect(validateCustomTip(100, 9500, max).ok).toBe(true);
    expect(validateCustomTip(1750, 9500, max).ok).toBe(true);
    expect(validateCustomTip(10000, 10000, max).ok).toBe(true);
  });
  it('rejects negative and non-integer cents; text never reaches the backend (parser returns null)', () => {
    expect(validateCustomTip(-100, 9500, max)).toMatchObject({ ok: false, reason: 'TIP_NEGATIVE' });
    expect(validateCustomTip(12.5 as any, 9500, max)).toMatchObject({ ok: false, reason: 'TIP_NOT_INTEGER' });
  });
});

describe('replace / remove through the real service (spec tests 1, 9-10)', () => {
  it('20% → custom $17.50 → No Tip: each REPLACES; totals recalculate each time', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const t0 = (await repo.ticket(ctx, TK))!;
    const tipBase = Math.max(0, t0.lines.reduce((a: number, l: any) => a + l.priceCents, 0) - t0.discountCents); // applyTip tips the DISCOUNTED subtotal
    const pct: any = await svc.applyTip(ctx, TK, { tipType: 'percent', tipPercent: 20, source: 'front_desk' } as any);
    expect(pct.tipCents).toBe(tipForPercent(tipBase, 20));
    const cus: any = await svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1750, source: 'front_desk' } as any);
    expect(cus.tipCents).toBe(1750);                              // replaced, not added
    const cashWith = (await repo.totalsFor(ctx, TK, 'cash'))!;    // surcharge-free method isolates the tip arithmetic
    const none: any = await svc.applyTip(ctx, TK, { tipType: 'none', source: 'front_desk' } as any);
    expect(none.tipCents).toBe(0);
    const cashNone = (await repo.totalsFor(ctx, TK, 'cash'))!;
    expect(cashWith.totalDueCents - cashNone.totalDueCents).toBe(1750);   // total recalculated instantly, by exactly the tip
    // (applyTip's own totals default to card, where the surcharge base correctly INCLUDES the tip — that is the
    // audited surcharge invariant, so the with-tip card total drops by MORE than the bare tip. Asserted via cash.)
  });
});

describe('split payment with a custom tip (spec test 13)', () => {
  it('segments must cover the tip-inclusive due exactly; a wrong sum is rejected; success pays once', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo);
    const t: any = await svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1750, source: 'front_desk' } as any);
    const totals = (await repo.totalsFor(ctx, TK, 'split'))!;
    const due = totals.totalDueCents;
    expect(totals.tipCents).toBe(1750);
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'cash', amountCents: due - 1 }] } as any)).rejects.toThrow(/must total/);
    const res: any = await svc.paySplit(ctx, TK, { segments: [{ method: 'cash', amountCents: due - 500 }, { method: 'cash', amountCents: 500 }] } as any);
    expect(res.status).toBe('paid');
    expect(res.payments.reduce((a: number, p: any) => a + p.amountCents, 0)).toBe(due);   // charged exactly once
    // and the settled ticket now refuses tip edits (finalized guard)
    await expect(svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1, source: 'front_desk' } as any)).rejects.toThrow(/already been captured/);
    void t;
  });
});
