# CANONICAL_BASE_DECISION.md

## Decision

**Package B (`AI-PowerSalon-Full-Working-Handoff__8_.zip`) is the canonical base.**

## Why B (not timestamps — structural evidence)

1. **Longest valid migration chain.** B ends at `335_queue_assignment_auto.sql` (336 files);
   A and C end at 324, D at 329. B's chain 001–335 is internally consistent and its 320–335
   block never collides with itself.
2. **Contains the corrected, unified AI queue-assignment implementation** the merge
   instructions require preserving. B's changelog (2026-07-09, "Transfer verification +
   duplicate-package reconciliation") documents removing the duplicate `ai_queue_assignment`
   catalog package and repointing entitlement / usage logging / SA filter / pos-web nav gate to
   the canonical `ai_queue_technician_assignment`. Verified in code: `ai/ai-catalog.ts` is
   byte-identical in all four packages (the duplicate was reverted inside B and never existed
   in A/C/D), and B's `ai-queue-assignment-entitlement.ts` references
   `ai_queue_technician_assignment`.
3. **Newest verified state.** B's TEST_REPORT records API 3352/3352 across 511 files — the
   highest verified API total of the four — with the latest changelog date.
4. **Most invasive shared-domain edits already integrated.** B is the only branch that
   modified `queue.service.ts`, `campaigns.service.ts`, `communications.module.ts`,
   `notifications.module.ts`, and `ai-booking-conversion.service.ts` (its marketing +
   queue-assignment arcs). Using B as base keeps those high-blast-radius changes untouched;
   the other branches' edits are additive modules plus a small, enumerable set of shared-file
   hunks.
5. **No ancestor deletions anywhere:** no file present in A∩C∩D is missing from B, so basing
   on B cannot lose ancestor functionality.

## What is imported from each other package

- **From A:** modules `ai-business`, `ai-inventory`, `ai-analytics-forecasting`,
  `super-admin-forecasting`; their pos-web/admin-web screens, api clients and specs;
  sole-changer files `owner.service.ts`, `reports.service.ts`, `superAdminApi.ts`,
  `superAdminAiApi.ts`, `AdminLayout.test.tsx`; migrations A320–A324 → renumbered **336–340**;
  kysely table types; rbac/app.module/nav/route/prompt hunks.
- **From C:** modules `ai-checkout-upsell`, `ai-customer-profile`, `ai-ocr-receipt`,
  `ai-review-reputation`, `ai-scheduling-optimizer` + 5 `super-admin-ai-*` oversight modules;
  their screens/clients/specs; sole-changer files `checkout.module/service.ts`,
  `security-core.ts`, `customers.dto.ts`, `loyalty.*`, `provider-registry.ts`,
  `POSCheckoutScreen.tsx`; migrations C320–C324 → renumbered **341–345**; kysely types;
  rbac/app.module/nav/route/prompt/admin-shell hunks; env vars from its coverage pass.
- **From D:** modules `deposit-reconciliation`, `super-admin-reconciliation`, `invoices`,
  `marketing-report`, `pos-referrals`, `pos-social`, `service-add-ons`, `split-payments`,
  `team-permissions`, `tenant-billing`, `tenant-entitlements`, `time-clock`; their
  screens/clients/specs (largest pos-web suite); sole-changer files `call-intelligence.*`,
  `customer-payments.*`, `services.kysely.repository.ts`, `entitlements.service.ts`,
  `auth-boundary.vitest.spec.ts`, customer-web `App.tsx`/`ProfileScreen.tsx`, pos-web
  `client.ts` + `posCustomersApi/posNotificationsApi/posRemindersApi.ts` +
  `POSCampaignCenterScreen.tsx`; migrations D320–D329 → renumbered **346–355**; kysely types;
  rbac/app.module/nav/route hunks; `.env.example` recon addendum.

## Superseded implementations

- The pre-correction duplicate `ai_queue_assignment` catalog package (existed only transiently
  inside B's own history; already absent from all four ZIPs) stays removed. Guard test added.
- A/C/D's `.env.example` bodies are superseded by the merged annotated file.
- Each branch's copies of the 10 multi-branch conflict files are superseded by the merged
  versions recorded in `MERGE_DECISIONS.md`.
- A/C/D root handoff docs (`TEST_REPORT.md`, `PROJECT_STATUS.md`, …) are superseded by the
  fresh post-merge docs; feature-specific reports (e.g.
  `AI_SCHEDULING_OPTIMIZER_FINAL_REPORT.md`, D's reconciliation docs) are carried over.

## Conflicts requiring reconciliation (resolved in later phases)

Migration renumbering (Phase 6, `MIGRATION_RECONCILIATION.md`); the 10 hunk-merge files
(Phase 4, `MERGE_DECISIONS.md`); ForecastPort now has a richer source available
(A's forecasting module) — binding decision in Phase 8; D's call-intelligence edits coexist
with B's ai-voice-transcription (verified non-overlapping routes/tables in Phase 4).
