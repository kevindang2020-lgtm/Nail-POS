# MERGE_DECISIONS.md — seven-package consolidation

_Every significant decision in the merge, with the reasoning. Companion to SEVEN_PACKAGE_COMPARISON.md and
MIGRATION_RECONCILIATION.md._

## 1. Canonical base: package 5

Selected on code evidence, not timestamps: longest valid migration chain (0–200, 201 files), the most recent
completed arcs (Membership Programs; Billing & Subscriptions with full write workflows), the broadest verified
cross-app test coverage (api 1470 · admin 291 · owner 171 · pos 158 · customer 149 · tech 82 · display 30 — all
re-verified in this sandbox before any merging), and all 7 production builds clean. Every other package was ported
onto it; port order **p1 → p4 → p2 → p3 → p6 → p7** kept the same-feature overlap pairs adjacent so each could be
adjudicated with both implementations in hand.

## 2. Merge mechanics

- **Ancestor reconstruction by hashing.** Files identical across all seven = ancestor; single-owner files copied
  verbatim; "modified by exactly one package" files copied over the ancestor copy in base; the 29 multi-modified
  files were merged individually.
- **True 3-way merges** (`git merge-file`) were used wherever a pristine ancestor copy survived in an untouched
  package (e.g. the super-admin-platform trio used package 2's copies as the base side). Context-anchored grafting
  was used for list-like registries (superAdminApi, kysely.types, rbac, app.module) — every graft verified by tsc
  and the owning arc's test suite immediately after.
- **Migration renumbering** follows the repo's own precedent (the `RENAMED` ledger in
  `apps/api/scripts/migrate.mjs`, previously used for the 126–129 collision): each arc's divergent migrations were
  appended after the base chain in port order, and every old→new filename pair was recorded in the ledger so a
  database that already applied an arc under its original numbers never re-runs it.

## 3. Same-feature adjudications (what was kept, what was dropped, and why)

### 3.1 Branch lifecycle — package 6 wins (four implementations existed)
- p1: `branch-status-core` (pause/suspend/close/reactivate/launch). p3: `super-admin-branch-status` module
  (single POST endpoint). p5 (base): `branch-lifecycle-core` (6 actions / 4 states), wired into BranchesScreen.
  p6: `branch-lifecycle-core` v2 — **11 states** (draft→…→closed incl. maintenance), required reasons, typed
  branch-name confirmation for high-risk actions, impact summaries — shipped inside p6's full Branches-surface
  rebuild (directory, create, manager assignment, transfers, hours, bulk status, device allocation, export).
- **Decision:** adopt p6's engine + trio + BranchesScreen wholesale; drop p1's three files, p3's eight-file module,
  and p5's engine + its spec (`branch-lifecycle-core.vitest.spec.ts`) — p6's superseding engine ships with its own
  two spec files (`branch-lifecycle-core.spec.ts`, `branch-lifecycle.vitest.spec.ts`), so coverage of the feature
  did not decrease; the old spec tested semantics that no longer exist. p5's two surviving platform-service
  additions (`tenantsLiveMonitor`, `revenueHourlyTodayYesterday`) and p4's `MERCHANT_APPLICATION_APPROVED`
  automation emit were re-grafted into p6's service and are covered by the platform suite (42 files green).

### 3.2 Service Templates — package 5 wins
p2's single `176_service_templates.sql` + 4-file module vs p5's 183–186 (catalog + idempotent seed + lifecycle +
deployment tracking) + screen + tests. p5 kept; p2's migration, module, screen and `superAdminServiceTemplatesApi`
dropped. p2's tables were same-name/different-columns, so porting both was impossible without collision.

### 3.3 Billing invoices & credits — package 5 wins
p2's 188/189 defined `billing_invoices` with a simple shape (`plan`, `amount_cents`, `issued_at`) plus a separate
`billing_credit_notes`; p5's 195–200 define the same table with the full financial model (subtotal/discount/credit/
tax/total/paid/due, retry_status, finalize/void lifecycle) plus `billing_credits`, discounts, payment attempts,
webhooks, KPI snapshots and export jobs — and the Billing write workflows in the base BillingScreen target that
schema. p2's 19 billing files + `BillingInvoicesPanel` + both migrations dropped. One capability p2 had that p5
does not: an automatic **recurring-invoice generator** (`billing-scheduler.service`) — it writes p2's schema, so
it was not portable as-is; recorded in REMAINING_ISSUES as a candidate future unit against the canonical schema.

