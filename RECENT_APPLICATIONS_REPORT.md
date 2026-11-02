# Recent Tenant Applications + View All — Build/Fix Report

Audit-first. The Recent Applications card **and** the full Tenant Applications page already existed and were wired to real
data — so this was a targeted fix, not a rebuild. No duplicate routes, components, endpoints, or tables were created.

## What already existed (reused, not duplicated)
- **Card**: the "Recent Applications" card on `TenantsScreen` (bottom-right of Tenants / Salons), fed by the real
  `GET /super-admin/overview/state` → `recentTenantApplications` (backed by the `tenant_applications` table, newest first).
- **Full page**: `ApplicationsScreen` at route **`/tenant-applications`**, wired to
  `GET /super-admin/platform/applications` (status filter + backend `search` + pagination params), with per-row actions
  (Mark Reviewing/Qualified/Demo, Approve, Archive), notes (`applicationNote`), and Convert-to-Tenant that reuses the
  existing Create Tenant flow then `applicationConverted` (no duplicate tenant-creation path). Sidebar highlight is
  automatic (the `NavLink` for Tenant Applications is active on this route).

## 1. Files changed
- `apps/admin-web/src/screens/TenantsScreen.tsx`
  - Added `appBadge()` (per-status colours: New→purple, Review/Reviewing/Demo→amber, Approved/Qualified/Converted→green,
    Rejected→red, Waiting Documents→orange, Archived→grey) and `agoLabel()` (relative submitted time).
  - Rebuilt the Recent Applications card: rank · salon · applicant · city, state · **submitted time** · **colour-mapped
    status badge** (was a single hardcoded blue badge with no time). Loading/empty states retained.
  - **View All** and row click now navigate to `/tenant-applications?source=tenants-salons-dashboard` (rows add
    `&focus=<id>` to deep-link the application).
- `apps/admin-web/src/screens/ApplicationsScreen.tsx`
  - Reads `?status` (preselects the status tab), `?source` (shows a "from Tenants / Salons" context note), and `?focus`
    (auto-opens that application's detail).
  - Added a header **search box** wired to the existing backend `search` param (debounced); refined the header copy to
    "Review and manage new salon onboarding applications."
- `apps/admin-web/src/screens/TenantsScreen.test.tsx` — seeded an application into the overview mock + added a card test
  (renders application, colour-mapped badge, submitted time, source-aware View All).

## 2. Frontend routes
- **No new routes.** View All uses the existing `/tenant-applications` (the Super-Admin app's Tenant Applications page),
  with a `?source=tenants-salons-dashboard` context param.

## 3. Backend APIs
- **None added.** Reused `GET /super-admin/platform/applications` (status + search + page/limit), plus the existing
  `applicationStatus` / `applicationNote` / `applicationConverted` actions — all already SUPER_ADMIN-guarded.

## 4. Database
- **No migrations.** Both card and page read the existing `tenant_applications` table.

## 5. Existing modules reused
`ApplicationsScreen`, `superAdminApi.applications/applicationStatus/applicationNote/applicationConverted`, the
`super-admin-platform` applications service, the overview endpoint, and the existing Create Tenant flow for conversion.

## 6. Duplicate code avoided
No `*-new` / `*-copy` routes; no second applications list, endpoint, or table. The card and full page share the same
`tenant_applications` source and status vocabulary.

## 7. How to test — Recent Tenant Applications card
- `cd apps/admin-web && npx vitest run src/screens/TenantsScreen.test.tsx` (7/7, incl. the card test).
- Manual: open Tenants / Salons → the card lists the newest applications with colour-mapped badges + submitted time;
  empty/loading states show when there's no data / while loading.

## 8. How to test — View All opening the full page
- Manual: click **View All** → lands on `/tenant-applications?source=tenants-salons-dashboard`; the sidebar highlights
  Tenant Applications; the header notes it came from Tenants / Salons; search + status tabs + row actions all work.
  Clicking a card row deep-links with `&focus=<id>` and auto-opens that application.
- `cd apps/admin-web && npx vitest run src/screens/ApplicationsLeads.test.tsx` (5/5); `npx tsc --noEmit`; `npx vite build`.

## 9. Remaining setup
- None for the card / View All. Optional future polish on the full page (already functional): dedicated summary KPI
  cards and a date-range filter (a `GET /super-admin/tenant-applications/summary` endpoint would back the KPI strip).
  Status vocabulary follows the existing pipeline (new/reviewing/qualified/demo_scheduled/approved/converted/archived)
  rather than inventing a parallel set.

## Verification
admin-web: `tsc` clean; **71 vitest tests pass** (12 files); `vite build` clean. Backend unchanged this pass.
