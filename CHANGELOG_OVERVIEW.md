# CHANGELOG — tenant POS Overview

- Rebuilt `POSOverviewScreen` in place to the reference command-center layout: 8 KPI cards, Arrivals & Check-In
  Queue, Live Tech Queue, Service Flow Overview, Today's Appointments, Customer Communications, AI Insights
  (gated), Revenue Trend (sparkline), Technician Performance, Customer Retention (donut), Payment Mix,
  Inventory Alerts, and a 10-button Quick Actions bar. Card-level loading/empty/error.
- Reused the canonical `/pos/overview/state` (rich `PosOverviewResponse`) for all numeric/analytics modules —
  no duplicate Overview service/endpoint/page created.
- Added `GET /pos/overview/board` (OverviewBoardController/Service in the existing OverviewModule) supplying only
  the three modules the rich state lacked (communications, retention, inventory), tenant/branch-scoped, fail-soft.
- Extended `posOverviewApi` with `getOverview()` + `getBoard()`.
- Added Overview CSS (KPI strip, card grids, tables, pills, flow bars, sparkline, donut, quick actions, skeletons)
  matching the cream/gold system; responsive down to iPad.
- AI Insights enforce AI-package access (locked upgrade state when unsubscribed); backend remains source of truth.
- Validation: API tsc 0 errors; pos-web tsc 0 errors; pos-web vite build OK; overview spec 24/24 (no regression).
