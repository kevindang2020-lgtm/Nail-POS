// customer-display-projection.vitest.spec.ts — 23-inch dual-screen spec §30–§39: the customer-safe checkout the display
// shows is built from the same lines, discount snapshot, totals and payments the POS uses. Pinned here: the spec's own
// §33 example to the cent, line kinds, first-name technicians, original-vs-charged prices, the honest discount fallback,
// every payment status, paid-ticket totals, and the §39 allowlist (nothing internal can leak through).
import { describe, it, expect } from 'vitest';
import { buildCustomerDisplayCheckout, type CustomerDisplayProjectionInput } from './customer-display-projection';
import { computeTotals, DEFAULT_CHECKOUT_SETTINGS } from './checkout-display.dto';

const settings = { ...DEFAULT_CHECKOUT_SETTINGS, taxRatePercent: 7.75, creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3 };

// The spec's §33 example ticket: four lines, a $10 membership benefit and a $5 loyalty reward, $21.72 tip, paid in cash.
const lines: CustomerDisplayProjectionInput['lines'] = [
  { serviceName: 'Gel Manicure', technicianName: 'Olivia Tran', priceCents: 4500, kind: 'service', quantity: 1, catalogCents: 4500 },
  { serviceName: 'Spa Pedicure', technicianName: 'Lisa Ngo', priceCents: 6000, kind: 'service', quantity: 1, catalogCents: 6000 },
  { serviceName: 'French Tip', technicianName: 'Olivia Tran', priceCents: 1000, kind: 'add_on', quantity: 1, catalogCents: 1000 },
  { serviceName: 'Cuticle Oil', technicianName: 'Olivia Tran', priceCents: 1200, kind: 'retail', quantity: 1, catalogCents: 1200, productId: 'prod-1' },
];
const snapshot = { applied: [
  { id: 'membership-benefit-b1', category: 'membership', appliedCents: 1000, description: 'VIP Membership' },
  { id: 'loyalty-r1', category: 'loyalty', appliedCents: 500, description: 'Loyalty Reward' },
] };
function input(over: Partial<CustomerDisplayProjectionInput> = {}): CustomerDisplayProjectionInput {
  const discountCents = over.discountCents ?? 1500;
  const method = (over.totals?.paymentMethod ?? 'cash') as any;
  const totals = over.totals ?? computeTotals(12700 - discountCents, 2172, settings, method, 0);
  return { ticketNumber: '#12', createdAt: '2026-10-06T15:00:00.000Z', ticketStatus: 'ready_for_payment', lines, discountCents, discountSnapshot: snapshot, totals, payments: [], surchargeLabel: 'Card Surcharge', ...over };
}

describe('the spec §33 example, to the cent', () => {
  const c = buildCustomerDisplayCheckout(input());
  it('lines: services with first-name technicians, the add-on, the product (no technician)', () => {
    expect(c.lines).toEqual([
      { kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4500 },
      { kind: 'service', name: 'Spa Pedicure', technicianName: 'Lisa', quantity: 1, amountCents: 6000 },
      { kind: 'add_on', name: 'French Tip', technicianName: 'Olivia', quantity: 1, amountCents: 1000 },
      { kind: 'product', name: 'Cuticle Oil', quantity: 1, amountCents: 1200 },
    ]);
  });
  it('Subtotal $127.00 · VIP Membership −$10.00 · Loyalty Reward −$5.00 · Tax $8.68 · Tip $21.72 · TOTAL DUE $142.40', () => {
    expect(c.itemsSubtotalCents).toBe(12700);
    expect(c.adjustments).toEqual([
      { kind: 'membership', label: 'VIP Membership', amountCents: 1000 },
      { kind: 'loyalty', label: 'Loyalty Reward', amountCents: 500 },
    ]);
    expect(c.discountCents).toBe(1500);
    expect(c.taxCents).toBe(868);
    expect(c.tipCents).toBe(2172);
    expect(c.customerFeeCents).toBe(0);
    expect(c.customerFeeLabel).toBeUndefined();
    expect(c.totalCents).toBe(14240);
    expect(c.balanceDueCents).toBe(14240);
    expect(c.paymentStatus).toBe('unpaid');
  });
  it('the visible arithmetic adds up exactly', () => {
    expect(c.itemsSubtotalCents - c.discountCents + c.taxCents + c.customerFeeCents + c.tipCents + c.giftCardSaleCents).toBe(c.totalCents);
  });
});

