# AI Phase 4d (backend) — billing-event → subscription-status sync

Closes the payment loop: a normalized billing event flips `tenant_ai_subscriptions.status`, and because the access gate
already reads that status, access opens/closes automatically — no UI changes needed. Built and tested here are the pure
status state machine, idempotent persistence, the audited service, and a secret-guarded ingress. The provider-specific
webhook adapter (signature verification + raw→normalized mapping) is the one environment-bound piece you add; this gives
it a safe, tested target to call.

## Files
- `apps/api/db/migrations/092_ai_billing_events.sql` (new) — append-only idempotency ledger (UNIQUE event_id) + audit trail
- `apps/api/src/ai/ai-subscription-billing-core.ts` (new) — pure state machine (8 statuses × event types, guarded)
- `apps/api/src/ai/ai-subscription-billing.repository.ts` (new) — idempotent record-and-transition (port + InMemory + Kysely)
- `apps/api/src/ai/ai-subscription-billing.service.ts` (new) — service + audit + secret-guarded controller + module
- `apps/api/src/ai/ai-subscription-billing.vitest.spec.ts` (new) — 9 tests
- `apps/api/src/app.module.ts` — registered

## The state machine (`applyAiBillingEvent(current, eventType)`)
Maps an event to the next status, guarded so an event that doesn't apply is a safe no-op rather than an illegal flip:
- `payment_succeeded` / `trial_converted` / `payment_recovered` → **active** (refresh period, `last_payment_status=succeeded`)
- `payment_failed` → **past_due** (from active/trialing/past_due)
- `refunded` / `chargeback` → **unpaid** (blocks access)
- `subscription_cancelled` → **cancelled** (stamp cancelled_at); `subscription_expired`/`trial_expired` → **expired**
- `paused` → **suspended**; `resumed`/`enabled` → **active**; `disabled` → **disabled**
- a failed/refund event on a cancelled/expired sub does **not** resurrect it; unknown event → `ok:false`.

This is what keeps "access follows payment" honest: only a successful charge returns a subscription to an access-granting
status, and a failure/refund/cancellation moves it out — which the gate (P1/P2) immediately enforces on the next
`/ai/:packageCode` call and in the owner/POS panels on next load.

## Idempotency
`ai_billing_events` claims the `event_id` first (`ON CONFLICT DO NOTHING`); 0 rows ⇒ already processed ⇒ duplicate no-op.
Only a newly-claimed event reads the current status, applies the transition, and updates the subscription (status, period,
cancelled_at, payment refs, last_payment_status). The ledger records `from_status → to_status` for every event.

## Ingress (the boundary)
`POST internal/ai-billing/event` accepts a **normalized** event and is guarded by header `x-ai-billing-secret` ==
`AI_BILLING_WEBHOOK_SECRET` (403 unless the env secret is set AND matches — disabled by default, never anonymous). Your
provider webhook (Fiserv/Stripe/etc.) verifies its signature, maps the raw payload to
`{ eventId, tenantId, packageCode, eventType, provider?, paymentSubscriptionId?, paymentCustomerId?, paymentStatus? }`,
and POSTs it here. Successful, applied events write an `ai_subscription_billing_event` audit row.

## Verification
API: `tsc` clean; **547 tests** (+9: activation from past_due/unpaid/trialing; failed → past_due; refund/chargeback →
unpaid; cancellation + trial-expiry guards; cancelled sub not resurrected; unknown event rejected; idempotent apply +
duplicate no-op; no-subscription no-op; service invalid-event guard); `RESULT: PASS`. Kysely path typecheck-verified
(sandbox runs the in-memory adapter).

## Honest limits (need your environment — NOT verifiable here)
- **No real webhook was delivered.** The normalized-event handling, idempotency, and transitions are unit-tested, but you
  must add the thin provider adapter (signature verification + raw→normalized mapping) and validate one real event end to
  end with `AI_BILLING_WEBHOOK_SECRET` set.
- **Initiating a paid charge** from the owner "subscribe (paid)" button still needs the payment provider — that half is
  provider-bound. The status-sync half (once a charge succeeds → `payment_succeeded` → active) is done, so paid access
  opens automatically when the event arrives. Owner self-serve remains trial-only until the charge-initiation flow is wired.

## Platform status
Built + verified here, end to end: gate (P1) → real-data gate (P2) → provider adapters + prompts (P3 scaffold) →
Super-Admin API + screen (P4a/b) → tenant API + owner screen (P4c) → POS panel + fan-out (P5) → **billing-status sync
(P4d backend)**. What's left is inherently environment-bound: the provider webhook adapter + a real event, the
charge-initiation flow for paid activation, validating real provider calls, and purpose-built surfaces for the 7
assistants with no POS home.
