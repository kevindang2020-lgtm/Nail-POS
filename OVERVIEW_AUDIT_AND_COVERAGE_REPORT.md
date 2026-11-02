# OVERVIEW_AUDIT_AND_COVERAGE_REPORT.md — POS Overview screen (2026-07-03)

_Full end-to-end audit of the POS Overview screen against the reference image, then the one genuine gap the audit
surfaced (test coverage) closed. Verification numbers are fresh runs on this tree._

## Honest headline
The Overview screen is **already correctly and completely wired** — frontend → API client → guarded controllers →
services → real Postgres queries → tenant/branch isolation → correct route targets. There was **no fake/hard-coded
production data, no dead link, and no UI-only card** to repair. The defensible finding was thin test coverage (2
tests for a 447-line screen with 15+ interactive cards), so I locked the wiring with comprehensive tests rather than
fabricate "fixes" to working code.

## 1. Modules and boxes found in the picture (all present + wired)
KPI strip (Today's Check-Ins, Waiting Guests, Walk-ins, Active Services, Ready for Checkout, Today's Revenue,
Average Ticket, Staff on Duty) · Arrivals & Check-In Queue (Live) · Live Tech Queue · Service Flow Overview
(Waiting / Ready for Assignment / In Progress / Ready for Checkout / Completed with the two sublists) · Today's
Appointments (date-navigable) · Customer Communications (Reminders / Messages / Missed Calls tabs) · AI Insights
(gated) · Revenue Trend · Technician Performance · Customer Retention (donut) · Payment Mix (donut) · Inventory
Alerts (Low Stock) · Quick Actions (10 actions) · System Status footer.

## 2. Problems discovered
- **No functional/wiring bugs.** Every KPI, card, tab, and action reads real backend data and navigates to a
  registered route (all 12 nav targets resolve — verified against App.tsx + tenant-nav).
- **Real gap: test coverage.** 2 tests existed; none asserted KPI values, analytics binding, tab switching, AI
  gating, or error/empty degradation — so a regression in any card would ship silently.
- Minor: the pre-existing fixture in the test file used a `quickInsights[].text` field the component doesn't read
  (it renders `.title`/`.value`); corrected in the new fixture so the AI-insights assertions exercise the real DOM.

## 3. Frontend files fixed
`apps/pos-web/src/screens/POSOverviewScreen.test.tsx` — +10 tests (see §8). The screen component
(`POSOverviewScreen.tsx`) needed **no** change; it was already correct.

## 4. Backend files fixed
**None.** Both controllers (`overview.controller.ts`, `overview-board.controller.ts`) are behind
`TenantAuthGuard + RolePermissionGuard` with `@RequirePermission('pos.overview.view')`, tenant/branch scope taken
from `req.ctx` (session, never the client). Both services (`overview.service.ts`, `overview-board.service.ts`) run
real tenant+branch-scoped SQL with honest fallbacks (retention/inventory return null/[] when there's no data).

## 5. Routes and APIs repaired
None needed. `/pos/overview/state` and `/pos/overview/board` both resolve, are guarded, and back every card. The
Overview API client (`posOverviewApi.ts`) matches them exactly.

## 6. Database changes
None. Data sources are canonical: `tickets` (revenue, retention, average ticket), `pos_queue_items` /
`pos_tech_queue_tickets` (queues/flow), `inventory_products` + `inventory_location_stock` (alerts), the
communications tables (reminders/messages/missed calls). No new table, no migration.

## 7. How each module is wired (verified)
- **KPI strip** → `/pos/overview/state` `kpis.*` (nested money/count objects, backend-computed). Each card
  navigates: Check-Ins→/check-in, Waiting→/queue, Walk-Ins→/check-in, Active Services→/serving, Ready for
  Checkout→/checkout, Revenue/Average→/reports, Staff→/technicians.
- **Arrivals & Live Tech Queue / Service Flow** → the same authoritative appointment + check-in feed
  (`schedulePreview`, `walkInStatus`), filtered client-side into arrival vs flow views; "View Full…" → /tech-queue.
- **Today's Appointments** → date-scoped `/state?date=` refetch with prev/next; list filtered to
  completed/in-progress/confirmed/open.
- **Customer Communications** → `/board` `communications.{reminders,messages,missedCalls}`, tabbed with counts;
  Call back / View All → /messages.
- **AI Insights** → gated on real AI-package access (`useTenantNavAccess().aiPackages`); shows upsell when locked,
  `analytics.quickInsights` when active; View All → /tenant/ai/command-center.
- **Revenue Trend / Technician Performance / Payment Mix** → `/state` `analytics.{revenueTrend,topTechnicians,
  paymentMix}`. **Retention / Inventory Alerts** → `/board`. All with empty states.
- **Quick Actions** → 10 actions each navigating to its module (check-in, booking, queue, serving, checkout,
  inventory, messages, cash-drawer).

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc --noEmit` → **0 errors**.
- **Tests:** Overview file **12/12** (2 original + 10 new); full pos-web suite **232/232 across 63 files**. The lone
  exit-1 is the pre-existing jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx carried from earlier turns —
  not a failure and unrelated to Overview. Backend Overview specs (`overview-core`, `overview-schedule`) unchanged
  and green.
- **Lint:** `eslint POSOverviewScreen.test.tsx` → clean.
- **Build:** pos-web production build → **clean**.
- New tests assert: all 8 KPI values bound to `/state` (scoped per card), KPI navigation, Technician Performance +
  Payment Mix + Retention + Inventory + Revenue Trend bound to real data, Communications tab switching across
  reminders/messages/missed-calls, AI Insights locked-vs-active gating, all 10 Quick Actions, `/state` error →
  Retry card, `/board` error → honest empty state with KPIs intact, and Today's Appointments day list.

## 9. Honest remaining issues
- Overview was already production-wired; the substantive change here is coverage, not behavior.
- Some cards (Retention, Inventory, AI Insights) render honest empty/locked states on a single-tenant `db:seed`
  database because those sources legitimately have no rows/packages yet — by design under the honest-verification
  invariant, not a bug.
- The screen renders donuts/sparklines from real arrays; their pixel geometry isn't unit-asserted (DOM presence and
  data binding are). Visual QA across viewports still benefits from a real browser at 100% zoom on a 24-inch iMac.
