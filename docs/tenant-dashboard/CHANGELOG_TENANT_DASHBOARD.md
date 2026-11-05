# Changelog — Tenant POS Dashboard

## Rebuild to reference image (Option A: match the mockup module-for-module with honest real data)
- **Scan result:** screen + routes (`/tenant/dashboard`, `dashboard`) + consolidated backend (`GET /pos/dashboard/state` → `POSDashboardState`) already existed. No duplicate created; the canonical screen was rebuilt in place and the canonical aggregate extended. No Stripe/Square reintroduced (Fiserv/Clover only).
- **Backend (apps/api/src/dashboard):** the aggregate had a standing note that its T02 modules were "authored against the schema but NOT executed against live Postgres." **Verified the whole aggregate against the live cluster for the first time** (insert/update-rollback), and enriched it:
  - `TopTechnician` gained `servicesCount`, `utilizationPercent` (null when unscheduled), `tipsCents`, `rating` (null when unrated) — all real.
  - `RevenueTrend.series` gained `apptCount` (7-day dual axis: payments + appointments).
  - New `OperationsSnapshot` (waiting/est-wait, walk-ins/%, ready-for-checkout/$ value, completed services, no-shows/%, upcoming-next-3h) — all real.
  - In-memory dev/test seed + `emptyDashboard` updated to match the new shape.
- **Frontend (POSDashboardScreen.tsx):** rebuilt the body to the picture's exact 11-module layout (9-KPI strip → Operations Snapshot 6 tiles · Live Salon Activity · AI Insights → Revenue & Appointments dual-line · Top Technicians 6-col → Top Services donut · Customer Retention donut · Payment Mix donut · Multi-Location → 9 Quick Actions) using the existing cream/gold design tokens. Two KPI labels aligned to the picture ("Average Ticket", "Staff On Duty"). Added CSS for the new layout classes; no new colors introduced.
- **Verified live (date 2026-06-21 seed):** revenue $100 temp, dual-line $100/5appt, top tech (rev $40 · 1 svc · 22% util · $15 tips · 5★), operations (ready $105 · 2 walk-ins/50% · 1 completed), retention (4 customers) — all correct, rolled back clean.
- **Tests:** api 112 files/733 tests + tsc clean; pos-web 41 files/107 tests + build + tsc clean.

### Known honest gaps (not invented)
- Predictive AI insight cards (peak-time/upsell/rebooking forecasts) require an ML layer — shown as an honest note under the real deterministic signals.
- "Today" seed is empty (seed data lives on 2026-06-21), so live KPIs render honest zeros until real same-day data exists.