describe('lines', () => {
  it('the original price shows only when the line is charged less than the catalog price (×quantity)', () => {
    const c = buildCustomerDisplayCheckout(input({ lines: [
      { serviceName: 'Gel Manicure', priceCents: 4000, catalogCents: 4500, quantity: 1 },
      { serviceName: 'Nail Art', priceCents: 1600, catalogCents: 800, quantity: 2 },
      { serviceName: 'Polish Change', priceCents: 2500, catalogCents: 2000, quantity: 1 },
    ], discountCents: 0, discountSnapshot: null }));
    expect(c.lines[0]).toMatchObject({ amountCents: 4000, originalCents: 4500 });
    expect(c.lines[1]).toEqual({ kind: 'service', name: 'Nail Art', quantity: 2, amountCents: 1600 });
    expect(c.lines[2].originalCents).toBeUndefined();   // charged MORE than catalog (an approved price change) — no fake strike-through
  });
  it('an upgrade is shown as an add-on; a retail line or any product line as a product', () => {
    const c = buildCustomerDisplayCheckout(input({ lines: [
      { serviceName: 'Gel Upgrade', priceCents: 500, kind: 'upgrade' },
      { serviceName: 'Lotion', priceCents: 900, kind: 'service', productId: 'p9' },
      { serviceName: 'Top Coat', priceCents: 700, kind: 'retail' },
    ], discountCents: 0, discountSnapshot: null }));
    expect(c.lines.map((l) => l.kind)).toEqual(['add_on', 'product', 'product']);
  });
});

describe('discounts', () => {
  it('a snapshot that does not add up to the money taken off is replaced by ONE honest line', () => {
    const c = buildCustomerDisplayCheckout(input({ discountCents: 2000 }));   // snapshot says 1500, the ticket takes 2000
    expect(c.adjustments).toEqual([{ kind: 'discount', label: 'Discount', amountCents: 2000 }]);
  });
  it('no snapshot (a legacy discount) → one Discount line', () => {
    const c = buildCustomerDisplayCheckout(input({ discountCents: 700, discountSnapshot: null }));
    expect(c.adjustments).toEqual([{ kind: 'discount', label: 'Discount', amountCents: 700 }]);
  });
  it('a discount larger than the lines takes off only the lines (the POS effective subtotal floors at zero)', () => {
    const c = buildCustomerDisplayCheckout(input({ lines: [{ serviceName: 'Polish', priceCents: 1000 }], discountCents: 5000, discountSnapshot: null, totals: computeTotals(0, 0, settings, 'cash', 0) }));
    expect(c.discountCents).toBe(1000);
    expect(c.totalCents).toBe(0);
  });
  it('every stacking category gets a customer-facing label; a manual discount is just "Discount"', () => {
    const c = buildCustomerDisplayCheckout(input({ lines: [{ serviceName: 'Spa Pedicure', priceCents: 10000 }], discountCents: 1500, discountSnapshot: { applied: [
      { category: 'bundle', appliedCents: 100, description: 'Mani-Pedi Bundle' }, { category: 'deal', appliedCents: 200, description: 'Automatic Deal' },
      { category: 'coupon', appliedCents: 300, description: 'Promo: FALL10' }, { category: 'manual', appliedCents: 400, description: 'Manual Discount' },
      { category: 'membership', appliedCents: 500, description: 'Membership: Spa Pedicure' },
    ] } }));
    expect(c.adjustments.map((a) => `${a.kind}:${a.label}`)).toEqual(['bundle:Mani-Pedi Bundle', 'deal:Deal', 'promotion:Promo: FALL10', 'discount:Discount', 'membership:Membership: Spa Pedicure']);
  });
});

