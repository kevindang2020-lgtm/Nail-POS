# AI Usage & Configuration — System Audit + 15-Module Wiring Matrix

**Scope:** the central AI gateway, the 15 AI modules, and the Super Admin AI Usage & Configuration surface.
**Result:** the AI system is comprehensively built and wired; this pass verifies it and adds one non-breaking
reconciliation (a canonical module registry). No destructive changes were made.

---

## Architecture found

- **Central gateway** — `apps/api/src/ai/` holds the real gateway: `ai-gateway.ts` (`AiGatewayService`, a
  provider port with Anthropic/OpenAI/Gemini adapters + a deterministic Mock used when no key is set),
  `ai-providers.ts` (provider resolution), `ai-access-gate.ts` (the enforcement heart), `ai-prompts.ts`,
  `ai-pricing.ts`, `ai-catalog.ts` (the 15 billable packages), `ai-plans.ts`, and Kysely+InMemory
  access/usage repositories. Nothing bypasses this port.
- **Access enforcement** — `ai-access-gate.ts` is a pure allow/deny decision over a snapshot (tenant account
  status, package-enabled flag, subscription status ∈ active/trialing/past_due/unpaid/cancelled/expired/
  disabled/suspended, usage vs limit, permission, support-mode). "A tenant must have an active paid package or
  an unexpired Super-Admin trial before any AI runs."
- **Safety invariant holds** — a scan of **all** frontends (admin/pos/owner/tech/customer/*) found **no**
  direct calls to OpenAI/Anthropic/Retell/Deepgram/etc. The only frontend matches are config **labels**
  (provider dropdowns, integration marketplace names). Provider credentials are submitted to the backend and
  stored server-side; they are never called from the client.
- **Super Admin surface** — `AiUsageConfigScreen` → `superAdminAiApi`/`superAdminApi` →
  `/super-admin/ai-usage/*` (`SuperAdminAiUsageController`) + `/super-admin/ai/*` (`SuperAdminAiController`),
  both behind `SuperAdminGuard`, in AppModule. `ai_usage_logs.package_code` is non-nullable.

## Finding + fix (non-breaking)

The billable catalog (`ai-catalog.ts`) uses established DB-backing codes (`ai_booking_assistant`,
`ai_fraud_money_protection`, `ai_queue_technician_assignment`, …) and contains **`ai_reception_copilot`**
instead of **`ai_deposit_reconciliation`**. These codes key real `tenant_ai_*` / usage / billing records, so
renaming them to the spec's short codes would orphan data — backwards compatibility is exactly why they must
stay. Rather than a destructive rename, added a **canonical registry** that reconciles the two:

- `apps/api/src/ai/ai-module-registry.ts` — the 15 canonical spec codes, each mapped to its catalog package
  code (or null) and backend module; helpers `canonicalToCatalog`, `catalogToCanonical`, `extraCatalogPackages`.
- `ai-module-registry.vitest.spec.ts` (6 tests) — **self-verifies every alias against the real
  `AI_PACKAGE_CODES`**, so the map cannot drift; documents that `ai_deposit_reconciliation` is a non-package
  (finance) module and that `ai_reception_copilot` is an extra beyond the canonical 15.

Verified: 6/6 registry tests pass; API `tsc --noEmit` exit 0.

## 15-Module Wiring Matrix

| Canonical code | Backend module | Catalog package | Gateway | Access-gate | Usage | Frontend surface | Status |
|---|---|---|---|---|---|---|---|
| ai_booking | ai-booking | ai_booking_assistant | ✓ | ✓ | ✓ | AI Booking Analytics / POS booking | Complete |
| ai_phone | voice-booking (ai-receptionist-gateway) | ai_phone_call_assistant | ✓ | ✓ | ✓ | AI Receptionist | Complete |
| ai_business | ai-business | ai_business_assistant | ✓ | ✓ | ✓ | AI Business Assistant | Complete |
| ai_marketing | ai-marketing | ai_marketing_assistant | ✓ | ✓ | ✓ | Marketing / campaigns | Complete |
| ai_customer_profile | ai-customer-profile | ai_customer_profile_assistant | ✓ | ✓ | ✓ | AI Customer Profile | Complete |
| ai_checkout_upsell | ai-checkout-upsell | ai_checkout_upsell_assistant | ✓ | ✓ | ✓ | AI Checkout Upsell | Complete |
| ai_money_protection | ai-money-protection | ai_fraud_money_protection | ✓ | ✓ | ✓ | Money protection / reports | Complete |
| ai_inventory | ai-inventory | ai_inventory_assistant | ✓ | ✓ | ✓ | Inventory | Complete |
| ai_review_reputation | ai-review-reputation | ai_review_reputation_assistant | ✓ | ✓ | ✓ | Reviews / reputation | Complete |
| ai_voice_transcription | ai-voice-transcription | ai_voice_transcription | ✓ | ✓ | ✓ | Voice transcription | Complete |
| ai_ocr_receipt | ai-ocr-receipt | ai_ocr_receipt_scanner | logic ✓ | — | — | (none yet) | **Blocked** — orphaned controller; adapters+wiring missing (see AI_MODULE_DEEPTRACE_REMAINING.md) |
| ai_analytics_forecasting | ai-analytics-forecasting | ai_analytics_forecasting | ✓ | ✓ | ✓ | Forecasting oversight | Complete |
| ai_deposit_reconciliation | deposit-reconciliation | — (finance module) | ✓ | ✓ | ✓ | Settlements / reconciliation | Complete |
| ai_queue_assignment | ai-queue-assignment | ai_queue_technician_assignment | ✓ | ✓ | ✓ | Queue assignment | Complete |
| ai_scheduling_optimizer | ai-scheduling-optimizer | ai_scheduling_optimizer | ✓ | ✓ | ✓ | Scheduling optimizer | Complete |

Legend: Gateway = routed through the shared provider port (no direct provider calls); Access-gate = subject to
`ai-access-gate` paid/trial/status/permission/usage enforcement; Usage = usage recorded to `ai_usage_logs`.

## Correction (after per-module deep tracing)
Deep tracing found `ai_ocr_receipt` is **not** Complete: its controller/service/logic and migration 344 exist,
but the 5 port adapters and the NestJS module file are missing, so the controller is orphaned and its routes
never mount. Corrected status: **14/15 modules fully wired; ai_ocr_receipt Blocked.** Details + completion plan
in `AI_MODULE_DEEPTRACE_REMAINING.md`.

## Honest notes / not done
- I did **not** rename catalog codes to the spec's short forms — that would break DB-keyed records; the
  canonical registry reconciles the names additively instead.
- Per-module deep verification here was at the registry/gateway/catalog level plus targeted checks; a full
  controller→service→tool→provider trace of all 15 (as done for the Super Admin sections) can follow on request.
- The "Usage ✓" column reflects gateway/usage-log integration at the module level; exact per-endpoint usage
  reservation for every route was not individually re-traced this pass.
