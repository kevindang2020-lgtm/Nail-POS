# AI Platform — Go-Live Runbook

One actionable sequence to turn on everything built this session. All values below are pulled from the code, not memory.
Until you set the OpenAI key, the platform runs on the deterministic Mock (safe). **Corrected Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep):** that is true only outside production — in production the model router never selects the Mock (`modules/ai/src/ai/ai-model-router.ts`, §268), so AI features answer "not configured" until a provider key is set. The migration list below is the July set; today's schema is every file in `apps/api/db/migrations`. Until you wire CardPointe reconcile,
subscriptions only enter trials; paid activation begins the moment you post your first successful charge.

---

## Step 1 — Run the migrations (in order)
```
090_tenant_ai_subscriptions.sql   # per-(tenant,package) subscriptions, 8-status lifecycle
091_ai_usage_logs.sql             # append-only usage ledger (tokens, status)
092_ai_billing_events.sql         # billing-event idempotency ledger + audit trail
093_ai_usage_cost.sql             # cost_micro_usd column (precise per-call COGS)
```
(061_tenant_ai_features predates this work and is already applied.)

## Step 2 — Set environment variables

**LLM provider (you chose OpenAI):**
```
OPENAI_API_KEY=sk-...           # REQUIRED to leave the Mock
AI_DEFAULT_PROVIDER=openai      # optional (inferred from the key)
AI_DEFAULT_MODEL=gpt-4o-mini    # optional (this is the default)
AI_MAX_TOKENS=800               # optional gateway default (marketing/review use 1000)
AI_TIMEOUT_MS=20000             # optional
```

**Billing (CardPointe self-reconcile):**
```
AI_BILLING_WEBHOOK_SECRET=<long-random>   # REQUIRED — guards every internal/ai-billing/* route
# AI_BILLING_WEBHOOK_SCHEME is only for the signed /webhook route, which you do NOT use in the reconcile model
```

**Optional scheduler (keeps stored trial status honest):**
```
AI_TRIAL_SWEEP_CRON_ENABLED=true   # hourly in-process sweep of lapsed trials → 'expired' (off by default)
```

## Step 3 — Wire CardPointe reconcile → status
After each CardPointe **charge or refund**, post the response to the bridge (idempotent on the transaction retref):
```
POST internal/ai-billing/cardpointe
Header: x-ai-billing-secret: $AI_BILLING_WEBHOOK_SECRET
Body:   { "tenantId": "...", "packageCode": "ai_booking_assistant", "kind": "charge",   // or "refund"
          "charge": { ...CardPointe auth/capture/refund response (needs retref + respstat)... } }
```
Result: `respstat` A (charge) → active · A (refund) → unpaid · C → past_due · B → held (retry). The status flip is enforced
by the gate immediately and reflected in the owner/POS panels. If your CardPointe response uses different field names than
`retref`/`respstat`, adjust `cardpointeChargeToBillingEvent` in `apps/api/src/ai/ai-cardpointe-billing.ts` (one place).

## Step 4 — Validate end to end
1. **One real OpenAI call:** assign a tenant a package in Super-Admin (or start a trial), then
   `POST /ai/ai_booking_assistant` as that tenant → expect a real completion + a costed row in `ai_usage_logs`.
2. **One real charge:** post a captured CardPointe transaction to `internal/ai-billing/cardpointe` → the subscription
   goes `active`; confirm the owner app shows it unlocked and `ai_billing_events` recorded the transition.
3. **Gate check:** cancel/refund → the same package locks for that tenant on the next call. 
4. **COGS:** Super-Admin → AI Subscriptions shows the cost line populate as calls accrue.

---

## Endpoint reference
**Run an assistant (tenant session):** `POST /ai/:packageCode`
**Owner app (`/tenant/ai`):** `GET packages` · `GET subscriptions` · `POST subscriptions` (start trial) ·
`PATCH subscriptions/:code/cancel` · `GET usage`
**Super-Admin (`/super-admin/ai`):** `GET packages` · `GET packages/:code/tenants` · `GET usage/summary` ·
`POST tenants/:tenantId/subscriptions` · `PATCH/DELETE tenants/:tenantId/subscriptions/:code`
**Internal billing (secret-guarded, `internal/ai-billing`):** `POST event` (pre-normalized) · `POST cardpointe`
(your path) · `POST webhook` (signed — unused in reconcile model) · `POST sweep-trials`

## Suite status at go-live
API **572** · admin-web **98** · owner-web **23** · pos-web **67** — all `tsc`/build clean, `RESULT: PASS`.

## The full chain (all built + verified this session)
enforcement gate → real-data gate → OpenAI/Anthropic/Gemini adapters + per-assistant prompts → cost tracking →
Super-Admin API + screen (with COGS) → tenant API + owner screen → POS panel across 8 areas → billing-status sync →
CardPointe self-reconcile bridge → trial-expiry sweep. Only live-environment validation (Steps 4) remains.
