# Booking — round 12 (agent 2): KPI cards, top-bar / sidebar freeze, no-print, Overview separation

Spec: booking200 addendum (controlling) §03, §08, §10, §13, §14, §17 (P-01, P-04, P-05, P-07, P-11), §18 (B-01–B-05, B-13,
B-20). Measurements: `docs/PERFORMANCE_REPORT.md`.

## 1. The six KPI cards (§08)

`GET /pos/booking/kpi-cards?date=YYYY-MM-DD&arrivingWindowMinutes=N` (permission `pos.booking.view`, tenant + branch from the
session, read-only) → `BookingKpiCards` (`packages/api-contracts/src/tenant/booking.ts`). Server: `BookingService.kpiCards`
(`modules/booking/src/booking/booking.service.ts`). POS: `apps/pos-web/src/screens/booking/BookingKpiStrip.tsx`, mounted in
`POSBookingScreen`'s `data-module-id="booking-kpis"` block (the only change to that screen besides its import and the
removal of the browser-side KPI arithmetic the block used).

| Card | Definition (source) | Another date | Tap |
|---|---|---|---|
| Appointments | canonical appointments of the date in `pos_tech_appointments` — one per appointment, never per service line — minus cancelled / no-show; split: awaiting confirmation (`booked`), confirmed, in salon, completed | that date's count | appointment list (status filter cleared) |
| Arriving soon | `booked` / `confirmed` starting within [now, now + window]; window default 60, bounded 5–240, chosen per tab (30/60/90/120) | "—" Today only | list filtered to confirmed (unchanged behaviour) |
| Walk-ins | walk-in appointments of the date (not cancelled / no-show) + Customer Queue walk-in visits checked in that branch day (`pos_queue_items`, no `appointment_id`, source ≠ `appointment`, not cancelled / removed) | that date's count | list filtered to source walk-in |
| Waitlist | guests in status `waiting` in this branch's live Customer Queue now (no page cap) | "—" Live — today only | Customer Queue |
| Available now | active technicians inside a working window now and not in a chair-holding appointment at this minute — the SAME rule as the technician page's `availableNowCount` (`availableNowAmong`) | "—" + "N scheduled that day" (the date mismatch is stated) | — (no list) |
| Booked revenue | integer cents: service-line prices (incl. add-ons and approved overrides) of non-cancelled, non-no-show appointments; excludes tax, tips, surcharges, discounts, deposits; labelled "Booked services · not collected" with the basis in the tooltip | that date's subtotal | — |

States: `ok` · `not_today` · `unavailable`. Each source is read on its own; a failed source turns only its cards
`unavailable` (logged), which the strip shows as "—" + "Could not load — not zero"; a failed request keeps the last good
numbers marked stale with Retry. Nothing is computed in the browser. SMS-verification-pending bookings are not appointments
until verified (migration 521: a verified session is consumed by exactly one appointment), so the Appointments card cannot
count them; it distinguishes booked (awaiting confirmation) from confirmed.

Layout: six equal cards in one row when the strip is ≥ 72 rem wide, 3 × 2 from 42 rem, 2 × 3 below, equal-height rows
(Tailwind container query on the strip itself — the sidebar's state never breaks it). Booking-scoped classes only.

Tests: `modules/booking/src/booking/booking-kpi-cards.pgtest.vitest.spec.ts` (10, real schema),
`apps/pos-web/src/screens/booking/BookingKpiStrip.test.tsx` (9), `apps/pos-web/src/screens/POSBookingScreen.no-print.test.tsx`
(the page asks `/kpi-cards` for the board date and renders those numbers).

## 2. Top bar + sidebar freeze (§03, P-01)

Guard: `apps/pos-web/src/guards/frozen-shell.test.ts` + lock `apps/pos-web/src/guards/frozen-shell.lock.json` + helper/CLI
`apps/pos-web/scripts/frozen-shell.mjs`. Frozen: `src/shell/POSLayout.tsx`, `tenant-nav.tsx`, `tenant-access.ts`,
`TopSearch.tsx`, `ProfileMenu.tsx`, `LanguageSwitch.tsx`, `PlatformAnnouncementBar.tsx`, `AlertReadPanel.tsx`,
`BadgeCheckDialog.tsx`, `src/realtime/RealtimeStatusPill.tsx`, and every rule in `src/styles.css` whose selector targets
`.topbar` / `.sidebar` / `.sidefoot` / `.nav` / `.navlink` / `.shell` (85 rules at the baseline). SHA-256 of each file (LF
normalised) and of the normalised shell rules. The test also fails when Booking-scoped CSS (`.css` or JSX `<style>` in the
Booking screen, `screens/booking/**`, `packages/booking-schedule-board/src/**`) starts a selector at html / body / header /
nav / aside / main / button / `*` or names a shell class.

**Update procedure (owner approval required):** 1) the owner approves the specific top-bar / sidebar change in writing
(who, when, why); 2) make the change in its own commit; 3) run
`node apps/pos-web/scripts/frozen-shell.mjs --approve "<owner name>" --reason "<what and why>"` — it rewrites the
fingerprints and appends an approval (with the fingerprint it approved) to the lock's history; 4) name the approval in the
commit message. A hand-edited hash without a matching new approval entry fails the test. Without `--approve` the script is
read-only and prints which frozen files differ.

## 3. No schedule printing in Booking (§10, P-04, P-05, B-20)

- Source level: `apps/pos-web/src/guards/booking-no-print.test.ts` — the Booking screen, New Booking, Add Walk-In,
  `screens/booking/**` and `packages/booking-schedule-board/src/**` (when merged): no `window.print` / print call, no
  `@media print`, no Ctrl/Cmd+P handler, no print route, no printer icon, and no label — literal or any translated key the
  Booking UI uses, in EN and VI — that offers printing. Each scanner is proven against a planted control.
- Rendered: `apps/pos-web/src/screens/POSBookingScreen.no-print.test.tsx` — no element whose text / aria-label / title says
  print on the page or in View All Techs; Ctrl/Cmd+P never calls `window.print`.
- The repository gate `apps/api/scripts/check-no-print.mjs` passes.

## 4. Booking Overview analytics stay out of the calendar (§14)

Verified in the POS Booking page: the schedule region (`data-module-id="booking-schedule"`, the 12-column calendar) holds
the calendar only. The KPI strip is above it; the analytic modules — Appointments by status (`booking-status-list`),
Channel / Service mix (`booking-mix`), Upcoming appointments (`booking-upcoming`), Available technicians (`booking-team`),
Quick actions (`booking-quick-actions`) — render after it, outside it. Pinned by the third test in
`POSBookingScreen.no-print.test.tsx`. The Owner app keeps its own `apps/owner-web/src/screens/BookingOverviewScreen.tsx`.
Nothing analytic was added to the calendar in this round.
