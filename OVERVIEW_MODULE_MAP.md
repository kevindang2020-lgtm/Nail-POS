# OVERVIEW_MODULE_MAP.md — tenant POS Overview

Page: `apps/pos-web/src/screens/POSOverviewScreen.tsx` (rebuilt in place — no OverviewNew/V2). Sidebar item
**Overview** active at `/overview` (the pos-web app is the tenant app; `/tenant/overview` maps here).

| Module (image) | Data source | Status |
|---|---|---|
| 8 KPI cards (Check-Ins, Waiting, Walk-Ins, Active Services, Ready for Checkout, Revenue, Avg Ticket, Staff on Duty) | `GET /pos/overview/state` (kpis, walkInStatus, todayAppointments) | Real; Check-Ins/Walk-Ins/Avg Ticket derived from real fields |
| Arrivals & Check-In Queue | state `schedulePreview` appointments | Real |
| Live Tech Queue | state `schedulePreview.technicians` | Real |
| Service Flow Overview | composed from state (waiting/serving/checkout/completed/checkedInNotAssigned) | Real |
| Today's Appointments | state `schedulePreview` (flattened, sorted) | Real |
| Customer Communications | `GET /pos/overview/board` → reminders | Real where reminders exist, else empty state |
| AI Insights | state `analytics.quickInsights`; **gated** by AI package | Real + gated |
| Revenue Trend | state `analytics.revenueTrend` (sparkline) | Real |
| Technician Performance | state `analytics.topTechnicians` | Real |
| Customer Retention | `GET /pos/overview/board` (90-day returning/new/inactive from tickets) | Real where history exists, else empty |
| Payment Mix | state `analytics.paymentMix` | Real |
| Inventory Alerts | `GET /pos/overview/board` (products ≤ reorder) | Real where products table exists, else empty |
| Quick Actions (10) | navigate to existing flows (check-in/booking/serving/checkout/…) | Wired |

Every card has independent loading skeleton / empty / (state-level) error+retry — one failing module never blanks the page.
