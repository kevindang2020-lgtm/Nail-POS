# AI Phase 4d (cont.) — provider webhook adapter: signature verification + raw→normalized mapping

The verifiable half of the provider webhook adapter that feeds the billing-status sync. Signature verification and event
mapping are pure, so they're fully tested here; the only environment-bound bits (your provider's exact field names +
signature scheme + raw-body capture) are configurable and documented.

## Files
- `apps/api/src/ai/ai-billing-webhook-verify.ts` (new) — `verifyWebhookSignature` (HMAC-SHA256, constant-time, replay
  protection) + `mapRawBillingEvent` (raw → NormalizedBillingEvent) + an editable Stripe-shaped default mapping
- `apps/api/src/ai/ai-subscription-billing.service.ts` — `ingestRawWebhook(rawBody, signatureHeader)` (verify → map →
  apply) + a raw-body `POST internal/ai-billing/webhook` route
- `apps/api/src/ai/ai-billing-webhook-verify.vitest.spec.ts` (new) — 9 tests

## Signature verification
`verifyWebhookSignature({ payload, header, secret, scheme, toleranceSec, now })`:
- **stripe scheme** (default): header `t=<unix>,v1=<hex>` — recomputes `HMAC_SHA256(secret, "<t>.<rawBody>")`, compares
  with `timingSafeEqual`, and rejects if `|now − t|` exceeds tolerance (default 300s) → replay protection. Supports
  multiple `v1=` values (key rotation).
- **hmac-hex scheme**: plain `HMAC_SHA256(secret, rawBody)` hex compare, for providers that sign that way.
- Distinct reasons (`no_secret`, `no_signature`, `malformed_header`, `timestamp_out_of_tolerance`, `signature_mismatch`)
  so failures are diagnosable. Verification is over the **raw bytes** — never a re-serialized body.

## Raw → normalized mapping
`mapRawBillingEvent(raw, mapping)` extracts the event id, translates the provider event type via a `typeMap`, and pulls
tenant/package/payment refs by dotted path. `DEFAULT_BILLING_MAPPING` is a Stripe-shaped starting point (e.g.
`invoice.payment_succeeded → payment_succeeded`, `customer.subscription.deleted → subscription_cancelled`,
`charge.dispute.created → chargeback`, tenant/package from `data.object.metadata.*`). **Edit the paths + typeMap to match
your provider** — the field names are the only provider-specific thing. Unmapped types and missing tenant/package are
rejected with a reason (so you can 200-ack-and-ignore unrelated events).

## Route
`POST internal/ai-billing/webhook` reads the raw body from `req.rawBody`, verifies the signature (secret =
`AI_BILLING_WEBHOOK_SECRET`, scheme = `AI_BILLING_WEBHOOK_SCHEME`, default `stripe`; header `x-signature` /
`stripe-signature`), maps, and applies — reusing the same idempotent, gate-coupled status sync from the previous step.
The earlier secret-header `POST .../event` (pre-normalized) remains for callers that normalize upstream.

## Verification
API: `tsc` clean; **556 tests** (+9: correct signature accepted; tampered payload / wrong secret / replay / malformed /
missing-secret rejected; hmac-hex verified; mapper maps a recognized event and rejects unmapped/missing-fields; full
**signed-webhook → map → status flip** end-to-end with a real HMAC, and a bad signature rejected before any state change);
`RESULT: PASS`.

## Honest limits (need your environment — NOT verifiable here)
- **No real provider webhook was delivered.** The crypto and mapping are deterministic and fully tested, but you must (a)
  set `AI_BILLING_WEBHOOK_SECRET` (+ `AI_BILLING_WEBHOOK_SCHEME` if not stripe-style), (b) adjust `DEFAULT_BILLING_MAPPING`
  paths/typeMap to your provider's payload, (c) enable raw-body capture (`req.rawBody`) for the `/webhook` path, and (d)
  validate one real event end to end.
- Still outstanding and provider-bound: **initiating** a paid charge from the owner "subscribe (paid)" button (the inbound
  status-sync is done; the outbound charge needs the provider).

## Platform status
The AI platform is now complete to the edge of what's verifiable without your environment. Backend **556** tests,
admin-web **97**, owner-web **23**, pos-web **67** — all `tsc`/build clean. Full chain real: enforcement gate →
real-data gate → provider adapters + prompts → Super-Admin API/UI → tenant API + owner UI → POS panel + fan-out →
billing-status sync → webhook signature/mapping. What remains is inherently yours: provider keys + a real LLM call, the
webhook secret + mapping + a real billing event, the charge-initiation flow, and purpose-built surfaces for the 7
assistants with no POS home.
