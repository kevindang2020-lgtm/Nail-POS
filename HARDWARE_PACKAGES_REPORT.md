# Hardware Packages + tenant-scoped View All — Build/Fix Report

Audit-first. The Hardware Packages page **and** its backend already existed; this was targeted wiring, not a rebuild.
No duplicate routes, components, endpoints, or tables were created.

## What already existed (reused, not duplicated)
- **Page**: `HardwareScreen` at route **`/hardware-packages`** (sidebar item active there), wired to
  `GET /super-admin/platform/hardware` with status tabs, the package list, an inline Update editor (status / agreement /
  payment-setup, Mark Delivered / Mark Activated, serials, tenant assignment) and `+ New Package` (`createHardware`).
- **Backend**: `super-admin-platform` `hardware` list (status + search + pagination) + `createHardware` / `updateHardware`,
  over the existing **`hardware_packages`** table — all SUPER_ADMIN-guarded.

## 1. Files changed
**Backend (`apps/api/src/super-admin-platform/`)**
- `super-admin-platform.repository.ts` — added `tenantId?` to `PlatformListQuery`; the Kysely `list()` now applies a
  `tenant_id = :tenantId` filter when present (correct under pagination); the in-memory `hardware()` filters by tenant too.
- `super-admin-platform.controller.ts` — the `GET hardware` route now threads `tenantId` through.

**Frontend (`apps/admin-web/src/`)**
- `screens/HardwareScreen.tsx`
  - Reads `?tenantId` (auto-applies the tenant filter via the backend), `?status` (preselects the tab), and `?source`
    (shows a "from Tenants / Salons" note).
  - Added a **search box** (debounced, wired to the backend `search` param) and a **"Filtered to tenant … · Clear"**
    chip when tenant-scoped (clearing drops the params).
  - **Status badge colours** mapped over the real pipeline (green = installed/activated/ready, purple = delivered,
    blue = ordered, amber = pending, orange = on_hold, red = cancelled/returned, gray = not_started) plus a coloured
    **payment-setup badge**. `+ New Package` and the empty state are tenant-aware.
- `screens/TenantsScreen.tsx`
  - Detail-panel **Hardware Package card → View All** → `/hardware-packages?tenantId={sel.id}&source=tenants-salons-dashboard`.
  - Row action-menu **Hardware Package** now carries `?tenantId={r.id}` (was an unfiltered link).
- `screens/HardwareScreen.test.tsx` — new: coloured badges, the `?tenantId` deep-link filter + clearable chip, status-tab
  filtering, and search wiring.

## 2. Frontend routes
- **No new routes.** Everything uses the existing `/hardware-packages`; the sidebar highlights Hardware Packages
  automatically (the `NavLink` is active on that route). Tenant scope is carried as `?tenantId=` (+ optional `?source`).

## 3. Backend APIs
- **None added.** Extended the existing `GET /super-admin/platform/hardware` with a `tenantId` filter; reused
  `createHardware` / `updateHardware`.

## 4. Database
- **No migrations.** Reused the existing `hardware_packages` table (no `*-new` / duplicate tables).

## 5. Existing modules reused
`HardwareScreen`, `superAdminApi.hardware/createHardware/updateHardware`, the `super-admin-platform` hardware service +
repository, and the `hardware_packages` table.

## 6. Duplicate code avoided
No second hardware page, route, endpoint, or table. The tenant-scoped View All reuses the one page via a query param
rather than a parallel "view-all" screen.

## 7. How to test Hardware Packages
- `cd apps/admin-web && npx vitest run src/screens/HardwareScreen.test.tsx` (4/4); `npx tsc --noEmit`; `npx vite build`.
- Manual: open Hardware Packages from the sidebar → list loads with coloured status + payment badges; status tabs filter;
  the search box filters server-side; Update edits status/agreement/payment and Mark Delivered / Mark Activated persist.

## 8. How to test View All opening the full page
- Manual: sidebar → Hardware Packages opens the full page with the sidebar item highlighted. Any hardware link routes to
  `/hardware-packages` (kept inside the Super-Admin shell), not a popup.

## 9. How to test tenant-specific View All
- Manual: Tenants / Salons → select a tenant → detail panel → Hardware Package card → **View All** lands on
  `/hardware-packages?tenantId=<id>&source=tenants-salons-dashboard`; the list is filtered to that tenant and a
  "Filtered to tenant … · Clear" chip appears (Clear removes the filter). The row action-menu's **Hardware Package** does
  the same. Verified in `HardwareScreen.test.tsx` (the `hardware()` call receives `{ tenantId }`).

## 10. Remaining setup
- None for View All / tenant filtering. Optional follow-ups (page already functional): a `…/hardware/summary` endpoint to
  back an 8-card KPI strip (Total / Not Ordered / Ordered / Shipped / Delivered / Installed / Pending Payment / Paid Off)
  with real counts, and adopting the richer payment vocabulary (unpaid / deposit_paid / financing / partially_paid /
  paid_off / refunded). The current page maps the spec's colours over the **real** status + payment-setup vocabulary
  rather than inventing a parallel schema — say the word and I'll add the summary endpoint + payment model.

## Verification
admin-web: `tsc` clean; **75 tests pass** (incl. 4 new hardware tests); `vite build` clean.
backend: `tsc` clean; **71 files / 460 tests pass** + 21 harness suites; `RESULT: PASS`.
