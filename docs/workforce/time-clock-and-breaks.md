# Time clock and breaks

The time clock (`modules/workforce/src/time-clock`) is the source for clock-in and break. Each move goes through the ONE
workforce state, and the turn ledger hook keeps the rotation in step.

- **Break policy.** `time_clock_break_policies` holds the salon and branch layers (migration 603). It is read with
  `GET /pos/time-clock/break-policy` and edited with `PUT /pos/time-clock/break-policy` (`payroll.manage`). The default
  is `DEFAULT_BREAK_POLICY` (`break-policy.ts`, U.S. federal shape):
  - A rest break is paid up to 20 minutes.
  - A meal of 30 minutes or more, with no work, is unpaid.
  - A meal interrupted by work is paid.

  The jurisdiction is recorded but not interpreted. A state can be more protective.
- **Classification.** When a break ends, or the technician clocks out, the break is classified as one of:
  - `paid_rest`
  - `unpaid_rest_excess`
  - `unpaid_meal`
  - `paid_meal_short`
  - `paid_meal_interrupted`

  The paid and unpaid minutes and the policy version are stored on `technician_breaks`. The queue never decides pay.
- **Interruptions.** `POST /pos/time-clock/break-interrupt` records that a technician was called back during a break.
- **Corrections.** `POST /pos/technician-clock/breaks/:id/adjust` adds a trail row (`technician_timecard_adjustments.break_id`)
  and re-classifies the break. The change is audited.
- **Screen.** The Time Clock screen shows today's breaks, with their classification, under each technician's shifts.
