// stackingExplorer.ts — Deals & Offers extras (Deals 10): a read-only "which offers combine" explorer for staff.
//
// It restates, for the salon's CURRENT settings, the rules the one pricing engine applies at Checkout
// (modules/deals/src/engine/pricing.ts priceTicket / allowedCombination / rejectionFor):
//   • best_single / exclusive — at most one deal or coupon per ticket; the better one for the customer wins;
//   • stack_all    — deals/coupons marked combinable add up; a non-combinable one competes alone;
//   • stack_groups — like stack_all, but never two offers from the same stack group;
//   • a deal/coupon sits on a member discount only when allowStackMembership (never under exclusive), and on a loyalty
//     reward only when allowStackLoyalty (never under exclusive) — otherwise the engine prices both ways and keeps the
//     better one;
//   • a member discount and a loyalty reward without a deal always combine; a prepaid membership credit always applies.
// Promotion codes are priced through the same engine as coupons (CheckoutService.applyPromotion), so they follow the
// coupon rule. Nothing here prices a ticket, records a use or changes a setting.

export type StackVerdict = 'allowed' | 'conditional' | 'blocked';
export type StackPair = 'deal_deal' | 'deal_coupon' | 'promo_code' | 'non_combinable' | 'with_membership' | 'with_loyalty' | 'membership_loyalty' | 'prepaid_credit';
export interface StackRow { pair: StackPair; verdict: StackVerdict; reason: string }

/** The settings fields the explorer reads (a subset of the deals settings response). */
export interface StackingInputs {
  stackingPolicy?: string | null;
  allowStackMembership?: boolean | null;
  allowStackLoyalty?: boolean | null;
  priceFloorPercent?: number | null;
  maxTotalDiscountPercent?: number | null;
}

const MODES = ['best_single', 'stack_all', 'stack_groups', 'exclusive'] as const;
type Mode = (typeof MODES)[number];

export function stackingMode(s: StackingInputs): Mode {
  const m = s.stackingPolicy ?? 'best_single';
  return (MODES as readonly string[]).includes(m) ? (m as Mode) : 'best_single';
}

/** Rows in a fixed order; `reason` is an i18n key suffix under 'do.stack.reason.'. */
export function stackingMatrix(s: StackingInputs): StackRow[] {
  const mode = stackingMode(s);
  const single = mode === 'best_single' || mode === 'exclusive';
  const promoPair = (): Omit<StackRow, 'pair'> => single
    ? { verdict: 'blocked', reason: 'one_offer' }
    : mode === 'stack_groups'
      ? { verdict: 'conditional', reason: 'both_combinable_other_group' }
      : { verdict: 'conditional', reason: 'both_combinable' };
  const membershipOk = mode !== 'exclusive' && !!s.allowStackMembership;
  // the engine default for loyalty is "allowed" when the setting was never saved (allowStackLoyalty !== false)
  const loyaltyOk = mode !== 'exclusive' && s.allowStackLoyalty !== false;
  return [
    { pair: 'deal_deal', ...promoPair() },
    { pair: 'deal_coupon', ...promoPair() },
    { pair: 'promo_code', ...promoPair() },
    { pair: 'non_combinable', verdict: 'blocked', reason: single ? 'one_offer' : 'competes_alone' },
    { pair: 'with_membership', verdict: membershipOk ? 'allowed' : 'blocked', reason: mode === 'exclusive' ? 'exclusive' : membershipOk ? 'setting_on' : 'better_of_two' },
    { pair: 'with_loyalty', verdict: loyaltyOk ? 'allowed' : 'blocked', reason: mode === 'exclusive' ? 'exclusive' : loyaltyOk ? 'setting_on' : 'better_of_two' },
    { pair: 'membership_loyalty', verdict: 'allowed', reason: 'no_deal' },
    { pair: 'prepaid_credit', verdict: 'allowed', reason: 'prepaid' },
  ];
}

/** The trims applied after combining, when the salon set them (null = none). */
export function stackingLimits(s: StackingInputs): { floorPercent: number | null; maxPercent: number | null } {
  const floor = Number(s.priceFloorPercent ?? 0);
  const max = s.maxTotalDiscountPercent == null ? null : Number(s.maxTotalDiscountPercent);
  return { floorPercent: floor > 0 ? Math.min(100, floor) : null, maxPercent: max != null && max > 0 && max < 100 ? max : null };
}
