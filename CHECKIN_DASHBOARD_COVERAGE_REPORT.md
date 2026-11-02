# CHECKIN_DASHBOARD_COVERAGE_REPORT.md — POS Check-In & Dashboard (2026-07-03)

_Continuing the wiring-lock discipline from the Overview audit onto the two remaining single-test POS screens.
Audited both end-to-end, locked their wiring with tests, and removed one genuine dead wire found in the Dashboard.
Verification numbers are fresh runs on this tree._

## What was done
1. **POSCheckInScreen** (363 lines, had 1 test) — audited; already correctly wired. Added 7 tests.
2. **POSDashboardScreen** (360 lines, had 1 test) — audited; found and removed a dead inventory-alerts wire; added 6 tests.

## 1. Modules audited
**Check-In:** 9-KPI strip · Live Check-In Queue (row actions: Check In / Start / Assign / Notify / View) · Quick
Check-In Panel (Existing / New tabs) · Front Desk Insights (routed actions) · Today's Appointments Arriving ·
Waiting Lounge & Assignment · Available Technicians · Arrival Trend · Check-In Source Mix · Quick Actions.
**Dashboard:** 9-KPI strip · Today's Operations Snapshot (6 nav tiles) · Live Salon Activity · AI Insights (gated) ·
Revenue & Appointments Trend · Top Technicians · Top Services · Customer Retention · Payment Mix · Multi-Location
Snapshot · Quick Actions.

## 2. Problems discovered
- **Check-In:** none — every KPI reads real `/pos/check-in/state`, every row action calls the correct endpoint
  (`move-to-queue` / `start-service` / `update-wait-estimate`), insights and quick actions navigate to registered
  routes, and error/empty states are honest. The gap was purely test coverage (1 test).
- **Dashboard — genuine dead wire:** `load()` fetched `inventoryApi.alerts()` into `alerts` / `alertsErr` state on
  every dashboard load, but **no card rendered it** (the inventory-alerts card lives on the Overview screen, not this
  Dashboard, per the reference design). Result: a wasted network request and orphaned state on each mount.
- **Dashboard — stale fixture field:** the pre-existing test fixture used `quickInsights` while the AI card renders
  `s.aiInsights`; the new AI tests use the correct field so they exercise the real DOM.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSDashboardScreen.tsx` — removed the orphaned `inventoryApi.alerts()` fetch, the
  `alerts` / `alertsErr` state, the now-unused `inventoryApi` import, and corrected the stale header comment.
- `apps/pos-web/src/screens/POSCheckInScreen.test.tsx` — +7 tests.
- `apps/pos-web/src/screens/POSDashboardScreen.test.tsx` — +6 tests.
No other component needed changes; both screens were otherwise correctly wired.

## 4. Backend files fixed
**None.** Both screens sit on already-guarded, tenant-scoped controllers (`/pos/check-in/*`, `/pos/dashboard/*`)
with permission checks and session-derived tenant/branch context. No backend defect was found.

## 5. Routes and APIs repaired
None repaired; one **removed** on the client: the Dashboard no longer calls `/tenant/inventory/alerts` (it was
never consumed). All other endpoints resolve and back live UI.

## 6. Database changes
None. No schema, migration, or query change.

## 7. How each screen is wired (verified by the new tests)
- **Check-In KPIs** → `/pos/check-in/state` `kpis.*` (check-ins, waiting, walk-ins, ready-for-service, avg wait,
  no-shows, techs available, return rate). **Live queue row actions** → `posCheckInApi.moveToQueue` (arrived → Check
  In), `.startService` (ready → Start), `.updateWaitEstimate` (confirmed → Notify), with `/queue` and `/customers`
  navigation for Assign/View. **Insights** → routed actions (Call Back → communications, etc.). **Quick Actions** →
  their modules.
- **Dashboard KPIs** → `/pos/dashboard/state` `kpis.*`; each card navigates. **Operations Snapshot** tiles →
  /queue, /check-in, /checkout, /service-done, /booking. **AI Insights** → gated on real AI-package access
  (`useTenantNavAccess().aiPackages`): upsell when locked, `s.aiInsights` lines with actions when active.
  **Live Activity / Trend / Top Techs / Top Services / Retention / Payment Mix / Multi-Location** → their `state`
  slices with per-card empty states and footer navigation.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc --noEmit` → **0 errors** (confirms the removed import/state left no dangling refs).
- **Tests:** Check-In **8/8** (1 original + 7 new); Dashboard **6/6** (1 original + 5 new, one replaced); full
  pos-web suite **244/244 across 63 files**. The lone exit-1 is the pre-existing jsdom `scrollIntoView` notice in
  POSBookingScreen.test.tsx (carried from earlier turns) — not a failure and unrelated.
- **Lint:** the two test files and the Dashboard screen → **0 errors**. 6 pre-existing warnings remain in
  POSDashboardScreen.tsx (unused `tab`/`setTab`/`setTechFilter`/`asOf`/`scheduleRows` locals and one unused import
  alias) — see §9; these predate this work and were left untouched to avoid disturbing partially-wired state.
- **Build:** pos-web production build → **clean**.

## 9. Honest remaining issues
- **Pre-existing lint warnings in POSDashboardScreen.tsx** (6, all "defined but never used"): `tab`/`setTab` (no
  communications-tab UI on this Dashboard), `setTechFilter` (`techFilter` is read-only today), `asOf` (set, not
  displayed), `scheduleRows` (computed, not rendered). These are orphaned locals, not broken wiring; removing them
  safely needs a small dedicated pass since a couple are partially referenced. Deferred to keep this change focused.
- New tests assert DOM presence and endpoint/routing wiring; donut/sparkline pixel geometry is not unit-asserted
  (visual QA in a real browser still recommended for the reference-exact look).
- Cards backed by sparse single-tenant seed data render honest empty/locked states by design, not as bugs.
