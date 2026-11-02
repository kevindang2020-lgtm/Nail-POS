# Backend filter-gap close + Reports/Communications screen audits (2026-07-03)

Two tracks in one pass: (A) implement the accepted-but-ignored repository filters where real data backs them, and
(B) audit the two remaining un-audited POS screens with the lint-first + honest-verification method. Both tracks are
governed by the same rule: never surface or implement a control the data can't honestly support.

## A. Backend filter DTO/impl gap — closed honestly

The DTOs accepted more filters than the kysely repos implemented. I implemented the ones with real backing columns and
**documented (not faked) the ones with no schema.**

### Services (`services.kysely.repository.ts`)
- **Implemented `bookingEnabled`** → against the real `customer_app_booking_enabled` column, which existed in the
  schema (migration 006) and was written on create but never selected/mapped or filtered. Added it to the select, the
  Row type, and the row mapping, then implemented the filter.
- **Left unimplemented, with a NOTE explaining why:** `taxable`, `checkoutEnabled`, `technicianSkillGroup`. There is no
  backing column — `tax_setting` exists only on the `service_templates` table (not `services`), and per-service
  required skill groups aren't modeled. The old code hardcoded `isTaxable:true, checkoutEnabled:true`; filtering on
  those fabricated always-true values would be dishonest, so they stay no-ops until the schema supports them.

### Technicians (`technicians.kysely.repository.ts`)
- **Implemented `serviceCategory`** → via a new service_id→category_id map (join to `services`), so "techs who perform a
  service in category X" is a real filter.
- **Implemented `missingSchedule`** → via a presence check against the `technician_schedules` table (migration 003).
- **Left unimplemented, with a NOTE:** `skillGroup`, `techAppEnabled`. The repo header already states skill groups and
  per-tech app-access have no tables (it returns hardcoded defaults `skillGroups:[]`, `techAppEnabled:true`), so
  filtering on them would be dishonest.

### Honest note on the two repo drivers
The IN-MEMORY repos filter on `skillGroup`/`taxable`/etc. because their fixtures fabricate those fields; the KYSELY
(real DB) repos cannot, because the columns don't exist. This is acceptable — in-memory is a dev/test fixture — and the
two drivers are now aligned on every filter with real backing data (`bookingEnabled`, `serviceCategory`,
`missingSchedule`). The divergence that remains is precisely the set of filters the real database honestly can't serve.

## B. Screen audits

### Reports (`POSReportsScreen.tsx`) — one honesty defect fixed
- Lint-clean. State/export endpoints (`/pos/reports/state`, `/pos/reports/export`) are real and permissioned; the
  `type` param (sales/tax/customers/technicians) is honored by the repo; all nav targets (`/tenant/inventory`,
  `/tenant/team/payroll`) are registered routes; email/schedule buttons already disclose "not connected yet."
- **DEFECT FOUND + FIXED:** PDF/Excel export is not implemented server-side — the service returns
  `{ disabledReason: 'Export is not configured yet.' }`. But the frontend's `doExport` didn't read `disabledReason`, so
  clicking **"Export PDF"** (and the "Daily Report" quick action, which requests PDF) fell through to showing
  **"Export generated."** — claiming success for a no-op. Fixed `doExport` to surface `disabledReason` honestly and to
  only claim "generated" when a CSV/filename actually came back.

### Communications (`POSCommunicationsScreen.tsx`) — five dead-end navigations fixed
- Lint-clean. The core inbox is genuinely solid: `getState/getThread/reply/markRead` hit real `/pos/communications`
  endpoints, and the channel/status/search filters are applied end-to-end (repo `listThreads` applies status, channel,
  assignedTo, unreadOnly, and an ilike search across four fields). The insights panel already discloses "not connected
  yet."
- **DEFECT FOUND + FIXED:** five buttons navigated to routes that are **not registered and have no screen component** —
  `/tenant/communications/ai-receptionist`, `/tenant/communications/templates`, `/tenant/communications/reminders`
  ("Open AI Receptionist", "Open Templates", and the "AI Receptionist", "Create Template", "Schedule Reminder" quick
  actions). Each was a dead end (blank/404). Replaced all five with honest `setNote('… isn't connected yet.')` messages,
  matching the screen's own existing pattern. The still-real nav targets (`/tenant/marketing/campaigns`, `/follow-ups`,
  `/reports`) are unchanged.

## Verification (fresh runs)
- **api:** tsc 0; lint 0; new `backend-filter-gap.vitest.spec.ts` **5/5**; full api suite **2582/2582 across 411
  files**; build clean.
- **pos-web:** tsc 0; lint 0; new Communications regression test added; full suite **303/303 across 64 files** (the
  suite's exit code is the long-standing benign jsdom `scrollIntoView` notice, not a failure); build clean.

## Files changed
- `apps/api/src/services/services.kysely.repository.ts` — map + filter `customer_app_booking_enabled`; NOTE on
  unimplementable filters.
- `apps/api/src/technicians/technicians.kysely.repository.ts` — serviceCategory + missingSchedule loads/fields/filters;
  NOTE on unimplementable filters.
- `apps/api/src/services/backend-filter-gap.vitest.spec.ts` — new.
- `apps/pos-web/src/screens/POSReportsScreen.tsx` — honest `disabledReason` handling in `doExport`.
- `apps/pos-web/src/screens/POSCommunicationsScreen.tsx` — five dead-end navs → honest not-connected notes.
- `apps/pos-web/src/screens/POSCommunicationsScreen.test.tsx` — regression test for the dead-route fix.

## Outcome
Every POS screen with a filter/action surface has now been audited. The pattern held once more: backends accept more
filters than they implement, and frontends surface actions the backend can't fulfill (PDF export; dead-route buttons).
Both classes are now either implemented against real data or honestly disclosed — no control claims a capability the
system doesn't have.
