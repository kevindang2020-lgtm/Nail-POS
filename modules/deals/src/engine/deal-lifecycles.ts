// deal-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the deal reservation and redemption lifecycles as state machines (ONE
// transition table each). Derived from the ledger's own moves; every status write — the conditional ones and the loop
// writes over rows locked FOR UPDATE — carries canMoveToSql(<machine>, to).
import { defineStateMachine } from '@aipowersalon/database';

/** deal_redemption_holds.status — a reserved place: held → consumed by its appointment → redeemed at payment; released
 *  (cancel / no-show / suspension / reversal give-back) or expired (the clock) while it is still live. A released or
 *  expired place never comes back (the redeem write used to be unconditional: it could flip a released hold to redeemed). */
export const DEAL_REDEMPTION_HOLD = defineStateMachine({
  name: 'deal_redemption_hold', table: 'deal_redemption_holds', column: 'status',
  states: ['held', 'consumed', 'redeemed', 'released', 'expired'],
  transitions: { held: ['consumed', 'redeemed', 'released', 'expired'], consumed: ['redeemed', 'released'], redeemed: ['released'] },
  initial: ['held'],
});

/** deal_redemptions.status — an application of a deal to a ticket: applied → redeemed when the ticket is paid (a zero-value
 *  one is released), applied → released when the ticket lets go of it; a redeemed one is reversed (void / refund, or the
 *  Super Admin reversal) or partially reversed (part of its lines refunded), and a partial one may be reversed further. */
export const DEAL_REDEMPTION = defineStateMachine({
  name: 'deal_redemption', table: 'deal_redemptions', column: 'status',
  states: ['applied', 'redeemed', 'released', 'reversed', 'partially_reversed'],
  transitions: { applied: ['redeemed', 'released'], redeemed: ['reversed', 'partially_reversed'], partially_reversed: ['reversed', 'partially_reversed'] },
  initial: ['applied'],
});

/** The LIVE uses of a deal (round 11, Deals live-use count): on the ticket, paid, or paid and only PARTLY reversed (the
 *  customer kept part of the service — its place and its count stay). Released and fully reversed uses are not live.
 *  One live use per deal + ticket (migration 965 uq_deal_redemption_ticket_live; deals-ledger apply). */
export const LIVE_USE_STATUSES = ['applied', 'redeemed', 'partially_reversed'] as const;

/** deals.status — the lifecycle deals.core's TRANSITIONS has always validated (submit / approve / reject / publish /
 *  schedule / pause / resume / sold out / expire / cancel / archive), plus the two other writers: a salon coupon promotion
 *  (kind = 'coupon') is an owner's flag among draft / active / paused / expired, and the platform's suspension cancels a
 *  deal in any live or finished state. ARCHIVED is terminal (un-archiving a coupon used to be possible — refused now). */
export const DEAL = defineStateMachine({
  name: 'deal', table: 'deals', column: 'status',
  states: ['draft', 'pending_approval', 'approved', 'scheduled', 'active', 'paused', 'sold_out', 'expired', 'rejected', 'canceled', 'archived'],
  transitions: {
    // approved / rejected straight from draft: Super Admin → Promotions decides a promotion that was never submitted
    // (today's behaviour, kept — BUILD_PLAN Phase 12 round 2 integration)
    draft: ['draft', 'pending_approval', 'approved', 'rejected', 'active', 'paused', 'expired', 'canceled', 'archived'],
    pending_approval: ['approved', 'rejected', 'draft', 'canceled'],
    approved: ['active', 'scheduled', 'expired', 'canceled'],
    scheduled: ['active', 'expired', 'canceled'],
    active: ['active', 'draft', 'paused', 'sold_out', 'expired', 'canceled', 'archived'],
    paused: ['paused', 'draft', 'active', 'scheduled', 'expired', 'canceled', 'archived'],
    expired: ['expired', 'draft', 'active', 'paused', 'canceled', 'archived'],
    rejected: ['canceled', 'archived'],
    sold_out: ['canceled', 'archived'],
    canceled: ['canceled', 'archived'],
  },
  initial: ['draft', 'pending_approval', 'active'],
});

/** deal_coupon_codes.status — a code is used up (exhausted) and given back by a reversal (active again); REVOKED is final. */
export const DEAL_COUPON_CODE = defineStateMachine({
  name: 'deal_coupon_code', table: 'deal_coupon_codes', column: 'status',
  states: ['active', 'exhausted', 'revoked'],
  transitions: { active: ['active', 'exhausted', 'revoked'], exhausted: ['active', 'exhausted', 'revoked'] },
  initial: ['active'],
});

/** bundles.status — an owner's flag: active / inactive / archived, and restorable (un-archive clears archived_at). */
export const BUNDLE = defineStateMachine({
  name: 'bundle', table: 'bundles', column: 'status',
  states: ['active', 'inactive', 'archived'],
  transitions: { active: ['active', 'inactive', 'archived'], inactive: ['active', 'inactive', 'archived'], archived: ['active', 'inactive', 'archived'] },
  initial: ['active', 'inactive'],
});
