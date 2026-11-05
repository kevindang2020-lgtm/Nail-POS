# tech-web hardening — Earnings + Queue (both verified clean)

Two more tech-web screens audited; both are correctly built. Coverage added to lock the parts most likely to drift.

## TechEarningsScreen (money, read-only) — clean
Day/Week/Month each read `/tech/earnings/detail`. Checked the things that matter for a money screen:
- **The "Sales" metric is period-correct.** It reads `snapshot.todaySalesCents`, whose name (inherited from the dashboard
  snapshot) is misleading — but the detail endpoint computes it by reducing over the *selected period's* ranged lines
  (`tech.service.ts` line 214: `a.todaySalesCents + l.lineTotalCents`). So Day/Week/Month each show their own ranged sales,
  not literally today's. The breakdown total (Σ `lineTotalCents`) and commission are consistent with the snapshot.
- **Total Earnings = commission + tips** (tips are actually computed server-side via `tipsFor`, not hard-zero), the service
  breakdown correctly groups by service name, sums line totals, counts quantity, and sorts by amount desc.
- Wiring is exact: the endpoint returns the full `{ snapshot, lines, period, dateFrom, dateTo }` and the client type matches.
No bug. **5 tests**: total = commission + tips; period metrics; breakdown grouping + desc sort; period re-query; empty state;
load error.

## QueueScreen (read + break actions) — clean
Reads `/tech/queue/state`; break actions hit `/tech/status/start-break` and `/end-break`. Verified the typed
`TechQueueState`/`TechQueueCustomer` fields (`turnPosition`, `upNext`, `following`, `onBreak`, `serviceSummary`,
`scheduledTime`) against the repository's `queueState` mapper — all match. The break actions call the real endpoints.
- **Observation (not a bug):** "Take Lunch Break" and "Take Short Break" both call `startBreak()` with no distinguishing
  argument — because the backend `setBreakState(ctx, onBreak, managerOverride)` has no break-type parameter. The read model
  recognizes a `lunch` status, but there's no write path to set lunch-vs-short from the tech app. The screen is correctly
  wired to the available API; distinguishing the two would need a backend change + a product decision, so it's left as-is
  rather than padded in.
No bug. **5 tests**: turn position + waiting copy + up-next/following; the not-active and empty states; start break; end
break; load error.

## Verification
tech-web `tsc` clean, **52 tests pass** (10 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean,
pos-web 75 / clean, backend 603 / PASS — all unchanged; read-only screens, only new tests added.)

## Remaining in tech-web (untested)
LoginScreen, MoreScreen, NotificationsScreen, SettingsScreen, TechFollowUpsScreen, TechProfileScreen (236 loc — largest
remaining, mutation-heavy), TechScheduleScreen, TechDeleteAccountScreen, and the static Privacy/Terms screens.
