# Payment Gateway — restricted to Fiserv + Clover only

You only use **Fiserv** (CardConnect / CardPointe gateway + the CardPointe-Bolt terminal) and **Clover**, so Stripe and
Square have been removed from the payment gateway entirely — adapters, wiring, credential rules, webhook schemes, and the
admin UI. Audited first, so nothing is left dangling.

## What was removed
**Charging adapters** — deleted `stripe.client.ts`, `square.client.ts` and their tests.

**Resolver** (`payment-gateway.resolver.ts`) — removed the Stripe/Square imports, dropped them from the `processorType`
union (now `'fiserv' | 'cardpointe' | 'clover' | 'none'`), and removed their two branches from `resolve()`. The switch is
now: `clover` → Clover adapter; everything else → Fiserv/CardConnect (CardPointe). No tenant can build a Stripe/Square
processor.

**Credential rules** (`payment-gateways-core.ts`) — `requiredGatewayCredentials` now knows only Fiserv/CardPointe
(merchant id + username + password + base URL) and Clover (single bearer token). Stripe/Square removed.

**Webhook signature** (`payment-webhook.service.ts` + controller) — Fiserv and Clover both sign with a generic
HMAC-SHA256 (hex) over the raw body, so the Stripe (timestamp/replay) and Square (url+body/base64) schemes were dead code
and were removed, along with their now-unused inputs (`notificationUrl`, `nowMs`, `toleranceSec`) and the controller's
`PAYMENTS_WEBHOOK_PUBLIC_BASE` URL plumbing. The generic verification path — the one Fiserv/Clover actually use — is
unchanged, including the legacy single-header fallback. `SigScheme` is now just `'hmac_sha256_hex'`.

**Admin UI** (`admin-web`) — the Configure Gateway provider dropdown and the command-center processor filter now list only
Fiserv / CardPointe / Clover (+ none). The Stripe-specific field logic is gone; the API-username field now shows only for
Fiserv/CardPointe (Clover needs only its token), and the secret field is labeled "API token" for Clover vs "API password"
for Fiserv.

**Env/docs** — removed the two webhook envs that existed only for Stripe/Square (`PAYMENTS_WEBHOOK_TOLERANCE_SEC`,
`PAYMENTS_WEBHOOK_PUBLIC_BASE`) from `.env.production.example` and `DEPLOY_RUNBOOK.md`. `PAYMENTS_WEBHOOK_RAW_BODY=1`
(needed by Fiserv/Clover) stays.

## What was intentionally NOT touched
The AI **subscription-billing** webhook (`ai/ai-subscription-billing.service.ts`, `ai-billing-webhook-verify.ts`) uses
"stripe-style" only as a configurable signature-scheme name for that separate billing system — it is not a POS payment
processor and is unrelated to your payment gateway, so it was left as-is.

## Verification
- Backend: **619 tests + harness, RESULT: PASS** (the 18 fewer vs. before are exactly the deleted Stripe/Square adapter +
  scheme tests). `apps/api` `tsc` clean.
- admin-web: **31 files / 168 tests pass**, `tsc` clean, production build green.
- Final sweep: **zero** Stripe/Square references remain anywhere in the payment-gateway code (payments, super-admin gateway
  surfaces, checkout, admin-web).

Your payment gateway now offers and processes only Fiserv and Clover.
