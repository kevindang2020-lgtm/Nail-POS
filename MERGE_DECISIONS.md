# MERGE_DECISIONS.md — Four-Package Merge (2026-07-08/09)

_Supersedes the seven-package consolidation doc (archived at `docs/history/seven-package-merge/`). Companion to
`FOUR_PACKAGE_COMPARISON.md`, `CANONICAL_BASE_DECISION.md`, and `MIGRATION_RECONCILIATION.md`._

Merging four divergent working ZIPs of the AIPowerSalon monorepo — all forked from the identical 2026-06-28 base
(migrations 001–319 byte-identical across all four) — into one canonical repository.

- **Package A** ("Handoff (7)"): AI Business Assistant, AI Analytics & Forecasting, AI Inventory read/recommend
  layer, Super-Admin Forecasting. Migrations 320–324 (its numbering).
- **Package B** ("Handoff (8)"): AI Marketing, AI Money Protection, AI Voice Transcription, AI Queue + Technician
  Assignment (incl. the 2026-07-09 duplicate-package reconciliation). Migrations 320–335. **Chosen canonical base.**
- **Package C** ("files (8)"): AI Customer Profile, AI Checkout Upsell, AI Review & Reputation, AI OCR Receipt,
  AI Scheduling Optimizer + five Super-Admin oversight counterparts. Migrations 320–324 (its numbering).
- **Package D** ("files (9)"): Deposit Reconciliation, Invoices, Referrals, Social, Service Add-Ons, Split Payments,
  Team Permissions/Time Clock, Tenant Billing/Entitlements + the sidebar wiring arc. Migrations 320–329 (its numbering).

## 1. Structural decisions

1. **Canonical base = Package B** — longest migration chain (001–335 untouched), the corrected queue-assignment
   reconciliation, newest verified state, and the only branch that modified the queue/campaigns/communications/
   notifications/ai-booking-conversion services.
2. **Migration renumbering** — A 320–324 → **336–340**, C 320–324 → **341–345**, D 320–329 → **346–355**,
   byte-identical bodies, new filenames only. The colliding 320–329 chains were mutually exclusive (never
   co-released), so renumbering is safe. Final chain: 356 files (001–355 + ancestor-era 017a). Stale spec
   references to A's old numbers were updated (`ai-business-admin.vitest.spec.ts` 320/321 → 336/337).
3. **Zero path collisions among new files** — every branch's new modules/screens were ported verbatim. Twelve
   shared files were hand-merged; every branch's changed lines are present in the merged file.

## 2. Shared-file merge decisions

| File | Decision |
|---|---|
| `app.module.ts` | B base + 23 branch module imports/registrations + D's bank-webhook middleware exclusion + `AiSchedulingModule` (§3.2). |
| `auth/rbac.ts` | Superset: A's ai_business/ai_inventory/ai_analytics perms + D's reconciliation perms + role grants. Plus the coarse `marketing.view/manage`, `inventory.manage` fix (§4.2). |
| `database/kysely.types.ts` | `DB` interface union-merged; `ReviewsTable`←C, `CustomersTable`←D (adds notes_json); 60 new interfaces appended grouped by branch. |
| pos-web `App.tsx` | A(6)+C(13)+D(37) routes appended. Six colliding D routes dropped in favor of real screens: `tenant/ai/{queue,marketing,voice-transcription}` (B), `tenant/ai/{business,inventory}` (A), `tenant/ai/analytics` (A's forecasting screen; D's analytics screen remains at `tenant/reports/ai`). D's `POSAiPackageScreen` (a real catalog-driven subscription page) keeps its seven non-colliding package paths. 191 routes, no duplicates. |
| `shell/tenant-nav.tsx` | B's canonical AI block kept; A's 3 ai-business sub-items (code upgraded `ai_business`→`ai_business_assistant`); C's 12 items (`ai_upsell`→`ai_checkout_upsell_assistant`; malformed line repaired, §4.5); D's `pay-recon` + C's `pay-ai-receipts` payments items; `EXISTING_ROUTES` = set-union of all four packages + 5 paths C omitted (§4.5). |
| `tenant-isolation.vitest.spec.ts` | B base + A's ai-business file-allowlist entry (B's three rollup allowlist entries already present). |
| admin-web `App.tsx` / `AdminLayout.tsx` | A's Forecasting + AI Business Adoption screens/links + C's Customer-Profile and Checkout-Upsell oversight screens/links. 124 routes, no dupes; layout duplicate links are B's pre-existing intentional cross-section links. |
| `ai/ai-prompts.ts` | A's richer guardrailed `ai_business_assistant` prompt (A implemented that module) over B's placeholder; C's 5 new roles (scheduling explanation + four OCR roles). 20 roles, no duplicates. |
| `customers.kysely.repository.ts` | C's branch-name join on visit history + D's notes_json read/write path — non-overlapping hunks, both applied. |
| `checkout.{module,service}.ts`, `security-core.ts`, loyalty set, `provider-registry.ts`, `POSCheckoutScreen.tsx`, `customers.dto.ts` | C's versions (sole changer). |
| call-intelligence set, customer-payments, `entitlements.service.ts`, `services.kysely.repository.ts`, customer-web App/Profile, pos-web api clients, `POSCampaignCenterScreen.tsx`, `auth-boundary.vitest.spec.ts` | D's versions (sole changer). |
| `superAdminAiApi.ts`, `superAdminApi.ts`, `AdminLayout.test.tsx`, `owner.service.ts`, `reports.service.ts` | A's versions (sole changer). |
| `package-lock.json`, queue/campaigns/communications/notifications/ai-booking-conversion services | B kept (canonical). |
| `.env.example` | B's annotated body + D's `RECON_SWEEP_*` addendum + a coverage section for 94 additional variables referenced by merged code. |

