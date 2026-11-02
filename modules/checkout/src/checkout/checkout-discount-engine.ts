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

