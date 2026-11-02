# Services & Products · Service Categories · Service Pricing · Add-Ons — screen rebuilds (Oct 30 2026)

This work follows nine guides. Five of them (*Membership*, *Discounts*, *Products*, *Inventory*, *Suppliers*) are byte-identical
to guides already built in 89bb4c18, 70f7d2a6 and 85682f9f, so nothing new was needed for them. The four new guides are built
here, in the Front Desk POS (EN + VI):

* Services & Products — `/services`
* Service Categories — `/tenant/services/categories`
* Service Pricing — `/tenant/services/pricing`
* Add-Ons — `/tenant/services/add-ons`

Safety constraints held throughout:

* Nothing was pushed; K-12 steps 1–5 (SECURITY_REMAINING_ACTIONS.md §A) are still open.
* No secrets, no payments, no SMS or email, no seeded production data, no cross-tenant reads.
* Nothing is fixed automatically: odd category names and mis-filed services are flagged for a person.

## Why the photos showed what they showed

* **Branch Overrides were fake.** The old panel read a `demo_branchOverrides` cookie seeded with "Uptown +10%" and applied it to
  every displayed price. No override table exists. Every branch keeps its own `services` rows (`services.branch_id` is NOT NULL),
  so the panel now shows each branch's own row for the service (matched by name): price, time and status. Configure edits the
  row of the branch you are in. That cookie is gone.
* **"Export Data" did not export.** It toggled the CSV import. Export now runs the real async services export
  (`@AsyncExport pos.services.export`). Import is a separate Import Catalog dialog: preview first, then commit.
* **Revenue charts used menu prices.** Service Mix, Category Revenue and Top Category added up list prices. They now use realized
  revenue: paid ticket lines (`ticket_service_lines.line_total_cents`, line not removed, before refunds) in the period. Top
  Category falls back to menu value only when the period has no sales, and says so.
* **KPIs without data.** Retail Revenue Today and Add-On Conversion are now real (retail lines on today's paid tickets; paid
  tickets with an add-on ÷ paid tickets with a service). Service Mix Margin is still "—", because no service cost is recorded
  anywhere. Package Sales is still "—", because bundle sales are not ticket lines of their own; the active bundle count is shown
  instead.
* **Pricing KPIs counted page 1.** Average, Lowest and Highest were worked out from the first page of `/pos/services/state`.
  They now come from one server aggregate over the whole catalog (active services with a price), and say so. When a filter is on,
  each card also shows what the filtered list holds.
* **Categories: CD 4432 / CD 6805 and Haircut under Nails.** These are real data. They are flagged in Review notes (a code-like
  name, a hair service in a nails category). Nothing was renamed or moved.
* **Add-ons: French tips four times.** That is ONE add-on (`add_on_key` ao_french) offered on four services: four offerings of
  one definition. The cards count offerings, and say how many definitions. The rows on Haircut and Hair Coloring carry a
  "Review" flag (a nail add-on on a hair service). They are kept.
* **Price history did not exist.** `ServicesService` kept an in-memory audit array. Migration 718 adds `catalog_change_log`,
  which is append-only (a trigger refuses UPDATE and DELETE) and written in the same transaction as the change.

## Backend

* **Migration** `apps/api/db/migrations/718_catalog_change_log.sql` (expand-only): the `catalog_change_log` table with its
  append-only trigger, plus three indexes (`services` and `service_categories` scope by created, `service_add_ons` by key).
* **`modules/catalog/src/catalog-screens/`**
  * `catalog-change-log.ts`: `diffFields` and `recordCatalogChanges` (one row per changed field).
  * `catalog-screens.repository.ts`: the read model and the audited writes. Raw parameterised SQL, tenant literal in every WHERE,
    fixed ORDER BY maps.
  * `catalog-screens.controller.ts`: `@Controller('pos/catalog')`, 19 routes (see the table below).
* **Services writes now record history.** `services.kysely.repository.ts`: `update`, `setStatus`, `updateCategory` and
  `archiveCategory` take FOR UPDATE before-values and write `catalog_change_log` in the same transaction. `archiveCategory` no
  longer archives a category that still has active services unless it is confirmed.
* **Add-ons are never attached to every service by default.** `service-add-ons.service.ts` `create` now requires `serviceIds`.
* **New error codes** (api-contracts + POS EN/VI): `CATALOG_EDIT_CONFLICT` (409, REFRESH), `CHANGE_REASON_REQUIRED`,
  `CATEGORY_REASSIGN_EMPTY`, `CATEGORY_REASSIGN_TARGET_INVALID`, `ADD_ON_SERVICES_REQUIRED`, `ADD_ON_DUPLICATE` (409),
  `ADD_ON_NOT_FOUND`.

| Route | Permission (legacy key → catalog key) |
|---|---|
| GET dashboard · charts · services · services/:id · history · categories/summary · categories · categories/:id · add-ons/summary · add-ons/usage · add-ons · add-ons/:key | pos.services.view → services.view |
| PATCH services/:id/pricing (reason + expectedUpdatedAt; 409 on a newer save) | pos.services.pricing.edit → services.edit |
| POST categories/:id/reassign (preview, then confirm with a reason) | pos.services.edit → services.edit |
| POST add-ons · PATCH add-ons/:key (scope definition \| offering) · POST add-ons/:key/archive · /restore | pos.services.edit → services.edit |
| GET customer-history (masked phone; what was actually charged) | customers.view |

