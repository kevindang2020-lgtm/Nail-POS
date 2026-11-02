// capture-result.ts — pure planning for the §5 server bridge: given a processor OUTCOME from the native Tap-to-Pay
// capture, compute the ordered sequence of attempt-status transitions to apply, validated hop-by-hop against the
// authoritative state machine (payment-attempt-state.ts). This layer moves ONLY the attempt lifecycle status; the money
// itself is recorded by the canonical checkout (payCard/paySplit) keyed on the SAME idempotency key — there is no
// second money path here.

import type { CaptureOutcome } from '@aipowersalon/api-contracts/tenant';
export type { CaptureOutcome };   // owned by packages/api-contracts (Constitution 13 §13)
import { assertTransition, InvalidTransitionError, type PaymentAttemptState } from './payment-attempt-state';

export type ReconcileResolution = 'confirmed' | 'declined' | 'voided';

// The intermediate reader states the native SDK drives before the authorization decision.
const PRE_AUTH: PaymentAttemptState[] = ['reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending'];

function outcomeTail(outcome: CaptureOutcome): PaymentAttemptState[] {
  switch (outcome) {
    case 'approved': return ['authorized', 'confirmation_pending', 'confirmed'];
    case 'declined': return ['declined'];
    case 'timeout': return ['timed_out'];
    case 'unknown': return ['unknown'];
  }
}

/**
 * Plan the transitions from the attempt's current state to the outcome. The bridge usually receives the final result
 * while the attempt is at `ready` (the SDK drove the reader states on-device), but it also accepts an attempt that
 * already reported progress (`authorization_pending`, or `authorized` for a two-step confirm). Every hop is validated
 * against the state machine, so an invalid sequence can never be produced.
 */
export function planCapture(from: PaymentAttemptState, outcome: CaptureOutcome): PaymentAttemptState[] {
  let seq: PaymentAttemptState[];
  if (from === 'ready') seq = [...PRE_AUTH, ...outcomeTail(outcome)];
  // the bridge CLAIMS the attempt by moving it into the first reader state before it asks the processor (one of N
  // concurrent deliveries wins that CAS); the plan then continues from wherever the reader states were left
  else if (PRE_AUTH.includes(from) && from !== 'authorization_pending') seq = [...PRE_AUTH.slice(PRE_AUTH.indexOf(from) + 1), ...outcomeTail(outcome)];
  else if (from === 'authorization_pending') seq = outcomeTail(outcome);
  else if (from === 'authorized' && outcome === 'approved') seq = ['confirmation_pending', 'confirmed'];
  else throw new InvalidTransitionError(from, outcomeTail(outcome)[0]);

  let cur: PaymentAttemptState = from;
  for (const next of seq) { assertTransition(cur, next); cur = next; }
  return seq;
}

/**
 * Plan the reconciliation transitions for an attempt whose result was unresolved (`unknown`/`timed_out`) or already at
 * `reconciliation_required`, to a resolved state. Validated hop-by-hop.
 */
export function planReconciliation(from: PaymentAttemptState, resolution: ReconcileResolution): PaymentAttemptState[] {
  let seq: PaymentAttemptState[];
  if (from === 'unknown' || from === 'timed_out') seq = ['reconciliation_required', resolution];
  else if (from === 'reconciliation_required') seq = [resolution];
  else throw new InvalidTransitionError(from, resolution);

  let cur: PaymentAttemptState = from;
  for (const next of seq) { assertTransition(cur, next); cur = next; }
  return seq;
}

export function finalStateOf(plan: PaymentAttemptState[], from: PaymentAttemptState): PaymentAttemptState {
  return plan.length ? plan[plan.length - 1] : from;
}
