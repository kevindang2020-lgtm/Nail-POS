# customer-web hardening — VisitScreen (verified clean)

Audited "My Visit" — the live in-progress display fed by `GET /customer/service-progress` (polls every 15s, ticks the elapsed
clock each second). It checks out.

## Verified clean
- **Wiring is exact and typed.** `customerApi.serviceProgress()` returns `CustomerActiveService | null`; the backend
  `getServiceProgress` returns `{ ticketId, serviceName, status, startedAt, elapsedSeconds, progressPercent,
  estimatedFinishTime }` (customer.service.ts 54) — matching the interface and every screen read. `null` cleanly means "no
  service in progress" and renders the friendly empty state.
- **The live clock and progress are robust.** Elapsed is computed from `startedAt` against a 1s-ticking `now`, falling back to
  the server's `elapsedSeconds`; `fmtElapsed` floors at 0 (no negative time); the progress bar clamps to 0–100; `fmtFinish`
  guards both null and an unparseable date; the "almost ready" cue fires at ≥80% or `nearly_finished`.
- **No timer leak.** Both the 15s poll and the 1s tick are cleared on unmount.

No bug. **5 tests** added: the active render (name / "In progress" / 45% / "Elapsed 2:30"); the almost-ready cue near
completion; the ready-for-checkout status label; the no-active-service empty state; and the error path.

## Verification
customer-web `tsc` clean, **124 tests pass** (40 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 75,
tech-web 74, backend 603 / PASS — all unchanged; read-only screen, only new tests added.)

## Sweep status
**10 fixes** to date (admin-web 6, owner-web 3, pos-web 1, tech-web 1). customer-web coverage now includes the tech profile,
find-techs discovery, the visit display, rating/social/showcase flows, and more. Remaining customer-web: SalonTechsScreen,
NailShowcasePostDetailScreen, Login, and assorted small cards.
