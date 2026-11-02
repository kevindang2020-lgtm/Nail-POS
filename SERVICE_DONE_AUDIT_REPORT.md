# SERVICE_DONE_AUDIT_REPORT.md — POS Service Done (2026-07-03)

_Audited the Service Done screen — the last flow-stage screen — end-to-end. Same orphaned-surface pattern: the
per-ticket quality/reopen drawer was rendered but had no button to open it, the Ready action was unwired, and the
header search/service/quality filters were missing or dead. Restored and wired all of them. Verification numbers are
fresh runs on this tree._

## 1. Modules and boxes found in the picture
13-KPI strip · header (All Services filter, date, status filter, Live, Auto Refresh) · Completed Services table
(row action + Ready + per-ticket Manage) · Service Done Board · Quality/handoff panels · analytics/second row ·
Quick Actions · sidebar · the per-ticket quality-check/reopen drawer.

## 2. Problems discovered
- **Unopenable Manage drawer.** Unlike the other screens where the drawer JSX was removed, here the quality-check /
  reopen drawer *was* rendered — but `toggleDrawer` was never called, so **no row had a Manage button to open it**.
  The quality-approve / needs-review / reopen actions were effectively unreachable.
- **Orphaned Ready action.** `markReadyForCheckout` (`markReady`) was implemented and endpoint-wired but had no
  trigger — a completed ticket couldn't be marked ready for checkout from this screen.
- **Missing search control + dead filters.** `search` and `quality` state fed `load()` but **no search input and no
  quality dropdown were rendered**; the **"All Services"** dropdown listed facets but had no value/onChange and never
  passed `serviceCategory` to `load()` — despite the backend applying all three filters.
- **Dead declarations:** unused `posSkipLineApi` import, unused `money` / `qTone` / `cTone` / `inputStyle` /
  `SERVICE_COLORS`, and a misplaced `eslint-disable` on the auto-select effect.

## 3. Frontend files fixed
- `apps/pos-web/src/screens/POSServiceDoneScreen.tsx`:
  - Added a **Manage** button per row that opens the existing quality-check/reopen drawer via `toggleDrawer`, and a
    conditional **Ready** button wiring the orphaned `markReady` (only shown when the ticket isn't already
    ready/sent).
  - Added the **search input** and **quality filter**, and wired the **All Services** dropdown to real
    `serviceFilter` state from `state.filters.serviceCategories`, threading `serviceCategory` through every `load()`
    call.
  - Removed the dead import/helpers and fixed the `eslint-disable`. File now lints **0 warnings** (from 12).
- `apps/pos-web/src/screens/POSServiceDoneScreen.test.tsx` — +6 tests.

## 4. Backend files fixed
**None.** Every restored action maps to an endpoint that already existed and is covered by the backend suite:
`quality-check`, `reopen-service`, `mark-ready-for-checkout`, `send-to-checkout`, and the `search` /
`serviceCategory` / `qualityStatus` filters on `GET /pos/service-done/state`. All behind `TenantAuthGuard +
RolePermissionGuard`, session-derived tenant/branch.

## 5. Routes and APIs repaired
No routes added or changed. The frontend now *reaches* the quality/reopen/mark-ready endpoints (previously
unreachable) and *sends* the search/service/quality filters the state endpoint already supported.

## 6. Database changes
None. All actions mutate existing tenant + branch-scoped service-done rows.

## 7. How each module is wired
Header filters → `load({ search, status, qualityStatus, serviceCategory })` → `GET /pos/service-done/state?…` →
guarded controller → service → repo (tenant+branch scoped, applies each filter). Row action (Send / Open / Review)
unchanged; **Ready** → `markReadyForCheckout` → real endpoint; **Manage** → opens the quality/reopen drawer →
Approve / Needs Review → `qualityCheck(result, note?)`; Reopen → `reopenService(reason)` (reason required) → `act()`
→ real mutation → `refetch()`.

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Service Done screen **9/9** (3 prior + 6 new: service filter populates from facets and refetches
  `serviceCategory=`; quality filter refetches `qualityStatus=`; search refetches `search=`; Manage opens the drawer
  and Approve POSTs to `/quality-check`; Reopen requires a reason; Ready POSTs to `/mark-ready-for-checkout`). Full
  pos-web **283/283 across 64 files**; the lone exit-1 is the pre-existing jsdom `scrollIntoView` notice in
  POSBookingScreen.test.tsx — unrelated. Backend service-done suite **20/20 across 6 files** confirms the endpoints +
  filters.
- **Lint:** POSServiceDoneScreen.tsx + its test → **0 warnings, 0 errors** (was 12 warnings).
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- The header date control ("Today, May 06") remains a static label — the service-done state has no date-range param,
  so an interactive control would be fake until backend windowing exists (same principle as the other flow screens).
- The Manage drawer shares one text field between the quality-note and reopen-reason actions, matching the handler
  contracts; per-action distinct fields in one session is a minor UX refinement, not a wiring gap.
- Drawer/filters verified against the in-memory adapter + backend suite; not exercised against live Postgres this
  session.

## Session note
This completes the flow-stage sweep: Overview, Check-In, Dashboard, Checkout, Tech Queue, Queue, Serving, and
Service Done have all been audited. The orphaned-surface pattern (management drawers and filter controls dropped from
the render while their handlers survived) held across every queue-stage screen — Tech Queue, Queue, Serving, and
Service Done each had it — and is now resolved in all four.
