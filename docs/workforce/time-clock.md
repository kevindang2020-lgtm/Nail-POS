# Time clock (Technician Profile mandate §23–§25, §106, §147)

Full design: [time-clock-and-breaks.md](time-clock-and-breaks.md). Summary for the profile system:

- **Punches**: `technician_shifts` open punch (580 partial unique → one open punch per technician, split shifts allowed) +
  `technician_breaks` (break / lunch, classification 603). Clock IN / OUT / BREAK START / BREAK END from the Tech app
  (`/tech/time-clock/*`) or the POS kiosk Clock PIN (`technician_clock_pins`, per-kiosk failure limiter). Server time is authoritative;
  the business day is the branch's time zone.
- **One transition per tap (§106)**: clock-in is idempotent (a repeat returns the open punch, no second audit); an illegal move is
  `CLOCK_STATE_CONFLICT` (409).
- **Workforce state (§10/§147)**: every punch/break updates `technician_workforce_state` (clock → CLOCKED_IN / ON_BREAK /
  CLOCKED_OUT; queue → BREAK / AVAILABLE / OFF_SHIFT) through the CAS machines, so the queue and Fair Turn see a break at once.
- **Corrections (§25)**: a manager correction (`/pos/technician-clock/timecards/:shiftId/adjust`) is ONE transaction: the trail row
  (original time, corrected time, reason, actor, timestamp) + the punch + `audit_events`; closing an open punch clocks the
  workforce state out. Technicians cannot edit their own punches.
- **Where it shows**: POS Time Clock screen, POS Technician Profile page → "Time clock · time off · certifications"
  (live status, not-taking-customers toggle, time off requests, certifications), tech app Time Clock + Time Off.
