# Recent Tenant Activity card + full Tenant Activity page (audit + wire)

Audited the whole chain. The Recent Tenant Activity card (on Tenants/Salons **and** Overview, fed by real `audit_logs`),
the dedicated faceted Tenant Activity page (`/tenant-activity` with summary cards, search, filters, table, detail panel,
backend pagination), and the icon/severity formatter were all built in earlier sessions. This pass closed the real gaps
against the spec. **No new table, no duplicate page/route/component.**

## 1. Files changed
- `apps/api/src/super-admin-overview/overview-core.ts` (icon map)
- `apps/api/src/super-admin-tenant-activity/tenant-activity.service.ts` (+recent, +byId)
- `apps/api/src/super-admin-tenant-activity/tenant-activity.controller.ts` (+2 routes)
- `apps/api/src/super-admin-tenant-activity/tenant-activity.service.vitest.spec.ts` (+3 tests)
- `apps/admin-web/src/screens/TenantsScreen.tsx` (View All `?source=`, clickable rows)
- `apps/admin-web/src/screens/DashboardScreen.tsx` (View All `?source=`)

## 2. Frontend components fixed (reused existing)
- Recent Tenant Activity card (Tenants + Overview) — already renders newest 5 with icon, title, salon name, time-ago,
  plus loading/empty states. Made each row clickable to the full page; added a `?source=` deep-link.
- Full `TenantActivityScreen` — already has summary cards, search, event-type/category/severity/date filters, paginated
  table, and a detail panel. Unchanged this pass.

## 3. View All behavior
Both View All buttons now navigate to `/tenant-activity?source=...` (`tenants-salons-recent-activity` /
`overview-recent-activity`) via React Router `navigate()` — the existing real route, Super Admin shell preserved, no
duplicate route. The activity page already reads `tenantId` / `category` / `severity` from the URL.

## 4. Backend APIs
Added two endpoints to the **existing** SUPER_ADMIN-guarded controller (reusing the same audit_logs read-model):
- `GET /super-admin/tenant-activity/recent?limit=5&tenantId=&eventType=&severity=` — newest-first card feed, returns
  `{ activities: [{ id, eventType, title, tenantId, tenantName, salonCode, icon, severity, createdAt, ageLabel, timeAgo, … }] }`.
- `GET /super-admin/tenant-activity/:activityId` — single-activity detail (clean `{ ok:false }` on a miss).
Already present and unchanged: `GET /super-admin/tenant-activity` (filtered + backend-paginated list) and
`GET /super-admin/tenant-activity/summary`. Static routes are declared before the `:activityId` param route.

## 5. Backend services / formatting
- `recent()` and `byId()` added to `SuperAdminTenantActivityService`, both reusing `items()` → `toActivity` →
  `applyFilters` (newest-first). No new repository/SQL.
- **Icon map fix** in `activityPresentation` (shared by the card and the page): added subscription/plan rows so
  `plan_upgraded_to_enterprise → ⬆️ "Plan upgraded to Enterprise"`, `plan_upgraded → ⬆️`, `plan_downgraded → ⬇️`, and
  `subscription_created/cancelled/updated`/`billing_updated`. Previously these fell through to the default 📌 — this fixes
  the spec's example row. (🟢 tenant_created, 💳 payment_setup_completed, 📦 hardware_shipped, 🤖 ai_package_activated,
  🚚 delivered, 🖥️ installed, ✅ onboarding, 🎧 support, ⚠️ warning/payment-fail, 🔁 retry were already mapped.)

## 6. Database tables used
`audit_logs` (joined to `tenants` for salon name/code) — the single source for both the card and the page. **No new
table** — the activity feed is a formatter over audit_logs, exactly as the spec prefers.

## 7. Existing modules reused
`super-admin-tenant-activity` (core/service/controller/repo), `super-admin-overview` (`activityPresentation` +
`recentActivity` feed), the shared toast, and the existing `/tenant-activity` route + sidebar item.

## 8. Duplicate code avoided
No new activity table, feed component, route, or service — only two thin endpoints over the existing read-model, an icon
map addition, and View All wiring.

## 9–11. How to test
- **Recent card**: open Tenants/Salons (or Overview) → newest 5 events with correct icons; a plan-upgrade event shows ⬆️.
  Backend: `GET /super-admin/tenant-activity/recent?limit=5`.
- **View All**: click View All → `/tenant-activity?source=tenants-salons-recent-activity`; sidebar "Tenant Activity"
  stays highlighted; full list with search/filters/pagination/detail loads.
- **Activity creation**: the feed reads `audit_logs`, so any audited action (tenant create/activate/pause, payment setup,
  hardware ship, AI activate, plan upgrade, warning sent, support access) appears automatically — the Quick Actions and
  status routes already write those audit rows.
- Automated: `cd apps/api && npx vitest run src/super-admin-tenant-activity` (recent/byId/plan-icon covered).

## 12. Remaining setup
- The card uses the overview `recentActivity` feed (same real audit_logs data); the new `/recent` endpoint is available
  for direct consumption if you prefer the card fetch its own feed — say the word and I'll repoint it.
- `byId` resolves within the bounded recent audit window (the kysely read-model fetches most-recent rows); detail opened
  from the list is always in-window. If you need detail for arbitrarily old rows, add a `getById` SQL lookup.
- Real timestamps/trends are live audit data — nothing hardcoded.

## Verification
API: `tsc` clean; **476 tests** (+3), RESULT: PASS. admin-web: `tsc` clean; **92 tests**; `vite build` clean.
