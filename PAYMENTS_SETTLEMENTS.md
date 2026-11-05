# Sidebar wiring — Payments → Settlements (2026-07-06)

| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/payments/settlements | POSSettlementsScreen | GET /pos/payments/reconciliation | pos.reports.view |

New `posPaymentsApi` client (overview + reconciliation). Screen shows settlement KPIs
(count, gross settled, processor fees, net deposited) and refunds (count, total), plus a
reconciliation table, with a period control that maps to a from/to date range.

## Verification
- tsc 0 · build clean · lint clean.
- 2 new tests (KPIs render; 403 message). Full pos-web **348/348**.
  Note: the 403 test was split into its own file — vitest's cross-test unhandled-rejection
  tracking made it flaky when run right after the resolving KPIs test in the same file. Both
  behaviors are fully covered; no test was dropped.
- Live E2E through real guards: reconciliation endpoint anon **401** / authed **200**, returning
  {settlements:{count,grossCents,feeCents,netCents}, refunds:{count,totalCents}}.

## Sidebar tally
55 → **65** items on real screens.
- Reports: 7/13.  Payments: transactions, tips, settlements wired (3 items).
