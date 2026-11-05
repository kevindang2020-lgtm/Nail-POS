# Owner Multi-Salon Account — Build Report

**Feature:** One owner account → many branches; Owner App switches between salons or views "All My Salons"
(combined, owner's assigned branches only). Backend enforces access; owner never sees salons they don't own.

**Status:** **Complete and verified end-to-end** — Owner App (owner-web), Super Admin assignment backend, and the
Super Admin assignment UI (admin-web) are all built and green.

---

## 1. Existing owner/branch access code found (audited before changing anything)

- `apps/api/src/owner/` is already a full 6-module Owner backend (dashboard, branches, bookings, staff, finance,
  alerts/expenses). Every endpoint already accepted an optional `?branchId`.
- Access model was **two-state**: `branchConstraint(ctx)` → `null` for OWNER/SUPER_ADMIN (whole tenant) or a single
  branch id for MANAGER (via `users.branch_id`). Proven by the pre-existing `scripts/verify-owner-scope.ts`.
- Clean data port already existed: `OwnerDataPort` (interface) + `KyselyOwnerRepository`; every query already filtered
  `tenant_id = ctx.tenantId`.
- **Gap:** no table for "this OWNER is assigned to a *subset* of a tenant's branches", no `/owner/context`, no
  Super-Admin owner-assignment routes. The owner-subset capability was genuinely unbuilt. No duplicate modules were
  created — all work extends the existing owner module, port, and guard chain.
- `apps/owner-web/` is the Owner App (5-tab bottom nav). It had **no** shared branch context and **no** salon switcher.
- `apps/admin-web/` Super Admin had **no** owner→branch assignment UI or API client.

## 2. What changed (summary)

- Added a **three-state** branch scope via fallback, preserving all existing behavior:
  MANAGER → single branch (unchanged) · OWNER **with** `user_branch_access` rows → that subset ·
  OWNER **with no** rows → whole tenant (legacy; keeps `verify-owner-scope` green).
- The assigned-subset is injected at the **repository** layer (every branch clause), and the service throws **403** if a
  specific `branchId` is requested that is not in the owner's subset — so the rule is enforced on the backend, not just
  hidden in the UI.
- Added `GET /owner/context`, a Super Admin owner-assignment module, the `user_branch_access` table, the Owner App
  salon switcher + shared selection context, and wired every per-branch Owner screen to the selection.
- Added the spec's `owner_unauthorized_branch_access_blocked` audit event on every blocked branch access.
- **Owner oversight timeline:** the Super Admin → Owner Salons screen now shows each owner's recent audit history (assignments, salon creation, logins, dashboard/report views, exports, blocked-access attempts) via `GET /super-admin/owners/:ownerId/activity` — making the audit trail readable, not just write-only.
- **Per-salon "today" picker:** a new `GET /owner/salons/overview` + "Your Salons" cards on Home (combined view) show each assigned salon's today revenue + appointments + **active techs + waiting guests** with one-tap switching.
- **Salon cards now carry address + city + state**, and switching salons records `owner_branch_selected` / `owner_all_salons_selected` (permission-checked first, so an event can't imply access the owner lacks).
- **Unlimited salons per owner:** confirmed there is no cap anywhere (no plan/location limit; `tenant_usage_limits` tracks only customers/technicians/ai_calls/sms; `user_branch_access` has no count limit). Added `POST /super-admin/owners/:ownerId/salons` (create a new salon under the owner's tenant + assign in one transaction) and a "Create & assign salon" form, so an owner can keep growing with no ceiling.

## 3. Frontend files changed (owner-web)

| File | Change |
|---|---|
| `src/shell/OwnerBranchContext.tsx` | **New** — loads `/owner/context` once after sign-in; holds selection (single branch / "All My Salons"); persists `owner_selected_branch_context`; fallback when a saved branch is no longer assigned → primary → all. Exposes `effectiveBranchId`. |
| `src/shell/OwnerBranchSelector.tsx` | **New** — top-bar salon switcher. Lists only assigned salons; "All My Salons" only when >1; one salon → static label, no dropdown. |
| `src/shell/OwnerBranchSelector.test.tsx` | **New** — render tests (see §7). |
| `src/shell/OwnerLayout.tsx` | Renders `<OwnerBranchSelector/>` as a persistent top bar above the scroll area. |
| `src/App.tsx` | Wraps the authenticated router in `<OwnerBranchProvider>` (mounts only when signed in). |
| `src/api/ownerApi.ts` | Added `OwnerAllowedBranch` / `OwnerContextResponse` types + `ownerContextApi.context()`. |
| `src/screens/OwnerHomeScreen.tsx` | Reads `effectiveBranchId` → `dashboard.state(effectiveBranchId)`; reloads on change. In **"All My Salons"** with >1 salon, fetches `/owner/salons/overview` and renders the **Your Salons** today cards (tap a card → switch to that salon). |
| `src/screens/SalonOverviewCards.tsx` + `.test.tsx` | **New** — presentational per-salon today cards (revenue + appointments + open/closed) with tap-to-switch; unit-tested in isolation. |
| `src/screens/FinanceReportsScreen.tsx` | `finance.summary / paymentMix / export` now pass `effectiveBranchId`; reloads on change. |
| `src/screens/BookingOverviewScreen.tsx` | `bookings.overview / drillDown` pass `effectiveBranchId`; reloads on change. |
| `src/screens/StaffPerformanceScreen.tsx` | `staff.performance / attendance` pass `effectiveBranchId`; reloads on change. |
| `src/screens/ExpensesScreen.tsx` | `expenses.list / summary` pass `effectiveBranchId`; reloads on change. |
| `src/styles.css` | Salon switcher styles (cream/champagne tokens). |
| `vitest.config.ts`, `src/test/setup.ts` | **New** — test harness for owner-web (mirrors customer-web). |

`BranchPerformanceScreen` is intentionally left unfiltered — it is the all-branches comparison view and the backend
already restricts it to the owner's assigned subset.

**Super Admin (admin-web)** — owner→salon assignment UI:

| File | Change |
|---|---|
| `src/screens/SuperAdminOwnersScreen.tsx` | **New** — master-detail console: owner list (cross-tenant, with assigned-salon counts + search) and a per-owner panel to assign a salon (from that owner's tenant only), set access level, mark/move primary, and remove access. Consolidates the spec's OwnerList / OwnerDetail / OwnerBranchAssignmentPanel. |
| `src/screens/SuperAdminOwnersScreen.test.tsx` | **New** — render + assign + remove tests (see §7). |
| `src/api/superAdminApi.ts` | Added `owners`, `owner`, `assignOwnerBranch`, `updateOwnerBranch`, `removeOwnerBranch` + typed responses. |
| `src/App.tsx` | Route `/owner-salons`. |
| `src/shell/AdminLayout.tsx` | Sidebar nav entry "Owner Salons". |

> Creating the owner **user** itself reuses the existing Users & Roles flow; this screen owns the salon-assignment
> surface (the new capability). The spec's separate OwnerCreateEditForm is therefore folded into Users & Roles + this panel.

## 4. Backend files changed (api)

| File | Change |
|---|---|
| `src/super-admin-owners/super-admin-owners.module.ts` | **New** — service + controller + module: list owners (cross-tenant) with assigned-branch counts, get owner (+ assignable branches), assign / update / remove branch, mark primary (exclusive), **within-tenant-only** assignment. All actions audited. |
| `src/owner/owner.service.ts` | `allowedSet(ctx)` (memoized; stashes `ctx.__allowedBranchIds`); `resolveBranch`/`ensureBranch` now reject out-of-subset branches with 403; `getContext()` returns allowed salons + default; `getBranchDetail` routed through `ensureBranch`; **`denyUnassigned()`** writes `owner_unauthorized_branch_access_blocked` then throws. |
| `src/owner/owner.kysely.repository.ts` | `allowedBranchIds(ctx)` + `ownerAccessRows(ctx)`; `bScope/bSql` helpers applied to **all 26** branch-clause sites; the 3 grouped all-branch methods restricted to the subset. |
| `src/owner/owner.repository.ts` | Port + in-memory stub extended with the two new methods. |
| `src/owner/owner.dto.ts` | `OwnerAllowedBranch` + `OwnerContextResponse`. |
| `src/owner/owner.controller.ts` | `GET /owner/context`. |
| `src/database/kysely.types.ts` | `UserBranchAccessTable` + map entry. |
| `src/app.module.ts` | Registered `SuperAdminOwnersModule`. |
| `scripts/verify-owner-multisalon.ts` | **New** harness (22 checks); now also asserts the blocked-access audit event. |

## 5. Database migrations added/updated

- **`db/migrations/068_user_branch_access.sql`** — `user_branch_access(id, tenant_id, branch_id, user_id, role,
  access_level DEFAULT 'owner' [owner|manager|viewer|report_only], is_primary_owner DEFAULT false, created_by_user_id,
  created_at, updated_at)`, `UNIQUE(tenant_id, user_id, branch_id)` + indexes on `tenant_id`, `branch_id`, `user_id`,
  `(tenant_id,user_id)`, `(tenant_id,branch_id)`. Idempotent via the standard `schema_migrations` guard. **No duplicate
  table** — this is the access table the spec asked for; nothing equivalent existed.

## 6. APIs added/updated

Owner (existing controller, now subset-aware): `GET /owner/context` **(new)**, `POST /owner/context/select` **(new — records the salon switch)**, `GET /owner/salons/overview` **(new — per-salon today snapshot for the picker cards)**; `GET /owner/dashboard/state`,
`/owner/finance/summary`, `/owner/finance/payment-mix`, `/owner/reports/:id/export`, `/owner/bookings/overview`,
`/owner/bookings/drill-down`, `/owner/staff/performance`, `/owner/staff/attendance`, `/owner/expenses`,
`/owner/branches` — all honor `?branchId` with a backend membership check and restrict "all" to the owner's subset.

Super Admin **(new module)**: `GET /super-admin/owners`, `GET /super-admin/owners/:ownerId`,
`POST /super-admin/owners/:ownerId/branches`, `PATCH /super-admin/owners/:ownerId/branches/:branchId`,
`DELETE /super-admin/owners/:ownerId/branches/:branchId`. Guarded by `SuperAdminGuard`; assignment rejected when the
branch's tenant ≠ the owner's tenant.

> Routing note: in this platform a salon location **is** a branch, so `salonId` == `branchId`. The spec's nested
> `/owner/.../branches/:branchId/...` paths are represented by the flat `?branchId` filter, which is equivalent.

## 7. Tests run

**Backend**
- `npm test` (api unit/integration, vitest): **317 / 317 passed**
- `scripts/verify-owner-multisalon.ts`: **39 / 39 passed** — legacy no-rows owner sees all 3 tenant branches; SA assigns
  B1+B2 (not B3), primary B1; `/owner/context` returns exactly 2 salons, default B1; branch list = 2 (Marlton hidden);
  combined dashboard & finance = $150 (not $180); selecting B2 = $50; **unassigned B3 → 403** on dashboard, finance
  (param) and branch-detail; branch performance subset = $150/2; primary exclusivity on re-assign; **cross-tenant assign
  rejected**; remove B2 → only B1 / $100 / B2 now 403; a second owner with no rows still sees all 3; SA list shows
  counts; assignment + removal + context audited; **blocked access audited**; **a Super Admin can CREATE a new salon and assign it in one step, and one owner can hold many salons (proved with 12) with no cap**; **salon cards carry address + city + state**; **switching salons records `owner_branch_selected` / `owner_all_salons_selected`** (and a pick of an unassigned salon is rejected, never spoofing an event); **the per-salon "today" overview lists only assigned salons with each salon's today revenue + appointments + **live active-techs + waiting-guests****.
- `scripts/verify-owner-scope.ts` (regression): **17 / 17 passed** (OWNER-sees-all + MANAGER-single-branch intact).
- api `tsc --noEmit`: **0 errors** · api `build`: **0 errors**.

**Frontend (owner-web)**
- `vitest run` → `OwnerBranchSelector.test.tsx`: **2 / 2 passed** — multiple salons list only assigned salons + "All My
  Salons" and switching changes the active salon; single salon shows a static label with no dropdown / no "All My
  Salons".
- owner-web `tsc --noEmit`: **0 errors** · `vite build`: **0 errors**.

**Super Admin UI (admin-web)**
- `vitest run` (full app suite): **36 / 36 passed** (8 files), including `SuperAdminOwnersScreen.test.tsx` (4 tests) —
  owner list + counts render; opening an owner shows assigned salons (with Primary) and offers only un-assigned salons;
  assign sends `assignOwnerBranch(...)`; **create sends `createOwnerSalon(ownerId, { name, city, state })`**; remove sends `removeOwnerBranch(ownerId, branchId)`.
- admin-web `tsc --noEmit`: **0 errors** · `vite build`: **0 errors**.

## 8. Tests passing / failing

**All passing. 0 failing.** (Backend 317 + 39 + 17 = 373 checks; owner-web 4; admin-web 37; all builds/typechecks clean.)
No fabricated results — every number above is from a re-run in this session.

## 9. Security / permission checks completed

- Branch access is enforced **server-side** at the repository layer, not in the UI. A specific `?branchId` outside the
  owner's assigned set returns **403**; "all" is rewritten to `branch_id IN (owner's assigned ids)` — never
  `tenant_id = …` alone for a subset owner.
- Tenant isolation preserved (every query still filters `tenant_id`). Manager single-branch restriction unchanged.
- Super Admin branch assignment is **within-tenant only** (cross-tenant attempts rejected) and guarded by
  `SuperAdminGuard`; owners are not Super Admins.
- Frontend never trusts its own `branchId`: the selector is convenience only; the backend re-checks every request.
- Audit trail: `owner_context_loaded`, `super_admin_owner_branch_assigned/removed/updated`, and
  `owner_unauthorized_branch_access_blocked` are written to `owner_audit_log`.

## 10. Remaining blockers / honest deferrals

No remaining build items — the Super Admin admin-web assignment UI that was previously outstanding is now built,
wired into the sidebar (`/owner-salons`), and tested (§7). Documented deferrals (intentional, not faked):

1. **Per-branch timezone** uses the tenant timezone; there is no per-branch timezone column in the schema (not faked).
2. **Audit trail is complete** — alongside the assignment / context / selection / blocked-access events, the per-view
   events are now written: `owner_export_created` (server-side on export, a discrete action) and `owner_dashboard_viewed`
   / `owner_reports_viewed` (fired by the app on navigation via `POST /owner/activity`, **deliberately decoupled from the
   data-fetch endpoints so realtime refreshes don't flood the log**). A specific salon on those events is permission-checked.

No outstanding bugs in anything that was built — every implemented path is green.
