# Runbook — REFUND_STATUS_UNKNOWN (a card refund whose outcome did not come back)

Mandate P0 §228 / §223 (Oct 20 2026). Sibling of [payment-status-unknown.md](payment-status-unknown.md).

**What it is**: `processor.refund()` threw (timeout, network, 5xx) or answered *retry* (CardPointe `respstat 'B'`, or any
answer that is not an approval and not an explicit decline) AFTER the refund was reserved. The `payment_refunds` row
stays — status `processing`, the amount still held against the payment's refundable balance. The POS refund panel shows
the tender as **being verified with the card processor — not refunded again, not released**. Any further refund on that
payment answers `REFUND_PENDING_VERIFICATION` (409) until this one is settled.

**Why**: until Oct 20 2026 the reservation was deleted on a throw and the route's idempotency key dropped on failure, so a
retry reached the processor a second time — a refund the processor had already made was made again. Only an explicit
decline (`respstat 'C'` / `declined: true`) proves money did not move; everything else is unknown.

**Resolution paths (all read the processor's own record — never a guess)**
1. **Automatic**: the stranded-attempt sweep (`PaymentAttemptSweepScheduler`, every 5 min, stranded after 15 min, one
   owner across workers) asks the processor for the ORIGINAL order (`inquireByOrderId(ticketId)`) and decides with
   `decideRefundAttempt` (pure, `payment-attempt-sweep.ts`):
   * one approved transaction, not the original charge, of exactly the refund amount, not already recorded here → the
     refund DID happen → `settleUnknownRefund` records the refund payment row with that retref, finalizes the reservation,
     and runs the same side effects as a live refund (commission / loyalty / deals reversal on the lines asked);
   * the original charge and no such transaction, past the stranded window → the refund never happened → the hold is
     released; the cashier may refund again;
   * two candidates, an answer that does not show the original charge, no inquiry support, not connected, or unreachable
     for 4 × the window → **needs a person**: `review_reason` is set once and ONE alert raised (owner + Super Admin).
2. **Manager** (when it needs a person): POS → Payments → Transactions → the ticket → Refund → *Refunds being verified* →
   write what the processor portal shows (required note, processor refund reference if any) → **Processor shows it
   refunded** / **Processor shows no refund**. Step-up (password) and `pos.checkout.refund`. Route:
   `POST /pos/checkout/tickets/:ticketId/refunds/:refundId/settle` (idempotent; conditional on the row still being
   `processing`, so two managers cannot settle it twice).
3. **Support**: Super Admin → tenant → Payment Gateways → alerts; `payment_refunds` row (`last_error`, `review_reason`,
   `settled_by`); the processor portal by order id = ticket id.

**Do not**: send the refund again from the processor portal before checking `payment_refunds`; delete the `processing`
row by hand (it is what stops a second refund); treat a 'B' / blank answer as a decline.

**Inquiry shape caveat (to confirm on the UAT sandbox)**: the decision assumes `inquireByOrderid` lists a refund under the
original order id as an approved transaction with its own retref and the refund amount. If the sandbox shows refunds are
NOT listed that way, the sweep can never decide "refunded" by itself — it will route every lost answer to review (safe),
and `cardpointe.client.ts` `inquireByOrderId` mapping needs the real field names.

**Proof**: `modules/checkout/src/checkout/checkout-refund-unknown.vitest.spec.ts` (18) and the real-Postgres race lane
`refund-race.postgres-race.vitest.spec.ts` (7: ten retries after a timeout reach the processor zero more times; ten
concurrent sweepers settle one refund exactly once; the undecidable one is alerted once).
