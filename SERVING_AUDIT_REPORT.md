# SERVING_AUDIT_REPORT.md — POS Serving (2026-07-03)

_Audited the Serving screen end-to-end. Same class of defect as Tech Queue and Queue, and the largest instance yet: a
per-ticket Manage drawer, a Requested-Technician Change Approvals queue, and three header filters were all built and
endpoint-wired but dropped from the render — 23 lint warnings' worth of orphaned code. Restored and wired all of them.
Verification numbers are fresh runs on this tree._

## 1. Modules and boxes found in the picture
12-KPI strip · header (All Services filter, date, status filter, Live, Auto Refresh) · Live Service Floor table
(row action + per-ticket Manage) · Service Progress Board · AI Service Insights · **Requested-Technician Change
Approvals** · Technician Service Performance · analytics/second row · Quick Actions · sidebar.

## 2. Problems discovered
- **Orphaned per-ticket Manage drawer.** `toggleDrawer`, `doReportDelay`, `doClearDelay`, `doHelper` and the
  `openId` drawer state were fully implemented and endpoint-wired, but **no table row rendered a Manage button or
  drawer** — so a supervisor could not report a delay, clear a delay, or assign/change a helper technician from the
  service floor.
- **Orphaned Change Approvals queue.** `pendingChangeRequests()` fetched the pending requested-technician changes and
  `decideChangeRequest()` (approve/reject) was implemented via `decideCr`, but **the panel that lists them was never
  rendered** — guests' mid-service tech-change requests had no approval surface.
- **Missing search control + dead filters.** `search` and `delay` state fed `load()`, but **no search input and no
  delay dropdown were rendered**; the **"All Services"** dropdown listed facets but had no value/onChange and never
  passed `serviceCategory` to `load()` — despite the backend applying all three filters.
- **Dead declarations:** unused `AssignTechSheet` import, unused `money` / `tone` / `isPaused` / `tinyBtn` helpers,
  unused `assignId` state, and a misplaced `eslint-disable` on the auto-select effect.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSServingScreen.tsx`:
  - Rebuilt the **Manage drawer** into the Live Service Floor table — a per-row Manage toggle opening an inline
    drawer that wires `doReportDelay` (reason required + optional extra minutes), `doClearDelay` (note required), and
    `doHelper` (assign/remove helper from the loaded roster), each guarded and posting to its real endpoint.
  - Rendered the **Requested-Technician Change Approvals** panel over `changeReqs` with Approve/Reject wired to
    `decideCr` → the real decision endpoint; hidden when empty.
  - Added the **search input** and **delay filter**, and wired the **All Services** dropdown to real `serviceFilter`
    state from `state.filters.serviceCategories`, threading `serviceCategory` through every `load()` call.
  - Removed the dead import/helpers/state and fixed the `eslint-disable`. File now lints **0 warnings** (from 23).
- `apps/pos-web/src/screens/POSServingScreen.test.tsx` — +5 tests.

## 4. Backend files fixed
**None.** Every restored action maps to an endpoint that already existed and is covered by the backend suite:
`report-delay`, `clear-delay`, `assign-helper`, `change-requests/pending`, `change-requests/:id/decision`, and the
`search` / `serviceCategory` / `delayStatus` filters on `GET /pos/serving/state`. All behind `TenantAuthGuard +
RolePermissionGuard`, session-derived tenant/branch.

## 5. Routes and APIs repaired
No routes added or changed. The frontend now *reaches* the delay/helper/change-request endpoints (previously
unreachable) and *sends* the search/service/delay filters the state endpoint already supported.

## 6. Database changes
None. All actions mutate existing tenant + branch-scoped serving rows / change-request records.

## 7. How each module is wired
Header filters → `load({ search, status, delayStatus, serviceCategory })` → `GET /pos/serving/state?…` → guarded
controller → service → repo (tenant+branch scoped, applies each filter). Row Manage → inline drawer →
`doReportDelay` / `doClearDelay` / `doHelper` → `posServingApi.<action>` → `act()` → real mutation → `refetch()`.
Change Approvals → `pendingChangeRequests()` populates the panel → Approve/Reject → `decideChangeRequest(id,
decision)` → reload. The helper picker is populated from `/pos/technicians/state`.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Serving screen **8/8** (3 prior + 5 new: service filter populates from facets and refetches
  `serviceCategory=`; search refetches `search=`; delay filter refetches `delayStatus=`; Manage drawer opens and
  Report Delay requires a reason then POSTs to `/report-delay`; Change Approvals renders and Approve POSTs to
  `/change-requests/:id/decision`). Full pos-web **277/277 across 64 files**; the lone exit-1 is the pre-existing
  jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx — unrelated. Backend serving suite **23/23 across 7
  files** confirms the endpoints + filters.
- **Lint:** POSServingScreen.tsx + its test → **0 warnings, 0 errors** (was 23 warnings).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- The header date control ("Today, May 06") remains a static label — the serving state has no date-range param, so
  an interactive control would be fake until backend windowing exists (same principle as Check-In / Tech Queue /
  Queue).
- The Manage drawer shares one text field between the delay-reason and clear-note actions, matching the handler
  contracts; per-action distinct fields in one session is a minor UX refinement, not a wiring gap.
- Drawer/panel/filters verified against the in-memory adapter + backend suite; not exercised against live Postgres
  this session.
