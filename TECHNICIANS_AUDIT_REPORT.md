# POS Technicians Screen — Audit Report (2026-07-03)

**Screen:** `apps/pos-web/src/screens/POSTechniciansScreen.tsx` (305 lines) — the tenant technician roster (KPIs,
server-filtered table, create/edit drawers, attendance + performance modules).

## 1. Method
Followed the standard audit pattern: lint-first sweep, then a control-by-control trace against real backend endpoints,
verifying each interactive element does something the API actually honors (honest verification — never wire a control
the backend ignores).

## 2. Lint sweep
`eslint POSTechniciansScreen.tsx` → **0 warnings**. No orphaned-declaration signal, so any defect here is subtler than
a dropped-from-render surface. The audit therefore focused on *semantic* dead ends: controls that render but don't
reach the backend, and backend capabilities shipped to the client but never surfaced.

## 3. What was already correct (verified, not assumed)
- **Search + status filters** refetch server-side (`/pos/technicians/state`) — confirmed wired through the debounced
  effect.
- **Create / Edit / Save** hit real endpoints (`posTechniciansApi.create` / `.update`) with proper validation.
- **`nav('/tenant/team/profiles')`** — verified this is a **real registered route** (`tenant-nav.tsx` line 119,
  `team-profiles`), not a dead navigation stub. Left as-is.
- Role tabs, attendance groups, top performers, birthdays, training modules — all computed from loaded row data.

## 4. The finding — orphaned filter facets (backend-supported, never surfaced)
The backend `/pos/technicians/state` ships a `filterFacets` object **and** its `TechnicianFilters` DTO accepts a rich
set of filters — but the frontend only ever sent `search` + `status` and rendered only the `statuses` facet. The other
facet lists (`shiftStatuses`, etc.) were computed server-side, serialized to the client, and **thrown away unused** —
the orphaned-surface pattern, invisible to lint because `filterFacets` is destructured for its one `.statuses` use.

**Honest verification before wiring anything.** I traced each candidate filter through `filtersFrom()` (controller)
into `filtered()` (repository) to see which are *actually implemented* vs merely accepted-and-ignored:

| Filter | Controller parses | `filtered()` implements | Facet data shipped | Decision |
|---|---|---|---|---|
| `search` | ✅ | ✅ | — | already wired |
| `status` | ✅ | ✅ | ✅ `statuses` | already wired |
| **`shiftStatus`** | ✅ | ✅ | ✅ `shiftStatuses` | **surfaced (new)** |
| **`missingMapping`** | ✅ | ✅ (`serviceIds.length===0`) | — (boolean) | **surfaced (new)** |
| `workingStatus` | ✅ | ✅ | ❌ no facet list | left (no option source) |
| `canProcessPayment` | ✅ | ⚠️ returns none ("no schema") | ✅ | **deliberately NOT surfaced** |
| `skillGroup` | ✅ | ❌ ignored | ✅ (empty) | **deliberately NOT surfaced** |
| `serviceCategory` | ✅ | ❌ ignored | ✅ | **deliberately NOT surfaced** |
| `techAppEnabled` | ✅ | ❌ ignored | ✅ | **deliberately NOT surfaced** |
| `missingSchedule` | ✅ | ❌ ignored | — | **deliberately NOT surfaced** |

Wiring a filter the repository silently ignores would be a lie to the user (the UI would imply filtering that never
happens). So only the two genuinely-implemented, honestly-backable filters were surfaced.

## 5. The fix
Surfaced exactly the two backend-honored filters:
- **Shift Status** dropdown, populated from the real `filterFacets.shiftStatuses` (`on_shift` / `not_clocked_in` /
  `clocked_out`), wired into the debounced server refetch as `shiftStatus`.
- **Missing service mapping** toggle button, wired as `missingMapping=1`, showing only technicians with no services
  mapped (a real operational need at a large roster — find techs who can't be booked).

Both flow through the existing `queryArgs()` builder (added) so search, status, shift, and mapping compose correctly
and only non-empty params hit the wire (`buildUrl` drops `undefined`/empty).

## 6. Verification (fresh runs)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Lint:** `POSTechniciansScreen.tsx` **0 warnings**.
- **Tests:** `POSTechniciansScreen.test.tsx` **5/5** (was 3; +2 asserting the shift-status filter refetches with
  `shiftStatus=on_shift` and the toggle refetches with `missingMapping=`). Updated the canned facet to include shift
  statuses.
- **Full pos-web suite:** **300/300 across 64 files** (was 296; the pre-existing benign `scrollIntoView` jsdom notice
  from POSBookingScreen.test.tsx still makes the runner exit 1 — not a failure).
- **Build:** pos-web build **clean** (164 modules, ~5s).
- **Backend:** no backend change — only surfaced existing, verified-implemented filters; `filtersFrom()`→`filtered()`
  already parse and honor `shiftStatus` and `missingMapping`.

## 7. Files changed
- `apps/pos-web/src/screens/POSTechniciansScreen.tsx` — added `shiftStatus` + `missingMapping` state, a `queryArgs()`
  builder, and the two filter controls.
- `apps/pos-web/src/screens/POSTechniciansScreen.test.tsx` — shift-status facet in the canned payload; +2 tests.

## 8. Deliberately NOT changed (and why)
- `skillGroup`, `serviceCategory`, `techAppEnabled`, `missingSchedule`: accepted by the DTO but **not implemented** in
  `filtered()`. Not surfaced. If you want these as real filters later, they need repository implementation first —
  then the UI can honestly expose them. Flagged here so the DTO/impl gap is visible.
- `canProcessPayment`: implemented but always returns none ("no schema") — surfacing it would render an always-empty
  filter.
- `workingStatus`: implemented but the backend ships no option list for it; the attendance chips already convey this
  dimension, so a redundant dropdown wasn't added.

## 9. Net outcome
One real defect closed honestly: two backend-supported filters that were computed and shipped but never usable are now
wired end-to-end and tested; four accepted-but-unimplemented filters were correctly left unsurfaced with the DTO/impl
gap documented rather than papered over with dead UI.