describe('payments', () => {
  const card = computeTotals(11200, 2172, settings, 'card', 0);
  it('card chosen: the surcharge is a labelled customer fee and part of the total', () => {
    const c = buildCustomerDisplayCheckout(input({ totals: card }));
    expect(c.customerFeeCents).toBe(card.surchargeCents);
    expect(c.customerFeeCents).toBeGreaterThan(0);
    expect(c.customerFeeLabel).toBe('Card Surcharge');
    expect(c.totalCents).toBe(card.totalDueCents);
  });
  it('a gift card covering part of it: partially paid, payment listed, balance due', () => {
    const c = buildCustomerDisplayCheckout(input({ payments: [{ method: 'gift_card', amountCents: 4000, status: 'approved' }] }));
    expect(c.paymentStatus).toBe('partially_paid');
    expect(c.payments).toEqual([{ method: 'gift_card', label: 'Gift card', amountCents: 4000 }]);
    expect(c.paidCents).toBe(4000);
    expect(c.balanceDueCents).toBe(14240 - 4000);
  });
  it('a charge in flight is processing; a decline is declined and never listed as received', () => {
    expect(buildCustomerDisplayCheckout(input({ payments: [{ method: 'card', amountCents: 14240, status: 'processing' }] })).paymentStatus).toBe('processing');
    const d = buildCustomerDisplayCheckout(input({ payments: [{ method: 'card', amountCents: 14240, status: 'declined' }] }));
    expect(d.paymentStatus).toBe('declined');
    expect(d.payments).toEqual([]);
    expect(d.balanceDueCents).toBe(14240);
  });
  it('paid: total = what was paid, the fee = what the card payments carried, balance 0, points earned shown', () => {
    const c = buildCustomerDisplayCheckout(input({ ticketStatus: 'paid', totals: card, loyaltyPointsEarned: 120,
      payments: [{ method: 'card', amountCents: card.totalDueCents, surchargeCents: card.surchargeCents, status: 'approved' }] }));
    expect(c.paymentStatus).toBe('paid');
    expect(c.totalCents).toBe(card.totalDueCents);
    expect(c.customerFeeCents).toBe(card.surchargeCents);
    expect(c.balanceDueCents).toBe(0);
    expect(c.loyaltyPointsEarned).toBe(120);
    expect(c.itemsSubtotalCents - c.discountCents + c.taxCents + c.customerFeeCents + c.tipCents).toBe(c.totalCents);
  });
  it('paid in cash while the ticket still says card: no phantom surcharge — the fee is what was actually charged', () => {
    const cash = computeTotals(11200, 2172, settings, 'cash', 0);
    const c = buildCustomerDisplayCheckout(input({ ticketStatus: 'paid', totals: card, payments: [{ method: 'cash', amountCents: cash.totalDueCents, surchargeCents: 0, status: 'approved' }] }));
    expect(c.customerFeeCents).toBe(0);
    expect(c.totalCents).toBe(cash.totalDueCents);
    expect(c.itemsSubtotalCents - c.discountCents + c.taxCents + c.customerFeeCents + c.tipCents).toBe(c.totalCents);
  });
  it('loyalty points appear only once the visit is paid', () => {
    expect(buildCustomerDisplayCheckout(input({ loyaltyPointsEarned: 120 })).loyaltyPointsEarned).toBeUndefined();
  });
});

describe('§39 allowlist: nothing internal reaches the display', () => {
  it('extra fields on the input (commission, ids, processor data, contact details, notes) never appear in the output', () => {
    const leaky: any = input({
      ticketStatus: 'paid',
      payments: [{ method: 'card', amountCents: 14240, surchargeCents: 0, status: 'approved', processorTransactionId: 'RR-SECRET-1', idempotencyKey: 'idem-SECRET', paymentId: 'pay-SECRET' } as any],
    });
    leaky.lines = leaky.lines.map((l: any) => ({ ...l, serviceLineId: 'line-SECRET', technicianId: 'tech-SECRET', commissionValue: 'COMMISSION-SECRET', commissionType: 'percent' }));
    leaky.discountSnapshot = { applied: snapshot.applied.map((a) => ({ ...a, id: 'membership-redemption-SECRET' })) };
    Object.assign(leaky, { customerPhone: '856-555-SECRET', customerEmail: 'SECRET@example.com', notes: 'NOTES-SECRET', commission: { estimatedPayoutCents: 999 } });
    const json = JSON.stringify(buildCustomerDisplayCheckout(leaky));
    expect(json).not.toMatch(/SECRET|commission|processor|idempot|technicianId|serviceLineId|phone|email|notes/i);
  });
  it('technicians appear by first name only', () => {
    const json = JSON.stringify(buildCustomerDisplayCheckout(input()));
    expect(json).not.toContain('Tran');
    expect(json).not.toContain('Ngo');
  });
});
