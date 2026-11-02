# Tailored to your stack — OpenAI assistants + Fiserv CardPointe self-reconcile billing

Built to your two answers: assistants default to **OpenAI**, and AI-subscription billing runs off **CardPointe charges you
reconcile yourself** (no external signed webhook). Both halves are wired and tested.

## 1) OpenAI as the default provider
The Phase-3 adapter already targets OpenAI's `chat/completions`. To go live, set:
```
OPENAI_API_KEY=sk-...
AI_DEFAULT_PROVIDER=openai        # optional — inferred from the key, but explicit is clearer
AI_DEFAULT_MODEL=gpt-4o-mini      # default if unset
AI_MAX_TOKENS=800                 # gateway default; marketing + review assistants use 1000
AI_TIMEOUT_MS=20000
```
With the key set, all 15 assistants call OpenAI through the same gate/usage/cost path (the Mock runs until then). The
pricing table already has `gpt-4o-mini` ($0.15 / $0.60 per 1M) so COGS is correct out of the box — edit `AI_MODEL_PRICES`
if you switch to `gpt-4o`. **Validate:** with the key set, `POST /ai/ai_booking_assistant` as a subscribed tenant returns a
real OpenAI completion and writes a costed `ai_usage_logs` row.

## 2) CardPointe self-reconcile billing (no webhook)
Because you charge via CardPointe and reconcile yourself, the signed `/webhook` route + HMAC verifier are **not used** in
this model (they remain for a future webhook-sending provider). Instead, after each CardPointe **charge or refund**, hand
the response to the bridge:

**One HTTP call** (from your reconcile job):
```
POST internal/ai-billing/cardpointe
Header: x-ai-billing-secret: $AI_BILLING_WEBHOOK_SECRET
Body:   { "tenantId": "...", "packageCode": "ai_booking_assistant", "kind": "charge",   // or "refund"
          "charge": { ...the CardPointe auth/capture/refund response... } }
```
…or call `AiSubscriptionBillingService.applyCardpointeCharge(charge, { tenantId, packageCode, kind })` in-process.

**Mapping** (`cardpointeChargeToBillingEvent`): CardPointe `respstat` →
- `A` (approved) on a charge → `payment_succeeded` → subscription **active** (refreshes the period)
- `A` on a refund → `refunded` → **unpaid** (access closes)
- `C` (declined) → `payment_failed` → **past_due**
- `B` (retry / soft decline) → held (`retry_pending`, no change) — submit again when CardPointe retries

**Idempotent** on `cardpointe:<kind>:<retref>`, so re-running reconciliation never double-applies. Each applied change
flips `tenant_ai_subscriptions.status`, which the access gate immediately enforces and the owner/POS panels reflect — so a
successful charge opens access and a decline/refund closes it, automatically. Every applied change writes an audit row.

This means **paid activation works now** in your model: when your CardPointe charge for a package succeeds, post it here
and the subscription goes active. (Owner self-serve in the app remains trial-only; paid activation is this charge path.)

## Files (new/changed)
- `apps/api/src/ai/ai-cardpointe-billing.ts` (new) — `cardpointeChargeToBillingEvent` (pure)
- `apps/api/src/ai/ai-subscription-billing.service.ts` — `applyCardpointeCharge` + `POST internal/ai-billing/cardpointe`
- `apps/api/src/ai/ai-cardpointe-billing.vitest.spec.ts` (new) — 8 tests (CardPointe mapping incl. approve/decline/retry/
  refund + missing-field guards; service activates a past_due sub + retref idempotency; OpenAI default model resolution)
- OpenAI default model already lives in the Phase-3 resolver (`gpt-4o-mini`)

## Verification
API: `tsc` clean; **572 tests** (+8); `RESULT: PASS`. admin-web 98, owner-web 23, pos-web 67 — all clean.

## What still needs you (and only you)
- A real OpenAI call (drop the key, hit one endpoint) — I can't exercise the live API here.
- A real CardPointe charge through the bridge (set `AI_BILLING_WEBHOOK_SECRET`, post one captured transaction) to confirm
  end to end against your actual CardPointe response shape — adjust the read fields if your integration returns them under
  different keys than `retref` / `respstat`.
