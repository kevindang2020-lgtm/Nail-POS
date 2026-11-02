// customer-display-projection.ts — 23-inch dual-screen spec §30–§39: the ONE customer-safe view of a checkout.
//
// The customer display never computes money and never sees the checkout entity. This pure function receives what the
// checkout repository already holds for the POS — the ticket's lines, its discount snapshot, the totals for the chosen
// payment method (the same totalsForMethod the POS shows) and the ticket's payments — and returns an explicit allowlist
// of fields. Nothing else can leak because nothing else is copied: no ids, commission, pay %, margin, processor data,
// notes, phone or email (§39, §106).
import type { CustomerDisplayAdjustment, CustomerDisplayCheckout, CustomerDisplayLine, CustomerDisplayPayment, CustomerDisplayPaymentStatus } from '@aipowersalon/api-contracts/customer';
import type { CheckoutTotals } from './checkout-display.dto';

export interface CustomerDisplayProjectionInput {
  ticketNumber: string;
  createdAt: string;
  /** The ticket's checkout status ('paid' once settled). */
  ticketStatus: string;
  lines: { serviceName: string; technicianName?: string; priceCents: number; kind?: string; quantity?: number | null; catalogCents?: number | null; productId?: string | null }[];
  /** What the ticket takes off (tickets.discount_cents) — authoritative for money. */
  discountCents: number;
  /** The stacking engine's record of WHY (tickets.discount_snapshot). Shown only when it adds up to discountCents. */
  discountSnapshot?: { applied?: { category?: string; appliedCents?: number; description?: string }[] } | null;
  /** totalsForMethod(effective subtotal, tip, settings, chosen method, gift-card sale) — exactly what the POS shows. */
  totals: CheckoutTotals;
  payments: { method: string; amountCents: number; surchargeCents?: number | null; status: string; giftCardLast4?: string | null }[];
  surchargeLabel?: string;
  loyaltyPointsEarned?: number | null;
}

const RECEIVED = new Set(['approved', 'partial']);
const cents = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const firstName = (full?: string): string | undefined => { const f = (full ?? '').trim().split(/\s+/)[0]; return f ? f : undefined; };
const label = (s: unknown, max = 60): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function lineKindForDisplay(kind: string | undefined, productId: string | null | undefined): CustomerDisplayLine['kind'] {
  const k = String(kind ?? '').toLowerCase();
  if (productId || k === 'retail' || k === 'product') return 'product';
  if (k === 'add_on' || k === 'upgrade') return 'add_on';
  return 'service';
}

export function adjustmentFor(category: string | undefined, description: string | undefined, amountCents: number): CustomerDisplayAdjustment {
  switch (String(category ?? '')) {
    case 'membership': return { kind: 'membership', label: label(description) || 'Membership benefit', amountCents };
    case 'loyalty': return { kind: 'loyalty', label: label(description) || 'Loyalty reward', amountCents };
    case 'coupon': return { kind: 'promotion', label: label(description) || 'Promotion', amountCents };
    case 'deal': return { kind: 'deal', label: 'Deal', amountCents };
    case 'bundle': return { kind: 'bundle', label: label(description) || 'Bundle savings', amountCents };
    default: return { kind: 'discount', label: 'Discount', amountCents };   // a manual discount, or anything not named above
  }
}

function paymentFor(method: string, amountCents: number, giftCardLast4?: string | null): CustomerDisplayPayment {
  switch (method) {
    case 'card': return { method: 'card', label: 'Card', amountCents };
    case 'cash': return { method: 'cash', label: 'Cash', amountCents };
    // which card paid (Oct 6 2026) — four characters at most, never the code or number
    case 'gift_card': return { method: 'gift_card', label: typeof giftCardLast4 === 'string' && /^[A-Z0-9]{4}$/.test(giftCardLast4) ? `Gift card ending ${giftCardLast4}` : 'Gift card', amountCents };
    default: return { method: 'other', label: 'Payment', amountCents };
  }
}

export function buildCustomerDisplayCheckout(i: CustomerDisplayProjectionInput): CustomerDisplayCheckout {
  const lines: CustomerDisplayLine[] = i.lines.map((l) => {
    const kind = lineKindForDisplay(l.kind, l.productId);
    const quantity = Number.isInteger(l.quantity) && (l.quantity as number) > 0 ? (l.quantity as number) : 1;
    const amountCents = cents(l.priceCents);
    const catalog = cents(l.catalogCents) * quantity;
    const tech = kind === 'product' ? undefined : firstName(l.technicianName);
    return {
      kind, name: label(l.serviceName, 80) || (kind === 'product' ? 'Product' : 'Service'), quantity, amountCents,
      ...(tech ? { technicianName: tech } : {}),
      ...(catalog > amountCents && amountCents >= 0 ? { originalCents: catalog } : {}),
    };
  });
  const itemsSubtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  // What the bill actually takes off: the effective subtotal is max(0, lines − discount), so never more than the lines.
  const takenOff = Math.max(0, Math.min(cents(i.discountCents), Math.max(0, itemsSubtotalCents)));
  const fromSnapshot = (i.discountSnapshot?.applied ?? [])
    .map((a) => adjustmentFor(a.category, a.description, cents(a.appliedCents)))
    .filter((a) => a.amountCents > 0);
  const snapshotSum = fromSnapshot.reduce((a, x) => a + x.amountCents, 0);
  // The itemized reasons are shown only when they add up to the money actually taken off; otherwise one honest line.
  const adjustments: CustomerDisplayAdjustment[] = snapshotSum === takenOff ? fromSnapshot : (takenOff > 0 ? [adjustmentFor(undefined, undefined, takenOff)] : []);

  const received = i.payments.filter((p) => RECEIVED.has(p.status));
  const paidCents = received.reduce((a, p) => a + cents(p.amountCents), 0);
  const isPaid = i.ticketStatus === 'paid';
  const t = i.totals;
  // After payment the fee is what the card payments actually carried; before, what the chosen method would add.
  const customerFeeCents = isPaid && received.length ? received.reduce((a, p) => a + cents(p.surchargeCents), 0) : cents(t.surchargeCents);
  const totalCents = isPaid && received.length ? paidCents : cents(t.totalDueCents);
  const last = i.payments[i.payments.length - 1];
  const paymentStatus: CustomerDisplayPaymentStatus = isPaid ? 'paid'
    : i.payments.some((p) => p.status === 'processing') ? 'processing'
      : paidCents > 0 ? 'partially_paid'
        : last && (last.status === 'declined' || last.status === 'failed') ? 'declined'
          : 'unpaid';
  const points = cents(i.loyaltyPointsEarned);
  return {
    ticketNumber: label(i.ticketNumber, 20), date: i.createdAt, lines, adjustments, itemsSubtotalCents,
    discountCents: adjustments.reduce((a, x) => a + x.amountCents, 0),
    taxCents: cents(t.taxCents), customerFeeCents, ...(customerFeeCents > 0 ? { customerFeeLabel: label(i.surchargeLabel) || 'Card surcharge' } : {}),
    tipCents: cents(t.tipCents), giftCardSaleCents: cents(t.giftCardChargeCents),
    totalCents, paidCents, balanceDueCents: isPaid ? 0 : Math.max(0, totalCents - paidCents),
    payments: received.map((p) => paymentFor(p.method, cents(p.amountCents), p.giftCardLast4)),
    paymentStatus, paymentMethod: (t.paymentMethod ?? 'card') as CustomerDisplayCheckout['paymentMethod'],
    ...(isPaid && points > 0 ? { loyaltyPointsEarned: points } : {}),
  };
}
