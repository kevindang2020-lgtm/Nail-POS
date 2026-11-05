# AI Modules — Consolidated Trace (remaining 9) + one real gap

> **STATUS (Jul 29, 2026): historical snapshot — do not work from this file.** The platform has moved far past it; the verified current state lives in `PROJECT_STATUS.md`, the dated build narratives in `CHANGELOG_HANDOFF.md`, and the conventions in `NEW_CLAUDE_INSTRUCTIONS.md`. Remaining work is owner-side only (credentials, hosting, devices, two Kevin decisions) — authoritative list in `PROJECT_STATUS.md`.
> `ai_ocr_receipt` — the one module this trace found incomplete — has since been BUILT and wired (`apps/api/src/ai/ai-receipt.ts`, module registry, tests): all 9/9 modules are now complete.


All controllers below were checked for module registration (the key "orphan controller" risk). **8 are fully
wired; `ai_ocr_receipt` is the one genuinely-incomplete module.**

## Wired (8/9) — controller registered, guarded, permissioned, tested, in AppModule

| Module | Controller | Guards | Perms | Tests | Registered in |
|---|---|---|---|---|---|
| ai_business | `super-admin/ai-business` | SuperAdmin + Tenant + RolePermission | 23 | 26 | ai-business.module.ts |
| ai_marketing | `pos/ai-marketing` | Tenant + RolePermission | 7 | 18 | ai-marketing.module.ts |
| ai_customer_profile | `pos/ai-customer-profile` | Tenant + RolePermission | 21 | 6 | super-admin-ai-customer-profile.module.ts |
| ai_inventory | `pos/ai-inventory` | Tenant + RolePermission | 11 | 18 | ai-inventory.module.ts |
| ai_review_reputation | `pos/ai-review-reputation` | Tenant + RolePermission | 19 | 18 | ai-review-reputation.module.ts |
| ai_analytics_forecasting | `pos/ai-analytics` | Tenant + RolePermission | 8 | 28 | ai-analytics-forecasting.module.ts |
| ai_queue_assignment | `super-admin/ai-queue-assignment` | SuperAdmin + Tenant + RolePermission | 21 | 22 | ai-queue-assignment.module.ts |
| ai_scheduling_optimizer | `pos/ai-scheduling-optimizer` | Tenant + RolePermission | 9 | 20 | ai-scheduling.module.ts |

Notes: ai_marketing enforces consent/opt-out/quiet-hours; ai_review_reputation gates public responses behind
approval; ai_queue_assignment recommends only (no silent moves) per its prior verified arc; ai_inventory is a
read-only position layer that never mutates stock directly.

## BLOCKED (1/9) — `ai_ocr_receipt` orphaned controller, adapter layer missing

**Finding.** `AiOcrReceiptController` (`pos/ai-ocr-receipt`) is a complete, permission-gated controller (13
endpoints: settings, documents list/detail/preview, upload, correct-field, start-review, approve, reject,
return, post) and `AiOcrReceiptService` + the pure pipeline (core/dedup/matching/validation/posting) exist with
**18 passing unit specs**, and migration **344** provides 17 well-designed tables (ocr_documents, files, pages,
jobs, extracted_fields, line_items, validation_results, duplicate/vendor/category/inventory matches, reviews,
approvals, postings, posting_attempts, tenant_ocr_ai_settings, ai_config_versions). The catalog lists it as a
billable package (`ai_ocr_receipt_scanner`).

**But** the service depends on 5 ports — `DocStorePort`, `SettingsStorePort`, `FileStorePort`,
`MalwareScanPort`, `AuditSink` — and **none has a concrete implementation**, and there is **no `*.module.ts`**.
`AiOcrReceiptController`/`AiOcrReceiptService` are referenced nowhere outside their own directory, so the
controller is **never registered in any NestJS module → its routes are never mounted**. The feature is not live
and has no frontend caller.

**Why not "fixed" in this pass (honest).** Completing it means implementing a 7-method DB-backed `DocStore`
(create/get/list/patch/dedupCandidates/save+loadDecisionState over ocr_documents + related tables), a
`SettingsStore` (tenant_ocr_ai_settings + config versions), an `AuditSink` (ocr_approvals), plus a `FileStore`
and `MalwareScan` that **cannot be genuinely functional in this environment** (they require blob storage and a
scanning service). Shipping stub adapters just to mount the controller would surface empty/placeholder data as
if the feature worked — the exact fabricated-completeness this project forbids. So this is reported honestly
rather than faked.

**Completion plan (exact paths):**
1. `apps/api/src/ai-ocr-receipt/ai-ocr-receipt.kysely.ts` — `KyselyDocStore` (7 methods over migration-344
   tables) + `KyselySettingsStore` + `KyselyAuditSink` (→ ocr_approvals), with in-memory fakes for tests.
