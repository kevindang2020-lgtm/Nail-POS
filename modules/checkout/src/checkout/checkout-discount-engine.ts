// checkout-discount-engine.ts — implements the controlled stacking rules for multiple discounts.
// Sequence: Original Price -> Bundle/Package -> Membership Benefit -> Automatic Deal -> Coupon -> Manual -> Loyalty -> Tax -> Gift Card

export type DiscountCategory = 'bundle' | 'membership' | 'deal' | 'coupon' | 'manual' | 'loyalty';

export interface DiscountRequest {
  id: string; // unique identifier for the requested discount
  category: DiscountCategory;
  amountCents: number;
  stackable: boolean;
  priority?: number; // lower number means higher priority within the same category
  description: string;
}

export interface AppliedDiscount {
  id: string;
  category: DiscountCategory;
  appliedCents: number;
  description: string;
}

export interface DiscountEngineResult {
  appliedDiscounts: AppliedDiscount[];
  totalDiscountCents: number;
  snapshot: any;
  rejectedIds: string[];
}

export function applyDiscountSequence(
  subtotalCents: number,
  requests: DiscountRequest[]
): DiscountEngineResult {
  const applied: AppliedDiscount[] = [];
  const rejected: string[] = [];
  let remainingCents = Math.max(0, subtotalCents);

  // Group and sort discounts
  const categories: DiscountCategory[] = ['bundle', 'membership', 'deal', 'coupon', 'manual', 'loyalty'];
  
  let hasExclusive = false;

  for (const cat of categories) {
    const catRequests = requests
      .filter(r => r.category === cat)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || b.amountCents - a.amountCents); // highest amount first if priority tied

    for (const req of catRequests) {
      if (remainingCents <= 0) {
        rejected.push(req.id);
        continue;
      }

      // Check stacking rules
      if (hasExclusive && !req.stackable) {
        rejected.push(req.id);
        continue;
      }
      if (!req.stackable && applied.length > 0) {
        // If it's non-stackable, it must be exclusive.
        rejected.push(req.id);
        continue;
      }

      const appliedAmount = Math.min(remainingCents, req.amountCents);
      if (appliedAmount > 0) {
        applied.push({
          id: req.id,
          category: req.category,
          appliedCents: appliedAmount,
          description: req.description
        });
        remainingCents -= appliedAmount;
        if (!req.stackable) {
          hasExclusive = true;
        }
      } else {
        rejected.push(req.id);
      }
    }
  }

  const totalDiscountCents = subtotalCents - remainingCents;
  const snapshot = {
    subtotalCents,
    totalDiscountCents,
    applied,
    rejected
  };

  return {
    appliedDiscounts: applied,
    totalDiscountCents,
    snapshot,
    rejectedIds: rejected
  };
}
