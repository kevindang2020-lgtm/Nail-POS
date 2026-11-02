# FOUR_PACKAGE_COMPARISON.md

Comparison of the four uploaded handoff packages (2026-07-08 merge session). All four are
divergent branches of the **same** monorepo, forked from a common ancestor: the
**2026-06-28 handoff** (migrations 001–319, API ≈3052 tests). Verified by hashing: migrations
001–319 are **byte-identical** in all four packages (md5 of the chain: `ad622ece…` in all four),
and 3,300+ source files are identical across packages. Each branch then built a different
feature arc, independently numbering its new migrations from 320 — producing **migration-number
collisions (320–329) between branches but zero file-path collisions** (no two branches created
the same new file path).

Package letters used everywhere in the merge docs:

| Letter | Upload | Project root inside ZIP |
|---|---|---|
| **A** | `AI-PowerSalon-Full-Working-Handoff__7_.zip` | ZIP root (flat) |
| **B** | `AI-PowerSalon-Full-Working-Handoff__8_.zip` | `AI-PowerSalon/` |
| **C** | `files__8_.zip` → nested `AI-PowerSalon-Full-Working-Handoff.zip` | nested-ZIP root |
| **D** | `files__9_.zip` → nested `AI-PowerSalon-Full-Working-Handoff.zip` | nested-ZIP root |

All four contain the identical workspace skeleton: `apps/{api, pos-web, admin-web, customer-web,
owner-web, tech-web, manager-pay-web, customer-display, go-check-in-admin, go-check-in-kiosk}` +
`packages/ui`, NestJS 10 + Kysely + Postgres 16 API, React 18 + Vite frontends.

---

## Package A — "AI Business / Inventory / Forecasting" branch (Handoff 7)

- **Migrations:** 001–**324** (325 files). New: `320_ai_business_saved_questions`,
  `321_ai_business_alerts`, `322_ai_business_report_jobs`, `323_inventory_service_recipes`,
  `324_forecast_points`.
- **Unique API modules (4):** `ai-business` (42 files), `ai-analytics-forecasting` (35),
  `ai-inventory` (25), `super-admin-forecasting` (6).
- **Unique frontend:** 16 pos-web screens/specs, 3 pos-web api clients, 4 admin-web screens
  (forecasting oversight), changes to `superAdminApi.ts` / `superAdminAiApi.ts`.
- **Sole-changer shared-file edits:** `owner.service.ts`, `reports.service.ts`,
  `AdminLayout.test.tsx`, admin-web SA api clients.
- **AI features:** ai_business Q&A/alerts/report-jobs; ai_inventory read/recommend layer with
  approval-gated proposals over the existing inventory domain; ai_analytics_forecasting
  (staffing/demand/booking forecast engine writing `forecast_points`); super-admin forecasting
  oversight.
- **Queue assignment:** none (ancestor state).
- **Payments/reconciliation:** ancestor state.
- **Historical doc totals (reference only, not trusted):** API 3319, pos-web ~404 → 631 api
  spec files on disk.
- **Recommended role: feature-source** for ai-business / ai-inventory /
  ai-analytics-forecasting / super-admin-forecasting.

## Package B — "Marketing / Money-Protection / Voice-Transcription / Queue-Assignment" branch (Handoff 8)

- **Migrations:** 001–**335** (336 files) — the **longest chain**. New:
  `320–321_ai_marketing_campaign_*`, `322_ai_booking_conversion_campaign_id`,
  `323–325_money_protection_*`, `326–330_call_transcription_*`, `331–335_queue_assignment_*`.
- **Unique API modules (4):** `ai-marketing`, `ai-money-protection`, `ai-queue-assignment`,
  `ai-voice-transcription`.
- **Contains the corrected, unified AI queue-assignment implementation.** Its changelog entry
  “2026-07-09 — Transfer verification + duplicate-package reconciliation” documents removal of
  the duplicate `ai_queue_assignment` catalog package: entitlement, usage logging, SA usage
  filter and pos-web nav gate all repointed to the pre-existing canonical
  **`ai_queue_technician_assignment`** package; duplicate catalog entry + extra
  `recommendations` usage-unit reverted. `ai/ai-catalog.ts` is now **byte-identical in all four
  packages** — confirming the duplicate never leaked to the other branches and the revert is
  complete.
- **Sole-changer shared-file edits:** `queue.service.ts`, `campaigns.service.ts`,
  `communications.module.ts`, `notifications.module.ts`, `ai-booking-conversion.service.ts`,
  `apps/api/package-lock.json`.
- **Historical doc totals:** API **3352/3352 (511 files)** — the highest verified API total;
  latest changelog date (2026-07-09).
- **Recommended role: CANONICAL BASE** (longest valid migration chain, corrected queue
  assignment, newest verification date, most invasive shared-file edits already integrated).

## Package C — "Five-AI-modules + Scheduling Optimizer" branch (files 8)

