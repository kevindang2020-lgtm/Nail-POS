// loyalty-redemption-machine.ts — loyalty_redemptions.status as ONE state machine (BUILD_PLAN Phase 12 #27). It lives with
// the loyalty ledger (this module) so both writers use it: checkout (apply / release / settle — @aipowersalon/checkout
// re-exports it) and the POS Loyalty & Rewards screen (void an unused code — Loyalty & Rewards mandate, Oct 29 2026).
import { defineStateMachine } from '@aipowersalon/database';

/** A reward code: issued → applied to ONE ticket (re-applying to the same ticket is a no-op move) → used at settlement, or
 *  released back to issued when the ticket lets go of it. An ISSUED code that never reached a ticket may be voided by an
 *  owner / manager (its points come back through the ledger); applied / used codes belong to a ticket and are never
 *  voided here; void is final. */
export const LOYALTY_REDEMPTION = defineStateMachine({
  name: 'loyalty_redemption', table: 'loyalty_redemptions', column: 'status',
  states: ['issued', 'applied', 'used', 'void'],
  transitions: { issued: ['applied', 'void'], applied: ['applied', 'issued', 'used'] },
  initial: ['issued'],
});
