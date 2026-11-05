# Technician rotation

The rotation is held as daily state per branch, technician and business day (`technician_turn_state`). Every change is
also written to an append-only event log (`technician_turn_events`, with a unique sequence number per branch-day). The
business day is the branch's local date, from `branchTimeZone`.

- **Join.**
  - Clocking in moves the ONE workforce state (`workforce-status` cas). In the same transaction, a hook writes `JOIN`.
  - The join position comes from `clockInJoinPosition`: back of the queue (the default), a position the manager picks,
    or the fairness baseline.
  - The start of day is ordered by clock-in, by schedule, by yesterday's carryover, or by the manager.
- **Break.**
  - A break sets the technician to `BREAK`.
  - Coming back keeps her place under `PRESERVE_POSITION` for up to `preservePositionForMinutes`. After that, the
    `afterPreserveWindow` setting applies.
  - A queue **hold** is a manager action (`HOLD` / `RELEASE`). It is not a payroll break.
- **Clock out.** `CLOCK_OUT` takes her out of the rotation.
- **Daily reset.** Every 5 minutes a sweep (`turn-queue-day-close.scheduler.ts`) closes past business days with
  `DAY_CLOSE`, then re-joins anyone still clocked in, with reason `DAY_START`. A manager can close a past day from the
  board. The current day cannot be closed.
- **Visibility.** The Technician App reads `GET /tech/turn-queue`. The `technicianQueueVisibility` setting controls what
  it shows:
  - `FULL_TEAM_QUEUE`: the whole team.
  - `POSITION_ONLY`: her own rank and the queue length.
  - `NEXT_FEW`: the first `nextFew`.
  - `PRIVATE_POSITION`: her own rank only.

  It never shows other technicians' money.
- **Realtime.** Every change writes `technician.turn_queue_changed` to the outbox. The projection sends
  `turn_queue_updated` to the branch room and to each affected technician.