## Frontend

* `api/posCatalogApi.ts`, plus `posServicesApi.exportCsv`.
* `screens/catalogShared.tsx`: formatting, Donut / Bars / Gauge, `CustomerHistoryTable`, `ChangeHistoryTable`,
  `EditPricingDialog` (reason required; sends the version the editor opened) and `ServiceDialog`.
* **`POSServicesScreen`**, in the blueprint's order:
  * header: Refresh · Export Data · Import Catalog · Add New;
  * one search with a scope (everything · services · products · customer history · technician) and a period with its date
    field;
  * ten KPIs (2 × 5);
  * Service Menu | Retail Product Catalog, each with its own pager and View All;
  * Bundles (real `/pos/bundles`, with a New Bundle dialog) | AI Insights | Inventory Alerts (the canonical Stock Alerts set);
  * Service / Product Detail (toggle, Edit, Edit Pricing, qualified technicians) | Branches;
  * four realized charts;
  * eight Quick Actions.
* **`POSServicePricingScreen`**:
  * four whole-catalog cards;
  * tabs Price List | Price History | Customer History;
  * filters: category, status, online and sort;
  * Details (Overview · Price History · Branches) and Edit Pricing;
  * the honest note that a price takes effect when saved (no future-dated prices, because nothing would apply them).
* **`POSServiceCategoriesScreen`**:
  * the two cards, the chart and the Breakdown from one aggregate;
  * Review notes;
  * search (category or service), plus a Customer History mode;
  * the paged Category Directory;
  * Details (Overview · Services · History) with Manage Services (pick services, target and reason → preview → move);
  * New / Edit / Archive (warns about active services) / Restore.
* **`POSServiceAddOnsScreen`**:
  * four cards (offerings, with a definitions sub-line) and the eight columns with Edit / Archive / Restore;
  * tabs Add-Ons | Customer Add-On History;
  * Details (Overview · Assignments · Pricing · Usage · Audit);
  * Edit with a scope (this offering vs the add-on everywhere) and a reason;
  * New with a required service pick and a duplicate-name check;
  * the Back to Services / Categories / Pricing links.
* **Permissions are checked with catalog keys** (`services.view`, `services.edit`, `customers.view`, `inventory.view`,
  `inventory.create`). Principals hold catalog keys, not the legacy `pos.services.*` names.
* **i18n.** The `ns/catalogscreens` namespace has 395 keys (EN + VI). The VI review list is
  `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` §A43. Add-on is "Dịch vụ thêm" throughout, including the three new error strings.

## Verification

* **pgtest stand-in:** `catalog-screens.pgtest.vitest.spec.ts` 10/10, including the new technician scope. Regressions:
  services-core 55/55, v5-coded-refusals 3/3, service-add-ons 4/4, category-status 2/2. service-add-ons-authority fails 1/3
  both before and after this change (a stand-in builder limit).
* **Harness** (`tooling/catalog-one-screen`). `extra.mjs` reshapes the catalog into the photo's: six services at $398 (average
  $66.33, lowest $45, highest $150), Nails 4 / CD 4432 1 / CD 6805 1, French tips on four services, Voorhees' Gel Manicure at
  $60, and paid tickets with service, add-on and retail lines.
  * `measure.mjs` — 60/60 PASS (5 pages × 4 viewports × pilot:en / pilot:vi / empty:en): no sideways scroll, every module
    painted, 44 px targets.
  * Regression E2E on the same harness after the reshape: products, inventory, suppliers and discounts 33/33.
  * `interact.mjs <label> catalog` runs 10/10 E2E steps: KPIs against the API, branch rows, phone search in three formats, the
    technician scope, Create Bundle, whole-catalog cards under a filter, a reason required, 50 min kept, the history row, a
    stale save refused with 409, the review flags, Manage Services (prices unchanged, history with the reason), an offering-only
    edit, a required service pick, and archive / restore of one offering.
* **Harness-only stand-ins, said in `extra.mjs`.** AI menu insights answer "not enough data". Bundles run on the module's
  in-memory adapter, because the test database's Kysely stand-in has no query builder. For the same reason, creating a service
  from the harness fails there (KyselyServicesRepository.create uses the builder); it works on a real database.
* **Unit tests.** `POSCatalogScreens.test.tsx` is new. The old `POSServicesScreen.test.tsx` and the pricing / categories cases in
  the shared files are replaced. They were not run here (no vitest in this sandbox).
* **Gates.** openapi manifest, attack-surface, db-ownership (only the existing `retention_sms_*` rule) and error-text sync were
  regenerated. `run-gates.mjs`: the 12 remaining failures are the known environment baseline (check:sql, types-drift,
  sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture tests,
  frontend builds, app types). list-queries (dashboard and charts allowlisted as not-a-list), as-any, dead-client
  (`posTechniciansApi.qualified` is wired again, as "Available now" in Service Detail) and pos-i18n are green.

## Open / next

* A per-branch override engine (one service, branch-specific price) does not exist; it would need a schema change and a decision.
* Package Sales needs checkout to record a bundle sale as its own line.
* Service Mix Margin needs a service cost model (labour plus product recipe cost).
