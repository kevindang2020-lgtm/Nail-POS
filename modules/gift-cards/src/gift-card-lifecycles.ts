// gift-card-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the gift card and the physical card stock as state machines (ONE
// each; checkout and the API's gift-card routes import them from @aipowersalon/gift-cards).
import { defineStateMachine } from '@aipowersalon/database';

const SPENDABLE_MOVES = ['active', 'partially_redeemed', 'redeemed', 'frozen', 'suspended', 'expired', 'lost_stolen', 'replaced', 'refunded', 'void'] as const;
/** gift_cards.status — a sale is pending until its ticket is paid, then the card is live (active / partially redeemed /
 *  redeemed; a reload makes it active again); staff freeze / suspend / report it lost; it ends REPLACED (its value moved to
 *  a new card), REFUNDED, CANCELED or VOID — and an ended card is never revived (a reload or a pending-reload credit used
 *  to flip a void or replaced card back to active with a balance). */
export const GIFT_CARD = defineStateMachine({
  name: 'gift_card', table: 'gift_cards', column: 'status',
  states: ['draft', 'pending_payment', 'pending_review', 'scheduled', 'delivered', 'claimed', 'active', 'partially_redeemed', 'redeemed', 'frozen', 'suspended', 'expired', 'lost_stolen', 'replaced', 'refunded', 'canceled', 'void'],
  transitions: {
    draft: ['draft', 'pending_payment', 'pending_review', 'scheduled', 'active', 'canceled', 'void'],
    pending_payment: ['active', 'pending_review', 'scheduled', 'canceled', 'void'],
    pending_review: ['active', 'scheduled', 'canceled', 'void'],
    scheduled: ['scheduled', 'delivered', 'active', 'canceled', 'void'],
    delivered: ['delivered', 'claimed', ...SPENDABLE_MOVES],
    claimed: ['claimed', ...SPENDABLE_MOVES],
    active: [...SPENDABLE_MOVES],
    partially_redeemed: [...SPENDABLE_MOVES],
    redeemed: [...SPENDABLE_MOVES],
    frozen: ['active', 'frozen', 'suspended', 'lost_stolen', 'replaced', 'refunded', 'void'],
    suspended: ['active', 'frozen', 'suspended', 'lost_stolen', 'replaced', 'refunded', 'void'],
    expired: ['active', 'expired', 'refunded', 'void'],
    lost_stolen: ['lost_stolen', 'replaced', 'refunded', 'void'],
  },
  initial: ['draft', 'pending_payment', 'pending_review', 'scheduled', 'active'],
});

/** gift_card_stock.status — a pre-printed card is sold ONCE (available → activated) or voided while unsold. */
export const GIFT_CARD_STOCK = defineStateMachine({
  name: 'gift_card_stock', table: 'gift_card_stock', column: 'status',
  states: ['available', 'activated', 'void'],
  transitions: { available: ['activated', 'void'] },
  initial: ['available'],
});
