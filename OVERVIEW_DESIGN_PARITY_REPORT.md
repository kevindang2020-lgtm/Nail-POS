# Overview — design-parity fix (against the uploaded screenshot)

Audited the Super-Admin Overview (`DashboardScreen`) against the design. It was already structurally complete and fully
wired — every section reads `GET /super-admin/overview/state` (real DB). Two visual gaps were closed; nothing duplicated.

## Files changed
- `apps/admin-web/src/screens/DashboardScreen.tsx` — added colored icons to all 7 KPI cards + 6 platform KPI cards
  (🏢 🛍️ 📋 💳 💲 🎧 💚 / 👤 📍 🧑‍🔧 👥 📅 🧠), rendered via the existing `.kpi .top .ico` badge style. KPI values, trends
  (colour-by-meaning), and click-through routes were already wired and unchanged.
- `apps/admin-web/src/shell/AdminLayout.tsx` — added the two top-bar notification bells from the design: 🔔 **Alerts**
  (badge = real unread count via `GET /super-admin/alerts/unread-count`, opens `/alerts`) and 💬 **Support sessions**
  (badge = active support sessions from platform counts, opens `/support-access`). Badges hide at zero; failures never
  block the shell.

## Already present + wired (verified, unchanged)
7 KPI cards, Monthly Sales Volume chart (Day/Week/Month/Year), Tenants-by-Status donut (legend + counts + %), Recent
Alerts (View All → /alerts), free-hardware banner, Recent Tenant Applications (View All), Hardware Packages donut,
Top Performing Tenants (View Full Report), Quick Actions (permission-gated), 6 platform KPIs, Recent Tenant Activity,
top-bar search + Create Tenant + Add Lead, sidebar with live badges + v2.4.1 status card.

## No duplication
No new route, endpoint, component, or table. Icons are presentation only; the bells reuse the existing alerts
unread-count and platform-counts endpoints.

## Verification
admin-web: `tsc` clean; **84 tests pass** (15 files); `vite build` clean. Backend unchanged (463 tests, RESULT: PASS).
