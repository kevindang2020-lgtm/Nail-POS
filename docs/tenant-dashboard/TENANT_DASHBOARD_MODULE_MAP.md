# Tenant POS Dashboard — Module Map (`/tenant/dashboard`)

Canonical screen: `apps/pos-web/src/screens/POSDashboardScreen.tsx` (no V2/duplicate — the existing screen was rebuilt in place).
Routes: `dashboard` and `tenant/dashboard` → `POSDashboardScreen` (apps/pos-web/src/App.tsx). Shell = canonical `POSLayout` (sidebar/topbar/location selector/search unchanged).
Data: single consolidated aggregate `GET /pos/dashboard/state` → `POSDashboardState` (apps/api/src/dashboard/*). One source of truth; no per-module endpoints, no duplicate calculations.

| Picture module | State field | Source tables (tenant + branch scoped) | Status |
|---|---|---|---|
| 9 KPI cards | `kpis` | payments, tickets, pos_tech_appointments, technician_statuses/shifts, reviews | REAL |
| Today's Operations Snapshot (6 tiles) | `operationsSnapshot` | pos_queue_items, tickets, pos_tech_appointments | REAL |
| Live Salon Activity | `liveActivity` | tickets ⋈ customers ⋈ technicians ⋈ ticket_service_lines | REAL |
| AI Insights | `quickInsights` (AI-package gated) | topServices, technician_statuses, inventory_items | REAL signals; predictive insights honestly "not connected" |
| Revenue & Appointments Trend (dual-line) | `revenueTrend.series[{valueCents,apptCount}]` | payments + pos_tech_appointments (7-day axis) | REAL |
| Top Technicians Today | `topTechnicians[{revenue,servicesCount,utilizationPercent,tipsCents,rating}]` | ticket_service_lines, tickets.tip_cents, reviews, technician_shifts, pos_tech_appointments | REAL |
| Top Services Today (donut) | `topServices` | ticket_service_lines | REAL |
| Customer Retention (donut) | `customerRetention` | tickets per-customer history (60-day window) | REAL |
| Payment Mix (donut) | `paymentMix` | payments by method | REAL |
| Multi-Location Snapshot | `multiLocation` | branches + payments + tickets (whole tenant; only if >1 branch) | REAL |
| Quick Actions (9) | static → canonical routes | check-in/booking/tech-queue/serving/checkout/messages/inventory/reports | WIRED |

Honesty: every module degrades to its own loading skeleton then an honest empty state; one card failing never blanks the page. With the current seed (no payments/reviews/shifts seeded on "today"), money/rating/utilization render honest zeros/`—` rather than invented mockup numbers.
