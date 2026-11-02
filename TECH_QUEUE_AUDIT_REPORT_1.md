# TECH_QUEUE_AUDIT_REPORT.md — POS Tech Queue (2026-07-03)

_Audited the Tech Queue screen end-to-end. Found that a whole management surface — the Assigned Tickets table and its
per-ticket Manage drawer — had been dropped from the render, orphaning six fully-implemented supervisory actions;
plus a dead service-category filter and a dead "Actions" button. Restored and wired all of them to their real
endpoints, then locked the behavior with tests. Verification numbers are fresh runs on this tree._

## 1. Modules and boxes found in the picture
8-KPI strip (Assigned, Waiting Acceptance, Accepted, Ready to Start, Delayed, Active Techs, Available Techs, Avg
Wait) · header (All Services filter, date, Auto Refresh, Live) · A. Live Technician Queue · B. Technician Workload
Board (drag-drop assignment: Available Now / Ready for Assignment / In Progress / Finishing Soon / Break-Offline) ·
C. AI Assignment Insights (Auto Balance) · **Assigned Tickets management** (per-ticket reassign / priority / delay /
decline / cancel) · D1 Waiting Guests by Skill Match · D2 Tech Performance · D3 Available Technicians · analytics row
(Tech Performance Today, Top Revenue Techs, Assignment Source, Service Mix by Technician) · Quick Actions · sidebar.

## 2. Problems discovered
- **Orphaned supervisory actions (the big one).** The state's `tickets.items` were fetched and six handlers —
  `doReassign`, `doPriority`, `doReportDelay`, `doClearDelay`, `doDecline`, `doCancel` — were fully implemented and
  endpoint-wired, plus a `toggleDrawer` and `openId` drawer state, **but the Assigned Tickets table and Manage drawer
  had been removed from the render**. Result: the entire per-ticket management surface was unreachable — a
  receptionist could not reassign, reprioritize, delay, decline, or cancel a ticket from this screen at all. (17 lint
  warnings for unused declarations were the tell.)
- **Dead "All Services" filter.** A static `<select>` with a single hard-coded option, no value/onChange — even
  though the backend fully supports a `serviceCategory` filter (both repos apply it) and the state returns the
  category facets to populate it.
- **Dead "Actions" button** in the technician table — it only set a note string (`Actions for {name}`) instead of
  navigating anywhere.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSTechQueueScreen.tsx`:
  - Rebuilt the **Assigned Tickets** section — a real table over `state.tickets.items` with a per-row **Manage**
    drawer that wires all six orphaned handlers (reassign with tech picker + reason, update priority, report delay
    with optional extra minutes, clear delay, decline, cancel), each guarded for its required inputs and posting to
    the real endpoint. Reused the existing `act()`/`toggleDrawer`/`openId`/`busyId` machinery and the previously-dead
    `PRIORITIES` / `svcNames` / `inputStyle` / `tinyBtn` / `allTechs` helpers.
  - Wired the **service-category filter** to real `serviceFilter` state populated from `state.filters.serviceCategories`,
    threaded through `load()` so it refetches with `?serviceCategory=`.
  - Repointed the **Actions** button to a real destination (`/tenant/communications`, "Message {tech}").
  - Removed genuinely-dead helpers (`tone`, `prio`, `money`, `Donut`, `PALETTE`) → the file now lints with **0
    warnings** (down from 17).
- `apps/pos-web/src/screens/POSTechQueueScreen.test.tsx` — +7 tests (net; replaced one brittle native-drag sim).

## 4. Backend files fixed
**None.** Every restored action maps to an endpoint that already existed and is covered by the backend suite:
`reassign-technician`, `update-priority`, `report-delay`, `clear-delay`, `decline`, `cancel` (POST
`/pos/tech-queue/tickets/:id/…`), and the `serviceCategory` filter on `GET /pos/tech-queue/state`. All behind
`TenantAuthGuard + RolePermissionGuard`, session-derived tenant/branch.

## 5. Routes and APIs repaired
No routes added or changed. The frontend now *reaches* the supervisory ticket endpoints (previously unreachable) and
*sends* the `serviceCategory` filter the state endpoint already supported.

## 6. Database changes
None. All actions mutate existing tenant + branch-scoped tech-queue rows.

## 7. How each module is wired
- **Workload Board:** drag a waiting guest onto an available technician → `dropEligibility` gate (pure, unit-tested)
  → `posQueueApi.assignTechnician(queueItemId, { technicianId })` with optimistic dim + rollback + honest reason on
  rejection.
- **Auto Balance:** preview → `POST /auto-balance/preview`; apply → `POST /auto-balance/apply` with the proposal set;
  empty preview honestly reports "nothing to balance."
- **Assigned Tickets → Manage:** open drawer → pick tech / priority / reason / extra-minutes → each button calls its
  `do*` handler → `posTechQueueApi.<action>` → guarded controller → service → repo → tenant/branch-scoped mutation →
  `load()` refreshes. Reason-bearing actions refuse to submit without a reason.
- **Service filter:** `state.filters.serviceCategories` populates the dropdown → selecting one refetches
  `GET /pos/tech-queue/state?serviceCategory=…`.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Tech Queue screen **10/10** (2 prior + 8 new: board renders draggable guests + drop affordance;
  dropEligibility gate; Auto Balance preview→apply and empty-preview; Manage drawer opens with all actions; Cancel
  requires a reason then POSTs to `/cancel`; Reassign requires a tech; service filter populates from facets and
  refetches with `serviceCategory=`). Full pos-web **267/267 across 64 files**; the lone exit-1 is the pre-existing
  jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx — unrelated. Backend tech-queue **27/27 across 3 files**
  confirms the supervisory endpoints.
- **Lint:** POSTechQueueScreen.tsx + its test → **0 warnings, 0 errors** (was 17 warnings).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- The Manage drawer uses a single shared reason/note field for the reason-bearing actions (reassign/delay/clear/
  decline/cancel), matching the handlers' contract; it does not yet support per-action distinct notes in one open
  session — a minor UX refinement, not a wiring gap.
- Native HTML5 drag-drop is exercised at the affordance + eligibility + endpoint level, not by simulating a full
  browser drag (jsdom attaches the conditional `onDrop` only after the drag-state re-render, making a raw sim
  flaky). The pure `dropEligibility` gate and the `assignTechnician` path are both covered.
- The header date control ("Today, May 06") remains a static label — the tech-queue state has no date-range param, so
  making it interactive would be fake until backend windowing exists (same principle applied to the Check-In period
  labels).
- Drawer/table verified against the in-memory adapter and backend suite; not exercised against live Postgres this
  session.
