// mobile-remaining-balance.ts — the money math for partial / split-tender on the Manager Tap to Pay flow.
//
// Until now a mobile payment attempt had to equal the WHOLE ticket balance (createAttempt threw on any partial). This
// module generalises that single-attempt guard into remaining-balance tracking so a balance can be settled across more
// than one attempt (spec §19: partial card, cash-plus-card, gift-card-plus-card) and completes only when the remaining
// reaches zero.
//
// IMPORTANT — this is pure domain math, not a processor. An attempt only CONSUMES balance once it reaches 'confirmed',
// and 'confirmed' is reachable only through a real processor finalize (the capture bridge refuses to confirm when Tap
// to Pay is unconfigured). So on an un-wired rail nothing ever confirms, remaining always equals the full balance, and
// live single-payment behaviour is unchanged. The value here is that the moment the processor is wired, sequential
// partials are already correct — and, today, this already TIGHTENS the double-charge guard: an in-flight attempt
// reserves its slice, so a second attempt can never over-reserve the same balance.

import type { BalanceSummary } from '@aipowersalon/api-contracts/tenant';
export type { BalanceSummary };   // owned by packages/api-contracts (Constitution 13 §13)
import { isSuccess, blocksNewAttempt, type PaymentAttemptState } from './payment-attempt-state';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface AttemptForBalance {
  status: string;
  amountCents: number;
}


const cents = (n: number) => Math.max(0, Math.round(Number(n) || 0));

/**
 * Categorise every attempt on a ticket into confirmed (money captured) vs in-flight (reserved) vs released, and derive
 * the remaining balance. Released states — declined, timed_out, failed, canceled, voided, refunded — free their slice.
 */
export function summariseBalance(totalDueCents: number, attempts: readonly AttemptForBalance[], opts: { paidCents?: number } = {}): BalanceSummary {
  const total = cents(totalDueCents);
  // Mandate §85: when the caller supplies what the CANONICAL payments rows already cover (approved + partial — every
  // surface, cash included), that is the confirmed figure; a confirmed attempt IS one of those rows (mobile-capture-
  // recorder links them), so it is not counted again. Without it (pure unit tests), confirmed attempts stand in.
  const paidKnown = opts.paidCents != null && Number.isFinite(Number(opts.paidCents));
  let confirmed = paidKnown ? cents(Number(opts.paidCents)) : 0;
  let inFlight = 0;
  for (const a of attempts) {
    const s = a.status as PaymentAttemptState;
    const amt = cents(a.amountCents);
    if (isSuccess(s)) { if (!paidKnown) confirmed += amt; }
    else if (s === 'created' || blocksNewAttempt(s)) inFlight += amt;
    // any other state (declined / timed_out / failed / canceled / voided / refunded) has released its slice
  }
  const remaining = Math.max(0, total - confirmed - inFlight);
  return { totalDueCents: total, confirmedCents: confirmed, inFlightCents: inFlight, remainingCents: remaining, isFullyPaid: confirmed >= total && total > 0 };
}

export class PartialAmountError extends Error {
  constructor(readonly code: 'already_paid' | 'in_flight' | 'invalid_amount' | 'amount_exceeds_remaining', message: string) {
    super(message);
    this.name = 'PartialAmountError';
  }
}

/**
 * Resolve what a new attempt may charge. Omitting the amount means "the whole remaining balance" (the common one-tap
 * case). A supplied amount must be positive and must not exceed what's left — never trust a client-supplied total.
 */
export function resolveAttemptAmount(requestedCents: number | undefined, summary: BalanceSummary): number {
  // M6-5 (live pilot): nothing left to reserve is "paid" only when the CONFIRMED money covers the bill; when an attempt in
  // flight (or one whose result is being verified) holds the rest, the ticket is NOT paid — saying so would tell the
  // phone the customer paid while the card is still being verified
  if (summary.remainingCents <= 0 && !summary.isFullyPaid && summary.inFlightCents > 0) throw withCode(new PartialAmountError('in_flight', 'A payment for this ticket is in progress or being verified.'), 'PAYMENT_IN_PROGRESS');
  if (summary.remainingCents <= 0) throw withCode(new PartialAmountError('already_paid', 'This ticket is already covered in full.'), 'TICKET_ALREADY_PAID');
  const amt = requestedCents == null || Number.isNaN(requestedCents) ? summary.remainingCents : Math.round(requestedCents);
  if (amt <= 0) throw withCode(new PartialAmountError('invalid_amount', 'Payment amount must be greater than zero.'), 'AMOUNT_MUST_BE_POSITIVE');
  if (amt > summary.remainingCents) throw withCode(new PartialAmountError('amount_exceeds_remaining', `Amount ${amt} exceeds the remaining balance ${summary.remainingCents}.`), 'AMOUNT_EXCEEDS_REMAINING');
  return amt;
}
