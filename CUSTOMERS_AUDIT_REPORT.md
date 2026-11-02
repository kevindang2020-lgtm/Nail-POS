# CUSTOMERS_AUDIT_REPORT.md — POS Customers (2026-07-03)

_Audited the Customers screen (753 lines) — one of the modules the checklist explicitly names. Applied the
lint-first + dead-control sweep that surfaced orphaned surfaces on the queue-stage screens. Customers came back
essentially clean: no orphaned handlers, no dead dropdowns, no unguarded crashes — every filter, the CRUD, CSV
import/export, and duplicate merge are wired to real endpoints. Removed one redundant declaration and added coverage
for the substantive flows. Numbers are fresh runs on this tree._

## 1. Modules and boxes found in the picture / screen
9-KPI strip (Total, New Today, Returning Today, VIP, Birthdays This Month, Inactive, Duplicate Profiles, Loyalty
Members, Average Spend) · search + filter row (status / tags / groups / sources / loyalty tier / spend band) ·
category tabs (All / At Risk / …) · Add Customer · Import CSV / Export · customer table with pagination · duplicate
detection + merge panel · per-customer profile drawer (Overview / Loyalty & Membership / Visits / Notes &
Preferences) with inline edit and Save.

## 2. Problems discovered
- **One redundant declaration:** a `notes` const was destructured from the profile detail but never used — the
  Notes & Preferences tab reads/edits/saves an editable copy (`eNotes`, seeded from `d.notes` and persisted via the
  real `PATCH /notes` endpoint). Dead code, not a functional gap.
- No orphaned handlers, no UI-only dropdowns, no unguarded `.length` crashes. Every filter drives a real
  `GET /pos/customers/state` refetch; CSV import (preview + commit), export, duplicate merge, create, update, tags,
  and notes all hit real endpoints with validation (verified against the code and backend suite, not assumed).

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSCustomersScreen.tsx` — removed the redundant `notes` destructure (the lone lint
  warning). No behavioral change; the Notes tab already used `eNotes`.
- `apps/pos-web/src/screens/POSCustomersScreen.test.tsx` — +3 tests.

## 4. Backend files fixed
**None.** `GET /pos/customers/state` applies `search` / `status` / `segment` / `source` / `tag` / `loyaltyTier` /
`spendBand` / pagination; `/customers` (create), `/:id` (update), `/:id/tags`, `/:id/notes`, `/export`,
`/import/preview`, `/import/commit`, `/duplicates`, and `/duplicates/:id/merge` all exist and are covered by the
backend suite. All behind `TenantAuthGuard + RolePermissionGuard`, session-derived tenant/branch.

## 5. Routes and APIs repaired
None. No dead or misrouted calls found — the API client was already reconciled to the real routes (its own header
comment notes a prior `/merge` correction to `/duplicates/:id/merge`).

## 6. Database changes
None. All reads/writes are tenant + branch scoped; money stays integer cents.

## 7. How each module is wired
Filters + search → debounced `load(buildQ())` → `GET /pos/customers/state?…` → guarded controller → service → repo
(tenant+branch scoped, applies every facet) → table + KPIs + summary cards + right rail re-render. Add/Edit →
`create` / `update` → refetch. Import CSV → file input → `importPreview` (detected columns + create/update/skip
counts) → `importCommit` → refetch + reload duplicates. Duplicates → `duplicates()` lists server-detected groups →
pick a primary radio → `merge(groupId, primaryCustomerId)` → refetch. Profile drawer → `getDetail` → per-tab edit →
`update` / `setNotes` (real endpoints).

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Customers screen **9/9** (6 prior + 3 new: status filter refetches `status=`, search refetches
  `search=`, duplicate merge posts to `/duplicates/:id/merge`). Full pos-web **288/288 across 64 files**; the lone
  exit-1 is the pre-existing jsdom `scrollIntoView` notice from POSBookingScreen.test.tsx — unrelated. Backend
  customer suite **86/86 across 13 files** confirms the state filters, import, merge, and notes endpoints.
- **Lint:** POSCustomersScreen.tsx + its test → **0 warnings, 0 errors** (was 1 warning).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- The CSV import commit path goes through a hidden file input + FileReader, which jsdom doesn't drive cleanly; I
  covered import **preview** (existing test) and the merge/filters directly, and left commit to the backend suite +
  the preview UI test rather than write a brittle FileReader simulation.
- Filters/merge/CRUD verified against the in-memory adapter + backend suite; not exercised against live Postgres this
  session.
- The screen is feature-complete against the reference; no fabricated data or placeholder controls were found to
  remove.
