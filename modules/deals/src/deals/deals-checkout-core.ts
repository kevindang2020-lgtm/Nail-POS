// deals-checkout-core.ts — pure math for redeeming a deal at checkout. The deal's discount terms are LOCKED at the
// version captured when the customer booked; this applies those terms to the checkout subtotal, capped so the discount
// never exceeds the subtotal (total never goes negative). Stacking with other discounts is off unless the deal is
// explicitly marked stackable. Money is integer cents.

export type DiscountType = 'percent' | 'fixed';

/** The discount a locked deal contributes to a given subtotal. Never exceeds the subtotal; never negative. */
export function computeDealDiscountCents(
  subtotalCents: number,
  discountType: DiscountType,
  discountPercent: number | null,
  discountCents: number | null,
): number {
  const sub = Math.max(0, Math.floor(subtotalCents));
  if (sub === 0) return 0;
  let raw: number;
  if (discountType === 'percent') raw = Math.round(sub * Math.min(100, Math.max(0, discountPercent ?? 0)) / 100);
  else raw = Math.max(0, Math.floor(discountCents ?? 0));
  return Math.min(sub, raw);
}

export interface StackingDecision { allowed: boolean; reason?: string }

/** Whether a deal may be applied on top of an already-applied discount (e.g. a promo code). Off by default. */
export function resolveStacking(stackable: boolean, otherDiscountApplied: boolean): StackingDecision {
  if (otherDiscountApplied && !stackable) return { allowed: false, reason: 'This deal cannot be combined with another discount.' };
  return { allowed: true };
}