2. `apps/api/src/ai-ocr-receipt/ai-ocr-receipt.adapters.ts` — `FileStore` (blob-backed; storage-key + signed
   preview route) and `MalwareScan` (real scanner integration), gated behind env/config; honest
   `NotConnected`/skip states until infra is wired.
3. `apps/api/src/ai-ocr-receipt/ai-ocr-receipt.module.ts` — declare `AiOcrReceiptController`, provide
   `AiOcrReceiptService` via `useFactory` picking Kysely (DATABASE) vs in-memory, wire the 6 deps.
4. Import the new module into `app.module.ts` (confirm DI_GRAPH_OK).
5. Add a pglite integration spec (like device-management) proving the DocStore queries.
6. Frontend: an AI OCR Receipt surface under the AI Usage/POS area calling `pos/ai-ocr-receipt`.

## Corrected status
The earlier `AI_USAGE_CONFIG_AUDIT.md` matrix listed `ai_ocr_receipt` as **Complete** based on directory +
catalog presence. Deep tracing shows that was too optimistic: its true status is **Blocked (orphaned
controller; adapter + module-wiring layer missing)**. Net: **14/15 AI modules fully wired; 1 (ai_ocr_receipt)
blocked** pending the adapter + wiring layer above.

---

## UPDATE — ai_ocr_receipt fixed (mounted with real DB persistence)

The orphaned controller is now wired. Changes:
- `apps/api/db/migrations/359_ocr_decision_state.sql` — additive `decision_state JSONB` on `ocr_reviews`.
- `apps/api/src/ai-ocr-receipt/ai-ocr-receipt.kysely.ts` — DB adapters: `KyselyDocStore` (create/get/list/patch/
  dedup/save+loadDecisionState over migration-344 tables), `KyselySettingsStore` (tenant_ocr_ai_settings),
  `KyselyOcrAuditSink` (→ audit_logs), a real `KyselyPostingIdempotency` (ocr_postings), plus in-memory fakes
  for the no-DB path. Honest infra: `DbFileStore` records file metadata (blob upload pending),
  `NotConnectedMalwareScan` returns `'unscanned'` (never fabricates 'clean' → tenant policy quarantines),
  `NotConnectedExpensePost`/`NotConnectedInventoryReceive` **throw** so posting fails safely (never fabricates
  a posted expense/receipt).
- `apps/api/src/ai-ocr-receipt/ai-ocr-receipt.module.ts` — declares `AiOcrReceiptController`, provides
  `AiOcrReceiptService` via `useFactory` (DB adapters vs in-memory), wires `PostingService`.
- `app.module.ts` — imports `AiOcrReceiptModule`.
- `ai-ocr-receipt.pgtest.vitest.spec.ts` — 7 pglite tests proving the lifecycle (create→get→patch→list→dedup,
  decision-state round-trip, settings load, audit write, tenant isolation).

Verified: app `tsc` exit 0; full `ai-ocr-receipt` suite **46 tests pass (10 files)**; pglite integration green.

**Corrected status: `ai_ocr_receipt` = Fixed (mounted).** The controller routes now load and the document
lifecycle (upload → extract → correct → review → approve) persists to the real DB with audit. **Still pending
(honest):** blob storage for file bytes/preview, a real malware scanner, and posting into the tenant
expense/inventory services — all wired as fail-safe `NotConnected` (no fabrication) until that infra/integration
exists. Net across the 15: **14 fully complete + ai_ocr_receipt mounted with real persistence (posting/file/scan
infra pending).**

---

## UPDATE 2 — OCR posting bound to the real InventoryService

The posting path no longer uses NotConnected stubs. It now writes through the **existing tenant
`InventoryService`** — exactly as the posting module intended (`saveReceiptExpense` → `expenses`,
`receivePurchaseOrder` → PO receiving):
- `ai-ocr-receipt.kysely.ts` — added `InventoryExpensePost` + `InventoryReceiveAdapter` (map `PostingCtx`→
  `InvCtx`, `{ ok, expense:{id} }`→`{ id }`) over a structural `InventoryPostingBackend`.
- `ai-ocr-receipt.module.ts` — `imports: [InventoryModule]`, `inject: [DATABASE, InventoryService]`, binds the
  real service into `PostingService`. tsc confirms `InventoryService` satisfies the backend contract.
- `ai-ocr-receipt.posting-binding.vitest.spec.ts` — 4 tests: ctx/return mapping, full `postExpense` → posted,
  throwing backend → **failed (never fabricated)**, and idempotency (posts once).

Verified: app `tsc` exit 0; full `ai-ocr-receipt` suite **50 tests pass (11 files)**.

**Remaining honest gaps (external infra only):** blob storage for file bytes + signed previews, and a real
malware scanner. Both are wired as honest non-fabricating adapters (`DbFileStore` records metadata; scanner
returns `'unscanned'`) and are the only pieces that genuinely require infrastructure this environment can't
provide. Everything else — mount, persistence, review/approval, audit, and posting into inventory/expenses —
is now real and tested.
