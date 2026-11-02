# Top Performing Tenants card + Tenant Performance Report (audit + wire)

Audited the whole chain. The Top Performing Tenants card (Tenants/Salons), the full Tenant Performance Report
(`/platform-reports?report=tenant-performance`), and the real backend volume/growth/avg-ticket/ranking calc were all
built in earlier sessions. This pass closed the two real gaps. **No new table, no duplicate page/route/component.**

## 1. Files changed
- `apps/api/src/super-admin-platform/super-admin-platform.service.ts` (+topPerformingTenants)
- `apps/api/src/super-admin-platform/super-admin-platform.controller.ts` (+route)
- `apps/api/src/super-admin-platform/top-performing.vitest.spec.ts` (new, +3 tests)
- `apps/admin-web/src/screens/PlatformReportsScreen.tsx` (URL sort init)

## 2. Frontend components (reused existing — verified, not rebuilt)
- **Top Performing Tenants card** (Tenants/Salons): rank, avatar, salon name, city/state, monthly card volume, growth %
  (green up / red down, "New" when no prior baseline); rows click-select the tenant; loading + empty ("No volume yet.")
  states. Fed by the real overview `topPerformingTenants` feed.
- **Tenant Performance Report** (`PlatformReportsScreen` → `TenantPerformance`): header + description, the 6 spec summary
  KPI cards (Total Card Volume, Transactions, Avg Tenant Volume, Top Tenant Volume, MoM Growth, Active Tenants), search,
  a sortable table (rank, tenant/salon, city/state, plan, status, monthly volume, txns, avg ticket, growth, actions),
  rows-per-page + prev/next pagination, and an actions menu (View Tenant / Billing / Reports / Gateway / Hardware).
  **Fix this pass:** the table now initializes its sort from the URL (`sortBy`/`sortDirection`), so the "View Full
  Report" deep-link is honored (defaults remain monthly card volume, desc).

## 3. View Full Report behavior
Already correct and unchanged — the card's button navigates (React Router) to
`/platform-reports?report=tenant-performance&period=current-month&sortBy=monthlyCardVolume&sortDirection=desc&source=top-performing-tenants-card`,
the exact spec route; the report auto-highlights/scrolls into view, Super Admin shell + Platform Reports sidebar stay
active.

## 4. Backend APIs
- **Added** `GET /super-admin/platform/top-performing-tenants?limit=5` (SUPER_ADMIN-guarded) — the spec's card feed,
  returning `{ tenants: [{ rank, tenantId, salonName, salonCode, city, state, monthlyCardVolume,
  formattedMonthlyCardVolume, growthPercent, trendDirection }] }`. It reuses the **same** ranked `tenantPerformance` the
  full report computes (no new query). (The project already serves this data family under `/super-admin/platform/*`; the
  spec's preferred `/super-admin/tenants/top-performing` path is an alias of this existing-architecture route.)
- **Unchanged (already present):** `GET /super-admin/platform/reports` returns `tenantPerformance` (the full ranked
  report) + platform totals, consumed by the report page.

## 5. Backend services / calculations
`topPerformingTenants(limit)` added to `SuperAdminPlatformService`, wrapping `repo.reports()`. The underlying calc in
`super-admin-platform.repository.ts` already matches the spec exactly: monthly card volume (sum approved payments this
month), prior-month volume, growth `prior>0 ? ((cur-prior)/prior)*100 : (cur>0 ? null : 0)`, transaction count, average
ticket `cur/txn`, ranked by volume desc. No calc duplicated.

## 6. Database tables used
`tenants` + `payments` (status='approved', month-bucketed) — existing. **No new table** (no
`tenant_card_volume_reports` needed; the payments table supports the calc).

## 7. Existing modules reused
`super-admin-platform` (reports service/repo/controller), `super-admin-overview` (card feed), `PlatformReportsScreen`.

## 8. Duplicate code avoided
No new report page, table, route, service, or table — one thin endpoint over the existing computation + a URL-sort init.

## 9–10. How to test
- **Card**: open Tenants/Salons → bottom-right "Top Performing Tenants" shows the top 5 by monthly card volume with
  growth %; click a row → that tenant is selected in the detail panel. Backend:
  `GET /super-admin/platform/top-performing-tenants?limit=5`.
- **View Full Report**: click it → `/platform-reports?report=tenant-performance&…&sortBy=monthlyCardVolume&sortDirection=desc`;
  the Tenant Performance Report scrolls into view with the 6 KPI cards, sortable table (try clicking Growth/Txns headers),
  search, and pagination; the URL sort is applied on open.
- Automated: `cd apps/api && npx vitest run src/super-admin-platform/top-performing.vitest.spec.ts` (mapping/slice/trend).

## 11. Remaining setup
- The card reads the overview `topPerformingTenants` feed (same real data); the new `/top-performing-tenants` endpoint is
  available if you'd prefer the card fetch its own feed — say the word and I'll repoint it.
- Volume/growth are live from approved `payments`; values are real (empty until payments exist — never fabricated).
- The report table's search/sort/pagination run client-side over the ranked top-100 the backend returns; if you want
  full backend pagination/filtering beyond the top-100, that's a larger report-service change — flag it and I'll do it.

## Verification
API: `tsc` clean; **479 tests** (+3), RESULT: PASS. admin-web: `tsc` clean; **92 tests**; `vite build` clean.