### 3.4 Settlements & Deposits — package 4 wins
p4: dedicated migration (`175_settlements_deposits` → 211), actions service that **reuses the existing
SupportTickets writer** for processor cases (no parallel ticket store), deposit matching, discrepancy resolution,
CSV/XLSX/PDF exports, boundary + core specs, and its own build summary. p2: read-only overview/batches over the
migration-038 spine with flag/resolve review actions. p4 kept wholesale (module, controller, screen,
`superAdminSettlementsApi`); p2's five settlements files dropped. p2's batch flag-for-review/resolve intent is
covered by p4's `resolveDiscrepancy`/`openProcessorCase`.

### 3.5 Disputes — package 5 wins
Base already ships the full Chargebacks & Disputes surface (`ChargebacksDisputesScreen` + modals + fixtures).
p2's four `super-admin-disputes.*` files (a read-only variant living beside p5's `disputes.*` files in the same
directory) + `DisputesScreen` + `superAdminDisputesApi` dropped to avoid a duplicate module in one directory.

### 3.6 platform_announcements — both modules kept, one table
p3 (Marketing & Campaigns) and p7 (Communications) each created `platform_announcements` from the ancestor with
different columns and CHECK sets. p3's richer schema is the canonical CREATE (migration 239); the additive
reconciliation migration **294** adds p7's columns (subject, priority, recipient_roles, target_scope,
target_tenant_ids, recipient_estimate, unique idempotency_key, created_by) and widens the status/channel CHECKs to
the union, so both modules operate on one table without either being rewritten. p7's original `181_*.sql` maps to
294 in the ledger.

### 3.7 promotions — two domains, two tables
p5's applied `178_plan_addons_promotions_trials.sql` owns `promotions`/`promotion_redemptions` in the **platform
billing** domain (subscription-plan promos, referenced by plans/offers/campaigns code and seeded). p6's arc created
same-named tables in the **tenant customer-promotion** domain. Per the merchant-vs-platform-billing boundary, p6's
tables were renamed **`tenant_promotions` / `tenant_promotion_redemptions`** (migrations 257/258 + six code files);
p6's `@Controller('promotions')` route path is unchanged, so its API surface is identical.

### 3.8 Scheduled reports — both kept (different features)
p2's `super_admin_scheduled_reports`(+runs) is the Report-Builder subsystem; p7's `scheduled_reports` is the
Users-directory export scheduler with its own run-due cron endpoint. Disjoint tables, different modules, both
wired. A future consolidation of the two scheduling substrates is noted in REMAINING_ISSUES.

### 3.9 usersDashboard / branchesDashboard shapes
The platform repository merge took **p7's** `usersDashboard` shape (kpiCards, roleHealth, permissionLevels,
branchAccess, topTenants, pendingInvitations, growthDaily — what `UsersRolesScreen` renders) and **p6's**
`branchesDashboard` shape (what the rebuilt BranchesScreen renders), in both the interface and in-memory driver.

## 4. Cross-cutting merges

- **customers module/service:** p5's entitlement checks (`assertCanCreate`/`assertCapacity`) and p4's
  `CUSTOMER_IMPORT_FAILED` automation emit now coexist (constructor takes both services; DI factory provides both).
- **AdminLayout:** three independent shell upgrades were united — p4's children/sub-nav mechanism, p3's collapsible
  section headers, and p6's query-string-aware child links (search-aware active state).
- **admin API client:** p4's `getBlob` download support added to the base client.
- **App middleware:** p1's MaintenanceMiddleware runs after tenant context; p2's HealthMetricsInterceptor is a
  global APP_INTERCEPTOR; p7's two pre-auth exclusions (invitation accept, scheduled-reports run-due) are in the
  session-middleware exclude list and locked by the auth-boundary baseline spec.
- **rbac:** union of p5 (base, billing/disputes/memberships), p1 (general-settings + mobile_checkout incl. MANAGER
  grant), p4 (onboarding), p2 (integrations). p3/p6/p7 made no rbac changes (verified by hash).
- **Nav dead-link repairs while wiring:** 'AI Usage & Configuration' now points at the real
  `/ai-usage-configuration` surface (was `/ai-subscriptions`), 'System Status' at `/system-status` (was
  `/system-health`), 'Product Catalog' directly at `/product-catalog` (was a redirect), 'Merchant Accounts'
  deduplicated to p7's full surface (the old `/payment-gateways` route remains reachable), Settlements &
  Chargebacks nav entries un-disabled to their real screens, and the old duplicate `/queue-management` route
  removed in favor of p4's view-based routes.

## 5. Clean-database repairs to base seed migrations

Five p5 seed/fixture migrations assumed demo tenants existed and failed on a truly clean database
(184, 188, 189, 195, 198). Each got an existence guard (JOIN on `tenants` or an early-return `IF NOT EXISTS`
notice) so the chain applies from scratch and still seeds honestly on demo databases. Details in
MIGRATION_RECONCILIATION.md.