## 3. Phase 7/8 integration decisions

1. **Queue assignment** — B's reconciliation is the merged truth (single catalog code
   `ai_queue_technician_assignment`; `ai-catalog.ts` byte-identical across all four packages). Added
   `ai-queue-assignment-registration.guard.vitest.spec.ts` (4 tests) making the no-duplicate invariant
   executable. See `AI_QUEUE_ASSIGNMENT_RECONCILIATION.md`.
2. **AI Scheduling Optimizer completion** — Package C shipped the module but (a) **never registered it in
   `app.module.ts`** (every endpoint 404'd) and (b) left the `BOOKING_READ` and `FORECAST` ports on their honest
   stubs (always `NO_FEASIBLE_OPTION`; forecast never available). Completed per C's own final report:
   - Registered `AiSchedulingModule` in `app.module.ts`.
   - Wrote `ai-scheduling.booking-read.adapter.ts` — the production `BookingReadPort` over the canonical
     `BookingService.availability` (no availability logic re-implemented) + `BookingRepositoryPort` reads
     (durations, branch hours, existing appointments, schedules, skills — the same category rule as
     `booking.service.techSkilledFor`). Appointments that have started are `locked` and never moved.
   - Bound `ForecastPort` to A's `BusyPeriodService` (the canonical Busy & Slow Periods domain) via
     `BusyPeriodForecastAdapter`; any error or insufficient history resolves to `{ available: false }` —
     advisory only, never blocking.
   - `BookingModule` additionally exports its `'BookingRepositoryPort'` token (additive).
3. **Forecasting vs anomaly domains** — verified complementary, no duplication: A's anomaly-detect reads the
   appointment series via ReportsService; B's money-protection reads payments/tickets/payment_attempts; C's
   optimizer consumes A's forecasting as a port rather than duplicating it.
4. **Voice surfaces** — D's `call-intelligence` (route `tenant/ai/call-intelligence`, table
   `call_intelligence_events`) and B's `ai-voice-transcription` (routes `pos/ai-voice-transcription` +
   super-admin, tables `call_transcripts` …, migrations 326–330) are disjoint in routes and tables.

## 4. Defects found and fixed during the merge

Package C was verified module-in-isolation only (per its own report), so its slice carried latent full-app
defects. All were fixed this session; every fix is covered by the fresh green gates in `TEST_REPORT.md`.

1. **13 TypeScript errors (C slice)** — duplicate `DATABASE` import in `checkout.module.ts`; `makeCacheRedis()`
   called without a client in `ai-checkout-upsell.module.ts` (now the same `makeIoredis` pattern C's own
   customer-profile module uses); the scan scheduler's `@Optional` DB param typed non-optional; a
   `number | null` clamp fallback in OCR settings; four `string` vs timestamp comparisons in the
   review-reputation repository (fixed in established codebase style); `Placement.allowServiceOverlap`
   referenced by constraint 7 but missing from the interface (added optional).
2. **RBAC capability gap (pre-existing, base-wide)** — the catalog minted **no** coarse `marketing.*` or
   `inventory.manage` capability, so `requiredCapability()` resolved `pos.marketing.*` (the base
   reviews-visibility/campaigns/ai-marketing gates) and C's `ai_review_reputation`/`ai_ocr_receipt` aliases to
   capabilities **no role held — a live 403 for every user including OWNER**, in all four packages identically.
   Fixed by minting `marketing.view`, `marketing.manage`, `inventory.manage` and granting them to MANAGER
   (OWNER inherits all non-super-admin capabilities). Verified empirically against the compiled
   `hasPermission` for OWNER/MANAGER/FRONT_DESK.
3. **C test-fixture defects** — the reputation escalation/drafting specs held granular `pos.marketing.*` strings
   instead of the coarse capabilities real tokens carry (fixed to `marketing.manage`/`marketing.view`); the
   upsell fatigue spec expected 3 survivors where the configured caps make 2 the arithmetic ceiling (ao2
   dismissed, p2 over `maxProduct: 1`); the customer-profile screen test used `getByText('Refresh')`, which also
   matches the screen's own help text (now `getByRole('button', …)`).
4. **Upsell tool contract** — `UpsellTool.run` promises a `Promise` but threw synchronously on malformed ids;
   both tool bodies are now `async` so validation failures reject, as the security spec asserts.
5. **C's tenant-nav malformed line** — C's line 208 had three route-string literals spliced *inside* the
   `ai-cust-search` item object (a syntax error; C's pos-web could not have compiled). The evident intent was
   restored: the item keeps only its own route, and the three stranded paths went to `EXISTING_ROUTES` — where
   B's anti-double-registration wiring test then also flagged `/tenant/ai/ocr-receipt` and
   `/tenant/ai/scheduling-optimizer` as omitted; all five were added.
6. **PGlite harness** — migration 107 (`CREATE EXTENSION pg_trgm`) requires the pg_trgm contrib;
   `verify-migrations-pglite.mjs` now loads it alongside pgcrypto. The full chain applies 356/356 from scratch.

## 5. Explicit non-changes

- The ancestor-era duplicate `CREATE TABLE IF NOT EXISTS` quirks (`technician_services` in 003+006,
  `merchant_risk_reviews` in 187+276) are historically green and untouched (see `MIGRATION_RECONCILIATION.md`).
- No tests were deleted. Two spec assertions/fixtures were corrected only where they contradicted the module's
  own documented behavior or plain arithmetic (§4.3).
- Payment gateway isolation (Fiserv/CardPointe/Bolt/Clover only), integer-cents money, server-derived
  tenant/branch scope, honest-data rules, advisory-only forecasts, off-by-default automation, and the
  cream/gold + Mac-fit shell are unchanged and re-verified (scans recorded in `TEST_REPORT.md`).
