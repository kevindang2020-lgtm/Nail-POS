# Dashboard Metric Definitions (canonical, used by `/pos/dashboard/state`)

All money is integer cents. All queries filtered by `tenant_id` and `(branch_id = :branchId OR branch_id IS NULL)`; scope is session-derived (browser-supplied tenant ignored).

- **Today's Revenue** — Σ `payments.amount_cents` where `status ∈ {completed,paid,captured}` and payment day = business date. Excludes failed/void/uncaptured/refunded. Trend = vs yesterday; zero-denominator → "new activity" (100 if cur>0 else 0), never ∞.
- **Monthly Card Volume** — Σ `payments.amount_cents` where status captured-set and `method ∈ {card,credit,debit,credit_card}` for the current month-to-date.
- **Check-Ins Today** — count of `tickets` created on the business date.
- **Appointments Today** — count of `pos_tech_appointments` on the date (all statuses; cancelled shown via remaining math).
- **Active Services** — `tickets` with `serving_started_at` set and `service_done_at` null (same canonical status as Serving/Tech Queue/Service Done/Checkout).
- **Average Ticket** — today revenue ÷ count of `tickets` with `paid_at::date` = date; zero-safe.
- **Staff On Duty** — distinct technicians in `technician_statuses ∈ {available,busy}` ÷ distinct technicians scheduled in `technician_shifts` for the date.
- **Customer Retention** — per-customer ticket history: returning / new (first visit this month & ≤1 visit) / inactive (last visit > 60 days) ÷ eligible customers.
- **AI Booking Conversion** — `pos_tech_appointments.source ∈ {ai,ai_phone}` ÷ total appointments today × 100. Card shown only when an AI package is active (else locked state, no fake data).
- **Operations tiles** — Waiting Guests = queue waiting; Walk-Ins = appts `source ∈ {manual,phone}` (÷ check-ins for %); Ready-for-Checkout = tickets ready & unpaid (+ Σ `total_cents` for est. value); Completed Services = completed appts; No-Shows = no_show appts (÷ total for %); Upcoming = booked/confirmed appts with `start_time::time` within `current_time … +3h`.
- **Top Technician** — Revenue = Σ `ticket_service_lines.line_total_cents`; Services = line count; Tips = Σ `tickets.tip_cents` by `primary_technician_id`; Rating = avg approved `reviews.rating` by `technician_id`; Utilization = busy service-minutes (Σ `pos_tech_appointments.duration_minutes`) ÷ scheduled shift minutes (`technician_shifts` end−start), null when no shift.
