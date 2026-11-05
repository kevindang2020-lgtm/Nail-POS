# Tenant Performance Report — real backend pagination/filtering/sorting

Closed the carried-forward limitation flagged in every prior report: the report table sliced a top-100 set client-side.
It now drives off a dedicated server endpoint with real pagination, filtering, sorting, and a full-set summary. Additive
— `reports()` and every other consumer are unchanged.

## Files changed
- `apps/api/src/super-admin-platform/tenant-performance-core.ts` (new — pure filter/sort/paginate/summary)
- `apps/api/src/super-admin-platform/super-admin-platform.repository.ts` (extracted shared `perfRows(cap)`; added `tenantPerformanceRows`)
- `apps/api/src/super-admin-platform/super-admin-platform.service.ts` (+`tenantPerformanceReport`)
- `apps/api/src/super-admin-platform/super-admin-platform.controller.ts` (+`GET /tenant-performance`)
- `apps/api/src/super-admin-platform/tenant-performance.vitest.spec.ts` (new — 8 tests)
- `apps/admin-web/src/api/superAdminApi.ts` (+`tenantPerformanceReport`)
- `apps/admin-web/src/screens/PlatformReportsScreen.tsx` (server-driven table)
- `apps/admin-web/src/screens/PlatformReportsScreen.test.tsx` (mock mirrors the core)

## Backend
- **New endpoint** `GET /super-admin/platform/tenant-performance` (SuperAdminGuard), query:
  `search, state, status, plan, minVolume, maxVolume, growthDirection(positive|negative|new), sortBy, sortDirection,
  page, limit`. Returns `{ rows, total, page, pageSize, totalPages, summary }` where `summary` is computed over the full
  filtered set (Total Card Volume, Transactions, Avg Tenant Volume, Top Tenant Volume, MoM Growth, Active Tenants).
- **No duplicate calc:** extracted the existing per-tenant volume/growth SQL+mapping into a shared `perfRows(cap)`.
  `reports()` still calls it with cap=100 (byte-for-byte same behavior); the report endpoint uses cap=1000 so it pages
  the full tenant set (well beyond the old 100 ceiling for this market's scale). Pure `tenant-performance-core` does the
  filter/sort/paginate/summary — fully unit-tested, no DB dependency, nulls (growth "new") always sort last.
- **No new table** — reads `tenants` + `payments` (approved, month-bucketed) as before.

## Frontend
`TenantPerformance` now fetches from the endpoint on every change to search (debounced), the State/Status/Plan/Growth
filters, column sort, page, and rows-per-page — true backend pagination, not client slicing. Loading indicator, error +
Retry, and empty states included; the deep-link `sortBy`/`sortDirection` from "View Full Report" is honored. First paint
falls back to the consolidated `reports()` rows already in hand so there's no empty flash; on endpoint error it shows
Retry. The 6 summary KPI cards read the server summary. Row action menu (View Tenant / Billing / Reports / Gateway /
Hardware) unchanged.

## How to test
- `cd apps/api && npx vitest run src/super-admin-platform/tenant-performance.vitest.spec.ts` (filter/sort/paginate/summary + service).
- UI: open `/platform-reports?report=tenant-performance` → type in search, pick State/Status/Plan/Growth, click column
  headers, page through — each round-trips to the backend; "Showing X–Y of Z" and the summary reflect the full filtered
  set. From Top Performing Tenants → "View Full Report" the sort arrives via `?sortBy=monthlyCardVolume&sortDirection=desc`.

## Verification
API: `tsc` clean; **487 tests** (+8); `RESULT: PASS`. admin-web: `tsc` clean; **93 tests**; `vite build` clean.
(One unrelated HardwareScreen test flaked under parallel load and passed in isolation — not a regression.)
