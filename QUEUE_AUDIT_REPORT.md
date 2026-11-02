# QUEUE_AUDIT_REPORT.md — POS Customer Queue (2026-07-03)

_Audited the Customer Queue screen end-to-end. Same class of defect as Tech Queue: a per-item Manage drawer and its
supervisory handlers were built but dropped from the render, and several header filters had state but no controls (or
a dead control). Restored and wired all of them to their real, tested endpoints. Verification numbers are fresh runs._

## 1. Modules and boxes found in the picture
10-KPI strip · header (All Services filter, date, Queue Status filter, Live, Auto Refresh) · Live Customer Queue
table (row action + per-item Manage) · Queue Flow Board (5 columns) · AI panel / assignment insights · Customer
Profile Preview · Visit Source Mix · Top Waiting Services · Potential Revenue by Queue · Quick Actions (Add to Queue,
Assign Tech, …) · sidebar.

## 2. Problems discovered
- **Orphaned per-item Manage drawer (the big one).** The state's `queue.items` were fetched and the handlers
  `doAssign`, `doPriority`, `doCancel` plus `toggleDrawer` / `openId` were fully implemented and endpoint-wired — but
  **no table row rendered a Manage button or drawer**, so a receptionist could not assign a technician, change
  priority, or cancel a guest from the queue. (17 unused-declaration lint warnings were the tell — the same signature
  as the Tech Queue regression.)
- **Missing search + source filter controls.** `search` and `source` state existed and were already threaded into
  `load()`, but **no search input and no source dropdown were rendered**, so those filters could never be set.
- **Dead "All Services" dropdown.** It listed the category facets but had no value/onChange and never passed
  `serviceCategory` to `load()` — even though the backend applies that filter in both repos.
- **Dead declarations:** an unused `AiAssistantPanel` import, unused `tone` / `prio` / `money` helpers, unused
  `assignId` / `setAssignId` state, and a misplaced `eslint-disable` on the auto-select effect.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSQueueScreen.tsx`:
  - Rebuilt the **Manage drawer** into the Live Customer Queue table — a per-row Manage toggle opening an inline
    drawer that wires `doAssign` (technician picker from the loaded roster), `doPriority`, and `doCancel` (reason
    required), each guarded and posting to the real endpoint via the existing `act()` machinery.
  - Added the **search input** and **source filter** to the header (wired to the existing `search` / `source` state,
    which already fed `load()`), and wired the **All Services** dropdown to real `serviceFilter` state populated from
    `state.filters.serviceCategories`, threaded through every `load()` call (effect, realtime, refetch) as
    `serviceCategory`.
  - Removed the dead `AiAssistantPanel` import, the `tone` / `prio` / `money` helpers, and the `assignId` state;
    fixed the misplaced `eslint-disable`. File now lints **0 warnings** (down from 17).
- `apps/pos-web/src/screens/POSQueueScreen.test.tsx` — +5 tests.

## 4. Backend files fixed
**None.** Every restored action and filter maps to an endpoint that already existed and is covered by the backend
suite: `assign-technician`, `update-priority`, `cancel` (POST `/pos/queue/items/:id/…`) and the `search` / `source` /
`serviceCategory` filters on `GET /pos/queue/state`. All behind `TenantAuthGuard + RolePermissionGuard`,
session-derived tenant/branch.

## 5. Routes and APIs repaired
No routes added or changed. The frontend now *reaches* the supervisory queue endpoints (previously unreachable) and
*sends* the search/source/serviceCategory filters the state endpoint already supported.

## 6. Database changes
None. All actions mutate existing tenant + branch-scoped queue rows.

## 7. How each module is wired
Header filters (search, service, source, status) → `load({ search, status, source, serviceCategory })` →
`GET /pos/queue/state?…` → guarded controller → service → repo (tenant+branch scoped, applies each filter) → the
table + board re-render. Row action (Start / Notify / Assign / View) uses the existing per-status handler. Manage →
opens the inline drawer → pick technician / priority / reason → `doAssign` / `doPriority` / `doCancel` →
`posQueueApi.<action>` → `act()` → real mutation → `refetch()` refreshes. The technician picker is populated from
`/pos/technicians/state` (already loaded for the quick-assign sheet).

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Queue screen **7/7** (2 prior + 5 new: service filter populates from facets and refetches
  `serviceCategory=`; source filter refetches `source=`; search refetches `search=`; Manage drawer opens and Cancel
  requires a reason then POSTs to `/cancel`; Assign requires a technician). Full pos-web **272/272 across 64 files**;
  the lone exit-1 is the pre-existing jsdom `scrollIntoView` notice in POSBookingScreen.test.tsx — unrelated. Backend
  queue suite **30/30 across 7 files** confirms the supervisory endpoints + filters.
- **Lint:** POSQueueScreen.tsx + its test → **0 warnings, 0 errors** (was 17 warnings).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- The header date control ("Today, May 06") remains a static label — the queue state has no date-range param, so an
  interactive control would be fake until backend windowing exists (same principle as Check-In / Tech Queue).
- The Manage drawer shares one reason field across its actions (only Cancel requires it here), matching the handler
  contracts; per-action distinct notes in one session is a minor UX refinement, not a wiring gap.
- Drawer/filters verified against the in-memory adapter + backend suite; not exercised against live Postgres this
  session.
