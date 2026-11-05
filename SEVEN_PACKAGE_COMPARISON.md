# SEVEN_PACKAGE_COMPARISON.md — analysis of the seven uploaded packages

_Produced 2026-07-02 during the seven-package consolidation. All facts below were established by extracting each
package and hashing every migration and source file (md5), not from the packages' own claims._

## The shape of the divergence

All seven packages are **full snapshots of the same monorepo** that branched from a **single common ancestor**:

- **Migrations 0–171 are byte-identical across all seven packages.** Divergence begins at `172_*.sql`, where each
  package continues the chain with its own arc (7-way filename collisions from 172 onward).
- Of 2,984 unique source paths: **1,822 files are byte-identical in all seven** (the ancestor core),
  **1,044 exist in exactly one package** (each arc's new modules/screens/tests), **109 were modified by exactly one
  package**, and **29 files were modified by two or more packages** (the true integration points: `app.module.ts`,
  admin `App.tsx`, `AdminLayout.tsx`, `superAdminApi.ts`, `rbac.ts`, `kysely.types.ts`, the super-admin-platform
  trio, plus five same-feature overlap pairs).

Package labels below use upload order (`__1_` … `__6_` plus `files__6_.zip`, whose inner zip is the seventh snapshot).

## Package 1 — AI-PowerSalon-Full-Working-Handoff__1_.zip (review id p1)
- Root at archive top level. Docs dated **2026-06-28** (oldest snapshot; ancestor + 7 migrations).
- **Arc:** platform General Settings (5-level hierarchy), Legal Documents, Maintenance mode + middleware, Business
  Categories, Tenant Presets, tenant locale — plus **`apps/manager-pay-web`** (Owner & Manager Payment App,
  Tap-to-Pay backup checkout; the only package with this app) and its `mobile-checkout` backend + `checkout-lock`.
- Migrations: 179 files, `172_checkout_locks` … `178_tenant_locale`.
- Unique: 110 files. Also carried an early branch-status command (superseded — see MERGE_DECISIONS).
- **Merge role: feature arc** (settings/legal/maintenance/presets + manager-pay-web + checkout locks).

## Package 2 — __2_.zip (p2, nested under `aipowersalon/`)
- Docs dated 2026-07-03; claims 2,339 tests, 190 migrations.
- **Arc:** Super-Admin Report Builder + Scheduled Reports (definitions/runs), platform request metrics
  (health-metrics interceptor), Appointment Oversight sub-screens + change log, Revenue & Residuals (residual
  statements, processor reconciliations, partner payouts, tenant incentives, adjustments, export jobs),
  **Integrations** (connection lifecycle, sync, webhook events, reliability, credential vault, permission guard).
- Also contained an earlier Service Templates (1 migration), an earlier Billing invoices/credit-notes pair
  (188/189), an earlier read-only Settlements, and an earlier Disputes read surface — **all four superseded** by
  fuller implementations in packages 4/5 (see MERGE_DECISIONS).
- **Merge role: feature arc** (reports/oversight/revenue-residuals/integrations); 15 of 18 divergent migrations ported.

## Package 3 — __3_.zip (p3)
- Largest test counts of the seven (API 259 spec files / admin 85). 192 migrations.
- **Arc:** Customer Data Oversight (legal holds, imports, deletion/privacy requests, duplicates, merge history,
  exports), Product Catalog (master/imports/distribution/barcodes), Marketing & Campaigns (platform announcements
  v-rich, compliance, deliveries, templates, metric snapshots), AI Insights + AI Providers, **AI Usage &
  Configuration** (AES-256-GCM provider keys, versioned global prompts), Device Management, **System Status**
  (health snapshots, incidents, communications, recovery/impact), Tenants page + directory analytics.
- Carried its own branch-status module (superseded by package 6's richer lifecycle).
- **Merge role: feature arc**, all 20 divergent migrations ported.

## Package 4 — __4_.zip (p4)
- Docs dated **2026-07-02**. 181 migrations; API 1452/232 + admin 299/61 claimed.
- **Arc:** Onboarding & Approvals (12-stage pipeline), Live Queue Monitor (metrics snapshots + actions),
  **Settlements & Deposits** (canonical implementation: notes, discrepancy resolution, deposit matching,
  processor-support cases reusing the existing SupportTickets writer, CSV/XLSX/PDF export), Loyalty Programs
  (platform config, suspicious cases, calculation corrections), **Automation Rules** (engine, idempotency,
  scheduler, typed conditions, live emit sites), Support Center CSAT. Also `getBlob` download support in the
  admin API client and the newer SupportAccessScreen (fixes a step-up test the ancestor pair failed).
- **Merge role: feature arc**, all 9 divergent migrations ported.

## Package 5 — __5_.zip (p5) — **CANONICAL BASE**
- Longest migration chain (201 files through `200_billing_export_jobs`), most recent arc, highest cross-app test
  coverage claim (2,351 across 8 workspaces), all 7 builds clean.
- **Arc:** Plans & Feature Limits (plans/features/overage/versions/entitlement overrides/add-ons/charges/changes/
  usage counters/utilization), **Service Templates** (canonical: catalog + seed + lifecycle + deployment tracking),
  **Chargebacks & Disputes** (canonical surface + fixtures), **Membership Programs** (15 KPIs, suspicious-activity,
  support sessions, KPI snapshots), **Billing & Subscriptions** (subscriptions, invoices with full financial
  columns, credits, discounts, payment attempts, lifecycle, webhooks, KPI snapshots, export jobs).
- **Merge role: canonical base.** Every other package was ported onto it.

## Package 6 — __6_.zip (p6)
- 190 migrations; 2,351 tests claimed.
- **Arc:** Branch transfer requests + the **full Branches surface rebuild** (directory, create, manager assignment,
  hours, bulk status, device allocation, export, and an 11-state lifecycle engine that superseded the base's
  6-action one), Worker transfers (incl. cross-tenant) + Payroll sync (Workforce Oversight), Saved Views,
  **Promotions** (tenant-domain; tables renamed `tenant_promotions`/`tenant_promotion_redemptions` in the merge —
  see MIGRATION_RECONCILIATION), **AI Reports** (runs/schedules/deliveries/templates + narrative provenance),
  **Security & Compliance** (IP block rules, incidents, policies, emergency lockdowns, privileged access grants,
  data-retention rules).
- **Merge role: feature arc**, all 18 divergent migrations ported (two renamed tables).

## Package 7 — files__6_.zip → inner AI-PowerSalon-Full-Working-Handoff.zip (p7)
- Wrapper zip also carried `HANDOFF.md` + `AUDIT-LOGS-CHANGES.md`. 197 migrations; 2,346 tests claimed.
- **Arc:** **Users & Roles** (directory rebuild with tenant/branch filters, invitations with pre-auth accept link,
  access requests, users CSV export, users-scheduled reports), Booking & Check-In Monitor (events, retry attempts,
  6 sub-screens), **Merchant Accounts** (rate schedules, risk reviews, funding profiles, alerts),
  **Communications** (tenant messaging limits, message templates, provider config vault, announcements panel),
  **Smart Reminders** (templates, timing defaults, tenant overrides, flow state, channel config, plan features),
  **Audit Logs** (read-only over append-only `audit_events` + legal holds, investigations, evidence packs,
  tamper controls, export flags, retention policies).
- Its simpler `platform_announcements` migration was superseded by package 3's richer schema; an **additive
  reconciliation migration (294)** brings its columns onto the canonical table.
- **Merge role: feature arc**, 24 of 25 divergent migrations ported + 1 reconciliation.

## Same-feature overlaps found and adjudicated
| Feature | Competing packages | Winner | Reason |
|---|---|---|---|
| Branch lifecycle | p1, p3, p5, p6 | **p6** | 11-state engine + typed-name confirmation + impact summaries; superset of the others |
| Service Templates | p2, p5 | **p5** | 4-migration arc with seed/lifecycle/deployment tracking vs single migration |
| Billing invoices/credits | p2, p5 | **p5** | Full financial schema + write workflows; p2's simpler schema incompatible |
| Settlements & Deposits | p2, p4 | **p4** | Dedicated migration + write actions + exports vs read-only surface |
| Disputes | p2, p5 | **p5** | Full surface + fixtures vs read endpoints |
| platform_announcements | p3, p7 | **p3 schema + additive 294** | Both modules kept; columns united |
| promotions tables | p5 (platform-billing), p6 (tenant) | **both, p6's renamed** | Different domains; boundary preserved |
| Scheduled reports | p2 (report-builder), p7 (users export) | **both** | Different scopes, disjoint tables |
