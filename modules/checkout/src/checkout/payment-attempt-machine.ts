// payment-attempt-machine.ts — BUILD_PLAN Phase 12 (#27): payment_attempts.status as ONE state machine for both flows that
// share the table:
//   * the mobile Tap-to-Pay attempt (mobile-checkout/payment-attempt-state.ts TRANSITIONS — its own pure table, kept),
//     plus the one move its readiness step writes directly (created → ready | failed: the intermediate
//     readiness_checking is never persisted);
//   * the POS card / split reservation: inserted 'processing', then settled by the live path or resolved by the stranded
//     sweep (settled | failed | needs_review). A needs_review row the live path later settles is the processor's answer.
// Fixed here: the live path's "settled" write was unconditional — it could turn a failed / refunded attempt back into
// settled. It now moves only processing | needs_review → settled.
import { defineStateMachine } from '@aipowersalon/database';
import { TRANSITIONS as MOBILE } from '../mobile-checkout/payment-attempt-state';

const merged: Record<string, string[]> = Object.fromEntries(Object.entries(MOBILE).map(([k, v]) => [k, [...v]]));
merged.created = [...new Set([...(merged.created ?? []), 'ready', 'failed'])];
merged.processing = ['settled', 'failed', 'needs_review'];
merged.needs_review = ['settled', 'failed'];

export const PAYMENT_ATTEMPT = defineStateMachine({
  name: 'payment_attempt', table: 'payment_attempts', column: 'status',
  states: ['created', 'readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending', 'authorized',
    'confirmation_pending', 'confirmed', 'declined', 'canceled', 'timed_out', 'failed', 'unknown', 'reconciliation_required', 'voided', 'partially_refunded', 'refunded',
    'processing', 'settled', 'needs_review'],
  transitions: merged as any,
  initial: ['created', 'processing'],
});
