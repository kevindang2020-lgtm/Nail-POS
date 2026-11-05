# Technician performance (turn reports)

All the numbers come from the same turn events and time-clock rows. These reports are an operational diagnostic, not
payroll.

- **Fairness** (`GET /pos/turn-queue/fairness`).
  - Each technician's expected share is the team's opportunity units, split by her share of eligible ready time.
  - Actual = credited units + adjustments.
  - The gap is labelled `WITHIN_FAIR_RANGE`, `BELOW_EXPECTED_OPPORTUNITY` or `ABOVE_EXPECTED_OPPORTUNITY`. The range is
    `fairRangeUnits` / `fairRangePercent`. The word "unfair" is never used.
  - Skips by reason explain why totals differ.
- **Team report** (`GET /pos/turn-queue/reports/team?period=day|week|month`).
  - Covers:
    - time: clocked, paid / unpaid break, service, ready, utilization
    - walk-ins and appointments by category
    - turns, overrides and fairness
  - Technicians are listed alphabetically, never as a revenue ranking.
  - Money (sales, commission, tips, estimated earnings, approved / paid) comes from compensation snapshots and payroll
    lines. It is shown only to holders of `payroll.view` or `technicians.view_pay`.
- **Per technician.**
  - `GET /pos/turn-queue/technicians/:id/summary` shows the period plus the previous period and the trend.
  - A technician sees her own summary (`GET /tech/turn-queue/summary`), including her own earnings estimate.
