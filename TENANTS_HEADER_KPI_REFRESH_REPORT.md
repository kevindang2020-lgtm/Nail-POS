# Tenants / Salons — header, Refresh, and 6 KPI cards (audit + wire)

Audited against the spec. The page title, "{N} tenants on platform" subtitle, the toast system, and all six KPI cards
(with trend-by-meaning colors) already existed and were wired to real endpoints. This pass closed the three genuine gaps
— **Refresh button, clickable KPI navigation, and `?status=` URL sync** — and wired the KPI trends to the real
month-over-month deltas. All frontend; no new endpoint, table, or component.

## 1. Files changed
- `apps/admin-web/src/screens/TenantsScreen.tsx`
- `apps/admin-web/src/screens/TenantsScreen.test.tsx` (+3 tests)

## 2. Frontend components added/fixed
Reused the existing `TenantsScreen` header + KPI cards. Added:
- **↻ Refresh button** in the header — disabled + "↻ Refreshing…" while running; success toast
  ("Tenants / Salons data refreshed."), error toast ("Unable to refresh Tenants / Salons data."). `doRefresh` refetches
  the summary + table (preserving current filters / sort / page / selected tenant) **and** the overview-fed cards
  (Pending Applications, Monthly Card Volume, Recent Activity, Recent Applications, Top Performing Tenants) via
  `Promise.all`. `load()` now returns its promise so Refresh can await.
- **Clickable KPI cards** (role=button, keyboard-accessible).

## 3. Route / query navigation
- Total Tenants → clears the status filter (and removes `?status`).
- Active Salons → status filter `active` + `?status=active`.
- Paused Tenants → status filter (tab `suspended`) + `?status=paused`.
- Trial Tenants → status filter `trial` + `?status=trial`.
- Pending Applications → `/tenant-applications`.
- Monthly Card Volume → `/platform-reports?report=tenant-performance&period=current-month`.
- **`?status=` sync**: the page reads `?status=` on load (`paused→suspended`, `pending→setup`, …) and sets the filter;
  KPI clicks update the URL (replace) so the filter survives reloads/deep-links; **Clear Filters** removes `?status`.
  Filters/search/sort/pagination already preserve the active status filter (it's part of the query).

## 4. Backend APIs
**None added — reused.** `GET /super-admin/tenants/state` already returns the summary KPIs + table + pagination in one
call (the spec's `/tenants/summary` is satisfied by this), and `GET /super-admin/overview/state` supplies the two
cross-cutting KPIs (Pending Applications, Monthly Card Volume) + the bottom cards. Both are `SUPER_ADMIN`-guarded.

## 5. Backend services / calculations
Unchanged. The real month-over-month trends come from the existing overview snapshot deltas
(`overview_monthly_snapshots`). KPI trend wiring now uses them: **Total Tenants, Active Salons, Pending Applications,
Monthly Card Volume** show real `▲/▼ x% vs last month` with **trend-by-meaning** colors (down = good for Pending/Paused).

## 6. Database tables/models used
`tenants`, `tenant_subscriptions`, `tenant_payment_config`, `tenant_applications`, `payments`, `audit_logs`,
`overview_monthly_snapshots` — all existing. **No new table** (no `tenant_summary_monthly_snapshots` — the overview
snapshot already provides MoM deltas).

## 7. Existing modules reused
`super-admin-tenants` (state/KPIs/table), `super-admin-overview` (cross-cutting KPIs + snapshot trends + bottom cards),
the shared toast, and the screen's existing filter/sort/pagination state.

## 8. Duplicate code avoided
No second tenants page, KPI component, summary endpoint, route, or table.

## 9–12. How to test
- Header/subtitle: load Tenants / Salons → "Tenants / Salons" + "{totalItems} tenants on platform" from the backend.
- KPI cards: `cd apps/admin-web && npx vitest run src/screens/TenantsScreen.test.tsx` (11/11). Manually: each card shows
  the real value; Total/Active/Pending/Monthly show real MoM % once a snapshot exists.
- Refresh: click ↻ Refresh → button disables, both `state` + overview refetch, success toast; covered by a test.
- Click navigation: click Active/Paused/Trial → table filters + `?status=` updates (tests cover Active + `?status=paused`
  init); Pending Apps and Monthly Card Volume navigate to their pages.

## 13. Remaining setup
- Real MoM percentages need the overview snapshot job to have run at least once (`POST /super-admin/overview/snapshot`);
  until then trends render "vs last month" (honest null, not faked).
- **Paused / Trial** have no MoM delta in the current snapshot, so those two cards show "vs last month". If you want real
  trends there, add paused/trial counts to the overview snapshot capture and I'll wire them.

## Verification
admin-web: `tsc` clean; **91 tests** (+3); `vite build` clean. Backend unchanged (473 tests, RESULT: PASS).
