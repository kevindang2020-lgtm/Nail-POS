# Dashboard Metric Definitions (§20) — single source of truth (dashboard.dto.ts helpers)
- **Today's Revenue** — completed/captured transactions for the business day (existing aggregate).
- **Average Ticket** = eligible revenue ÷ eligible paid count (`averageTicketCents`), zero-count safe → 0.
- **Customers Served** — completed visits today (no double counting per ticket).
- **Rebook Rate** = eligible completed visits with a future appointment ÷ eligible completed visits × 100
  (`rebookRatePercent`). Shown as "—" until the retention source is wired.
- **Utilization** = productive service minutes ÷ available scheduled minutes × 100, capped at 100 (`utilizationPercent`).
- **Staff on Duty %** = clocked-in ÷ scheduled × 100 (`onDutyPercent`).
- **Payment %** = method amount ÷ total collected × 100.
- **Trend %** = (current − previous) ÷ previous × 100; previous = 0 returns a finite new-growth value (never Infinity).
Dashboard and Reports MUST use these helpers so figures never diverge.
