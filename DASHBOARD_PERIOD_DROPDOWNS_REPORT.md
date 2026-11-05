# DASHBOARD_PERIOD_DROPDOWNS_REPORT.md — POS Dashboard (2026-07-03)

_The reference image is the tenant Dashboard (audited + covered last turn). This pass treated the picture as the
checklist and found the one class of element that was UI-only, not functional: the on-card period selectors. Made
them real, end-to-end, frontend → API → service → repository → SQL window. Verification numbers are fresh runs._

## 1. Modules and boxes found in the picture
9-KPI strip (Today's Revenue, Monthly Card Volume, Check-Ins Today, Appointments Today, Active Services, Average
Ticket, Staff On Duty, Customer Retention, AI Booking Conversion) · Today's Operations Snapshot (6 tiles) · Live
Salon Activity · AI Insights (gated) · Revenue & Appointments Trend `Today ▾` · Top Technicians `Today` · Top
Services `Today ▾` · Customer Retention `This Month ▾` · Payment Mix `Today ▾` · Multi-Location Snapshot · Quick
Actions (9) · sidebar, System Status footer.

## 2. Problems discovered
- **Period dropdowns were UI-only.** The `Today ▾` / `This Week ▾` / `This Month ▾` controls on Revenue Trend, Top
  Services, and Payment Mix rendered as `<span className="dperiod">` — styled to look like dropdowns (border, pill,
  the image's ▾ chevron) but with **no chevron element, no options, and no handler**. Clicking did nothing; the card
  always showed one fixed window. This is exactly the "make every visible box functional, not UI-only / fix broken
  dropdowns" item on the checklist.
- **The backend accepted `range` but ignored it.** `/pos/dashboard/{revenue-trend,top-services,payment-mix}` all took
  a `range` query param (`today|week|month`) that was plumbed to `getAggregate`, but the Kysely repo hard-coded the
  windows (revenue trend = fixed 7 days; services/payment-mix = single day) and hard-set `period: 'week'`. So even if
  the frontend had sent a range, the data wouldn't have changed — wiring the label alone would have been fake.
- **Pre-existing dead code** in POSDashboardScreen.tsx (the 6 lint warnings noted honestly last turn): unused
  `tab`/`setTab`/`setTechFilter`/`asOf`/`scheduleRows` locals, an unused `nowLabel` helper, and an unused `Trend`
  type — all removed in this pass.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSDashboardScreen.tsx` — added a real `PeriodDropdown` (`<select>` styled as the
  `.dperiod` pill), per-card range state + range-scoped override data for the three cards, refetch-on-change
  handlers, and made the donut/legend/total for Payment Mix and Top Services and the Revenue Trend chart all read the
  override-aware data (fixed a self-introduced bug where the Payment Mix legend still read base state). Removed the
  dead locals/type/helper.
- `apps/pos-web/src/api/posDashboardApi.ts` — added `getRevenueTrend(range)`, `getTopServices(range)`,
  `getPaymentMix(range)` against the existing backend routes.
- `apps/pos-web/src/styles.css` — `.dperiod-sel` styling so the `<select>` matches the pill with an inline chevron.
- `apps/pos-web/src/screens/POSDashboardScreen.test.tsx` — +3 tests.

## 4. Backend files fixed
- `apps/api/src/dashboard/dashboard.kysely.repository.ts` — added a `rangeWindow(range)` helper and applied it so the
  **revenue-appointments trend** (variable lookback + day/date labels + correct `period`), **top-services**, and
  **payment-mix** windows honor `q.range`. Real SQL windowing, tenant/branch scope unchanged.
- `apps/api/src/dashboard/dashboard.repository.ts` — the in-memory adapter now `applyRange(...)`s the seeded
  dashboard so dev/test reflect the selection (period label + trend series length), keeping the adapters behaviourally
  aligned.
- `apps/api/src/dashboard/dashboard-t02.vitest.spec.ts` — +3 tests.

## 5. Routes and APIs repaired
No routes added or changed. The three period-scoped GETs (`/pos/dashboard/revenue-trend`, `/top-services`,
`/payment-mix`) already existed, guarded by `TenantAuthGuard + RolePermissionGuard` with
`@RequirePermission('pos.dashboard.view')` and session-derived tenant/branch — they now **honor** their `range`
param instead of ignoring it, and the client now calls them.

## 6. Database changes
None. No schema, migration, or new table — only the WHERE-window on existing `payments`, `ticket_service_lines`,
and `pos_tech_appointments` queries changed. Money stays integer cents; all queries stay tenant + branch scoped.

## 7. How each module is wired
Selecting a period on a card calls `posDashboardApi.get{RevenueTrend|TopServices|PaymentMix}(range)` →
`GET /pos/dashboard/<card>?range=…` → guarded controller → `DashboardService.get<Card>` → `repo.getAggregate(scope,
{range})` → range-windowed SQL (Kysely) or `applyRange` (in-memory) → the card re-renders from the returned slice via
its override state, while the rest of the dashboard is untouched (no full reload). The base `/state` still hydrates
every card on first load with each card's default period.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0**; api `tsc` **0**.
- **Tests:** Dashboard screen **9/9** (6 prior + 3 new dropdown tests asserting the control is a real `<select>`,
  that changing Payment Mix → month refetches `range=month` and re-renders 80%, and that Top Services → month swaps
  the list); backend dashboard vitest **5/5** (2 prior + 3 new range-window tests); standalone dashboard-core spec
  **42/42**. Full suites: **pos-web 247/247 (63 files)**, **api 2,528/2,528 (400 files)**. The lone pos-web exit-1 is
  the pre-existing jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx — unrelated, not a failure.
- **Lint:** POSDashboardScreen.tsx + the two other touched files → **0 warnings, 0 errors** (the 6 pre-existing
  warnings are now cleared).
- **Build:** pos-web and api production builds **clean**.

## 9. Honest remaining issues
- **Customer Retention** and **Top Technicians** keep their fixed labels (`This Month`, `Today`) — the picture shows
  those two without an interactive ▾ affordance, and their backends don't yet window by range, so I left them static
  rather than add a control that wouldn't change data. If you want them switchable, that's a followup that needs
  matching backend windowing (same pattern as this pass) to stay honest.
- The Kysely range windows were authored against the schema but, as the repo's own note says, aren't executed here
  (no live Postgres this session); the in-memory adapter covers dev/test and the SQL is straightforward WHERE-window
  changes. Verify against the cluster at deploy.
- `range=today` uses a single-day point for the trend; with one datapoint the line renders as a single marker (by
  design). A finer intraday (hourly) trend for the "today" view would need an hour-bucketed query — deferred.
