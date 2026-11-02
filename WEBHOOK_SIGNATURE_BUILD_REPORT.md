# Live Webhook Signature Verification — Build Report (closes REMAINING_BLOCKERS #1)

The webhook path already resolved the tenant by merchant id and deduped idempotently regardless of signature. This build
makes the **signature check real and processor-aware**, over the **exact raw request bytes**, with **replay protection**.

## Raw-body capture (was already wired — confirmed)
- Bootstrap creates the app with `NestFactory.create(AppModule, { rawBody: true })`, so `req.rawBody` holds the exact bytes
  the processor signed.
- The controller uses `req.rawBody`; `PAYMENTS_WEBHOOK_RAW_BODY=1` makes raw capture **mandatory** (reject `400
  raw_body_required` if absent) so a signature is never silently checked against a re-serialized copy of the parsed JSON.
  The pre-existing `payment-webhook-signature.vitest.spec.ts` proves a signature over the raw bytes does **not** validate
  against the compacted/re-serialized form — which is the whole reason raw capture matters.

## Processor-aware schemes (the part that was missing)
Replaced the single generic HMAC check with a **scheme registry** keyed by processor, each implemented to the processor's
documented scheme, all comparisons **timing-safe**:
- **Stripe** — header `Stripe-Signature: t=<ts>,v1=<sig>,…`; HMAC-SHA256 **hex** over **`"<t>.<rawBody>"`**; accepts any
  `v1` (key rotation); **enforces a replay window** (`|now − t| ≤ PAYMENTS_WEBHOOK_TOLERANCE_SEC`, default 300s →
  `timestamp_out_of_tolerance`).
- **Square** — header `x-square-hmacsha256-signature`; HMAC-SHA256 **base64** over **`notificationUrl + rawBody`**. The
  delivery URL is pinned by `PAYMENTS_WEBHOOK_PUBLIC_BASE` (so it matches what's registered with Square even behind a
  proxy), falling back to the request's own host.
- **Generic HMAC-SHA256 hex** (default — **fiserv / cardpointe / clover**) — `x-webhook-signature` / `x-cardpointe-signature`
  / `x-signature` (optional `sha256=` prefix). This preserves the pre-existing behavior exactly, including the legacy
  single-header fallback, so nothing regresses.

Invalid signatures return **`401 invalid_signature`** with the `scheme` + a non-secret `reason`
(`missing_header` / `malformed_header` / `timestamp_out_of_tolerance` / `signature_mismatch` / `no_secret`), the event is
recorded with `signature_valid=false`, and **no** money state is applied. Selection is `schemeForProcessor(processor)`;
`verifyProcessorSignature(...)` is pure and exported.

## Everything inherits it
Tenant resolution, idempotency, and the refund / settlement / chargeback / **onboarding** ingestion all run **after** this
gate in the same `handle(...)`, so they're all covered by the verified path automatically.

## Tests / verification
- **New** `payment-webhook-processor-signature.vitest.spec.ts` — **10 tests**: scheme mapping; Stripe fresh-accept, key
  rotation, stale-timestamp reject, wrong-sig/malformed/missing; Square base64 accept + URL-mismatch/missing; generic via
  header-map + legacy fallback + missing/mismatch/no_secret.
- **Existing** `payment-webhook-signature.vitest.spec.ts` — **7 tests**, still green (raw-vs-re-serialized property).
- Full backend suite **618 + harness, RESULT: PASS**; admin-web unchanged at **161**; `tsc` clean (api + admin-web);
  production `vite build` succeeds.

## Honest scope note
Stripe and Square are implemented to their **publicly documented** schemes. For **Fiserv/CardPointe**, the exact header name
and signing string should be **confirmed against their sandbox** when access is available — until then the generic
HMAC-SHA256 hex scheme is the safe default, and swapping in the confirmed scheme is a one-branch change in
`verifyProcessorSignature` (no controller/service changes needed). No live-sandbox round-trip has been performed in this
environment; correctness here is proven by the unit suite against each scheme's spec.
