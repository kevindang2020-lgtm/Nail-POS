// stacking-inspector.ts — Extras · Coupons & Promotions 06 "Full Benefit Stacking Inspector". Read-only, pure: for ONE
// deal/coupon under the salon's stacking policy it says, benefit by benefit, whether it combines and WHY — in the same
// terms priceTicket() (pricing.ts) applies them, so the inspector and Checkout cannot disagree:
//   other deal / coupon   policy mode + this offer's stackable flag + its stack group (allowedCombination)
//   member discount       exclusive never; otherwise policy.allowWithMembership (when not, the better one is kept)
//   prepaid member credit always applies — an included service the member already paid for is not a withdrawable discount
//   loyalty reward        exclusive never; otherwise policy.allowWithLoyalty (when not, the better one is kept)
//   gift card             not a discount at all — it is a TENDER that pays whatever is left after discounts (it is not an
//                         OfferCategory in the pricing engine), so it always combines and never changes a discount
//   price floor / cap     the policy's minimum share paid and maximum total discount trim the LAST discounts
import type { StackingPolicy } from './pricing';

export type StackBenefit = 'other_offer' | 'membership_discount' | 'membership_credit' | 'loyalty_reward' | 'gift_card_tender' | 'price_floor' | 'discount_cap';
export type StackAnswer = 'yes' | 'no' | 'conditional' | 'limit' | 'none';
export interface StackRow { benefit: StackBenefit; combines: StackAnswer; reason: string; message: string; value?: number | null }

export function stackingInspector(policy: StackingPolicy, offer: { stackable: boolean; stackGroup: string | null }): { mode: StackingPolicy['mode']; rows: StackRow[] } {
  const rows: StackRow[] = [];
  const exclusive = policy.mode === 'exclusive';
  if (policy.mode === 'best_single' || exclusive) rows.push({ benefit: 'other_offer', combines: 'no', reason: 'policy_one_offer', message: 'The salon allows one deal or coupon per ticket — the one that saves the customer the most is kept.' });
  else if (!offer.stackable) rows.push({ benefit: 'other_offer', combines: 'no', reason: 'offer_not_stackable', message: 'This offer is not marked combinable, so it competes alone against any other deal or coupon; the better result is kept.' });
  else if (policy.mode === 'stack_groups' && offer.stackGroup) rows.push({ benefit: 'other_offer', combines: 'conditional', reason: 'other_stackable_other_group', message: `Combines with other combinable offers, except another offer in the same group ("${offer.stackGroup}").` });
  else rows.push({ benefit: 'other_offer', combines: 'conditional', reason: 'other_stackable', message: 'Combines with other deals or coupons that are also marked combinable.' });

  if (exclusive) rows.push({ benefit: 'membership_discount', combines: 'no', reason: 'policy_exclusive', message: 'Exclusive policy: a deal or coupon never sits on top of a member discount — the better one is kept.' });
  else if (policy.allowWithMembership) rows.push({ benefit: 'membership_discount', combines: 'yes', reason: 'allowed_by_policy', message: 'The salon allows deals and coupons on top of a member discount (member discount is taken first).' });
  else rows.push({ benefit: 'membership_discount', combines: 'no', reason: 'not_allowed_by_policy', message: 'The salon does not allow deals and coupons on top of a member discount — Checkout prices both ways and keeps the better one.' });
  rows.push({ benefit: 'membership_credit', combines: 'yes', reason: 'prepaid_credit', message: 'Prepaid membership credits always apply — the member already paid for that service.' });

  if (exclusive) rows.push({ benefit: 'loyalty_reward', combines: 'no', reason: 'policy_exclusive', message: 'Exclusive policy: a deal or coupon never combines with a loyalty reward — the better one is kept.' });
  else if (policy.allowWithLoyalty) rows.push({ benefit: 'loyalty_reward', combines: 'yes', reason: 'allowed_by_policy', message: 'The salon allows a loyalty reward on the same ticket (the reward is taken last).' });
  else rows.push({ benefit: 'loyalty_reward', combines: 'no', reason: 'not_allowed_by_policy', message: 'The salon does not allow a loyalty reward with a deal or coupon — Checkout keeps the better one.' });

  rows.push({ benefit: 'gift_card_tender', combines: 'yes', reason: 'payment_not_discount', message: 'A gift card is a way to pay, not a discount: it pays what is left after discounts and never changes them.' });

  const floor = Math.max(0, Math.min(100, Number(policy.priceFloorPercent) || 0));
  rows.push(floor > 0
    ? { benefit: 'price_floor', combines: 'limit', reason: 'floor_set', message: `The customer always pays at least ${floor}% of the subtotal; discounts past that are trimmed, last discount first.`, value: floor }
    : { benefit: 'price_floor', combines: 'none', reason: 'floor_unset', message: 'No minimum share is set — discounts can take a line down to zero, never below.', value: null });
  const cap = policy.maxTotalDiscountPercent == null ? null : Math.max(1, Math.min(100, Number(policy.maxTotalDiscountPercent)));
  rows.push(cap != null
    ? { benefit: 'discount_cap', combines: 'limit', reason: 'cap_set', message: `All discounts together may take at most ${cap}% of the subtotal; the excess is trimmed, last discount first.`, value: cap }
    : { benefit: 'discount_cap', combines: 'none', reason: 'cap_unset', message: 'No maximum total discount is set beyond the price floor.', value: null });
  return { mode: policy.mode, rows };
}