- **Migrations:** 001–**324** (325 files). New: `320_ai_customer_profile_settings`,
  `321_ai_checkout_upsell`, `322_ai_review_reputation`, `323_ai_ocr_receipt`,
  `324_ai_scheduling_optimizer` (14 tenant-scoped optimizer tables).
- **Unique API modules (10):** `ai-checkout-upsell`, `ai-customer-profile`, `ai-ocr-receipt`,
  `ai-review-reputation`, `ai-scheduling-optimizer` + 5 `super-admin-ai-*` oversight
  counterparts.
- **AI Scheduling Optimizer:** ports-based (BookingReadPort → `booking.service`; ForecastPort →
  super-admin-analytics), deterministic engine authoritative, automation OFF by default with
  kill-switch, customer-approval workflow for confirmed appointments, apply-path goes through
  `booking.service.reschedule`. Ships `AI_SCHEDULING_OPTIMIZER_FINAL_REPORT.md` (outer file).
- **Sole-changer shared-file edits:** `checkout.module/service.ts` (upsell hook),
  `security-core.ts` (+`ai_scheduling_optimizer → "booking"` capability), `customers.dto.ts`,
  `loyalty.{service,repository,kysely.repository}.ts`, `provider-registry.ts`,
  `POSCheckoutScreen.tsx`.
- **Also:** regenerated `.env.example` as a flat complete list of all 105 referenced env vars.
- **Historical doc totals:** 634 api spec files on disk (highest file count); its TEST_REPORT
  documents module-isolation verification.
- **Recommended role: feature-source** for the five AI modules + SA oversight; primary source
  for the AI Scheduling Optimizer wiring goal (Phase 8).

## Package D — "Sidebar-wiring / Referrals / Payments-Reconciliation" branch (files 9)

- **Migrations:** 001–**329** (330 files). New: `320_service_add_ons`,
  `321_customer_notes_json`, `322_invoices`, `323_referral_redemptions`, `324_social_posts`,
  `325_bank_accounts_deposits`, `326_fee_schedules`, `327_reconciliation_exceptions`,
  `328_reconciliation_periods`, `329_bank_webhook_endpoints`.
- **Unique API modules (12):** `deposit-reconciliation`, `super-admin-reconciliation`,
  `invoices`, `marketing-report`, `pos-referrals`, `pos-social`, `service-add-ons`,
  `split-payments`, `team-permissions`, `tenant-billing`, `tenant-entitlements`, `time-clock`.
- **Reconciliation:** deterministic engine that only OPENS exceptions (never moves money);
  human-approval gates for exception closure and period close; append-only history; optional
  advisory-lock background sweep OFF by default (`RECON_SWEEP_*` env); real-PG16 E2E
  tenant-isolation verification documented.
- **Sole-changer shared-file edits:** `call-intelligence.{controller,service,repository,
  kysely.repository}.ts` (wired the sidebar Call Intelligence screen against the existing
  voice layer), `customer-payments.{module,service}.ts`, `services.kysely.repository.ts`,
  `entitlements.service.ts`, `auth-boundary.vitest.spec.ts`, customer-web `App.tsx` +
  `ProfileScreen.tsx`, pos-web `client.ts` + 3 api clients + `POSCampaignCenterScreen.tsx`.
- **Largest pos-web suite:** 172 pos-web test files; 250 new files total.
- **Historical doc totals:** API 3177 (494 files); fresh-DB migration chain verified
  (330 applied, 461 tables).
- **Recommended role: feature-source** for reconciliation/payments + the whole sidebar-wiring
  arc (referrals, invoices, social, add-ons, time-clock, split-payments, team-permissions,
  tenant-billing/entitlements, marketing-report).

---

## Cross-package conflict summary

- **Migration numbers 320–329 collide four ways** (each branch reused them for different DDL).
  No two branches create the same table. Resolution in `MIGRATION_RECONCILIATION.md`.
- **True multi-branch file conflicts (need hunk-level merges), 10 files:**
  4-way: `apps/api/src/app.module.ts`, `apps/api/src/auth/rbac.ts`,
  `apps/api/src/database/kysely.types.ts`, `apps/pos-web/src/App.tsx`,
  `apps/pos-web/src/shell/tenant-nav.tsx`.
  A+B changed: `apps/api/src/common/tenant-isolation.vitest.spec.ts`.
  A+C changed: `apps/admin-web/src/App.tsx`, `apps/admin-web/src/shell/AdminLayout.tsx`,
  `apps/api/src/ai/ai-prompts.ts`.
  C+D changed: `apps/api/src/customers/customers.kysely.repository.ts`.
- **Single-branch shared-file edits (take that branch's file wholesale):** listed per package
  above; full list in `MERGE_DECISIONS.md`.
- **`.env.example` three-way divergence:** A==B annotated template; C = flat complete list;
  D = A/B + reconciliation-sweep addendum. Merged: annotated B body + D addendum + missing
  vars from C's coverage pass appended in annotated style.
- **No package may be discarded:** every package contributes unique implemented modules,
  migrations, and tests (A: 4 modules, B: 4 modules + base, C: 10 modules, D: 12 modules).
