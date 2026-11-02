import type { PaymentAttemptState } from '@aipowersalon/api-contracts/tenant';
export type { PaymentAttemptState };   // owned by packages/api-contracts (Constitution 13 §13)
// payment-attempt-state.ts — the backend-controlled payment-attempt state machine (spec §18). Pure: the allowed states
// and the valid transitions between them, plus the predicates the flow needs. This defines the vocabulary for
// payment_attempts.status and rejects invalid transitions so an attempt can never jump from e.g. 'created' to
// 'confirmed' without a processor-confirmed authorization. The duplicate-payment guard (spec §21/§32) is encoded here as
// blocksNewAttempt(): while an attempt is in flight or its result is unknown, no second card attempt may start for the
// same balance.

export const PAYMENT_ATTEMPT_STATES = [
  'created',
  'readiness_checking',
  'ready',
  'reader_initializing',
  'awaiting_customer_tap',
  'card_detected',
  'authorization_pending',
  'authorized',
  'confirmation_pending',
  'confirmed',
  'declined',
  'canceled',
  'timed_out',
  'failed',
  'unknown',
  'reconciliation_required',
  'voided',
  'partially_refunded',
  'refunded',
] as const;


// Allowed forward transitions. Anything not listed is rejected.
export const TRANSITIONS: Record<PaymentAttemptState, PaymentAttemptState[]> = {
  created: ['readiness_checking', 'canceled'],
  readiness_checking: ['ready', 'failed', 'canceled'],
  ready: ['reader_initializing', 'canceled'],
  reader_initializing: ['awaiting_customer_tap', 'failed', 'canceled'],
  awaiting_customer_tap: ['card_detected', 'canceled', 'timed_out'],
  card_detected: ['authorization_pending', 'canceled'],
  authorization_pending: ['authorized', 'declined', 'timed_out', 'unknown'],
  authorized: ['confirmation_pending', 'unknown'],
  confirmation_pending: ['confirmed', 'unknown', 'failed'],
  confirmed: ['voided', 'partially_refunded', 'refunded'],
  declined: ['ready', 'canceled'],            // retry allowed after a decline
  canceled: [],
  timed_out: ['unknown', 'reconciliation_required', 'canceled'],
  unknown: ['reconciliation_required', 'confirmed', 'declined', 'canceled'],
  reconciliation_required: ['confirmed', 'declined', 'voided', 'canceled'],
  voided: [],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: [],
  failed: ['ready', 'canceled'],              // retry allowed after a failure
};

// In-flight or unresolved: a NEW card attempt for the same balance must NOT start while in one of these.
export const IN_FLIGHT = new Set<PaymentAttemptState>([
  'readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap', 'card_detected',
  'authorization_pending', 'authorized', 'confirmation_pending', 'unknown', 'reconciliation_required',
]);

const TERMINAL = new Set<PaymentAttemptState>(['canceled', 'voided', 'refunded']);

/** Mandate §120: a branch switch waits while an attempt on this phone is in one of these — an unused intent (it still
 *  expires, §132), anything in flight, or a result not yet known (finish, cancel or verify it first). Never a terminal
 *  ('confirmed' / 'canceled' / 'voided' / refunds) or retryable ('declined' / 'failed') state. */
export const BRANCH_SWITCH_BLOCKING_STATES: readonly PaymentAttemptState[] = ['created', ...IN_FLIGHT, 'timed_out'];

export function isValidState(s: string): s is PaymentAttemptState {
  return (PAYMENT_ATTEMPT_STATES as readonly string[]).includes(s);
}

export function canTransition(from: PaymentAttemptState, to: PaymentAttemptState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(readonly from: PaymentAttemptState, readonly to: PaymentAttemptState) {
    super(`Invalid payment-attempt transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: PaymentAttemptState, to: PaymentAttemptState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(s: PaymentAttemptState): boolean { return TERMINAL.has(s); }
export function isSuccess(s: PaymentAttemptState): boolean { return s === 'confirmed'; }
/** True while a result is pending/unknown — the app must not begin another card attempt for the same balance. */
export function blocksNewAttempt(s: PaymentAttemptState): boolean { return IN_FLIGHT.has(s); }
/** Failed-but-retryable states the customer can retry from. */
export function isRetryable(s: PaymentAttemptState): boolean { return s === 'declined' || s === 'failed'; }

// Compile-time assertion, both directions: every runtime state is in the contract's union, and every union member is
// in the runtime list. Either list changing alone fails the build.
type _ContractHasEveryRuntimeState = (typeof PAYMENT_ATTEMPT_STATES)[number] extends PaymentAttemptState ? true : never;
type _RuntimeHasEveryContractState = PaymentAttemptState extends (typeof PAYMENT_ATTEMPT_STATES)[number] ? true : never;
const _assertStates: [_ContractHasEveryRuntimeState, _RuntimeHasEveryContractState] = [true, true];
void _assertStates;
