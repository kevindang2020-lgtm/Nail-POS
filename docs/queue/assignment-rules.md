# Assignment rules

The rules live in `turn_policy` on the versioned settings rows (`queue_assignment_tenant_settings`, plus the branch
override). The recommended nail-salon defaults are `RECOMMENDED_TURN_POLICY` in `turn-core.ts`. Saving runs through
`PUT /pos/ai-queue-assignment/settings`. Before saving, `POST /pos/turn-queue/settings/preview` shows Current → New, with
the effect of each change. Each save is versioned, and every turn event records the policy version it ran under.

Key rules:

- **Requested guest** (`requestedClientTurnPolicy`). The default does not consume a rotation turn.
- **Appointments** (`appointmentTurnPolicy`). The default counts only "any technician" appointments
  (`pos_tech_appointments.any_technician`).
- **Appointment protection.** A technician whose appointment starts within the buffer (10 min by default) is
  ineligible.
- **Turn units.** `turn_unit_rules` are versioned, with one active rule per service, category or duration. The most
  specific rule wins: service, then category, then duration, then the default. Saving again supersedes the old version
  and keeps it in history.
- **Declines.**
  - A technician who declines for a safety or eligibility reason never loses a turn. These reasons are:
    - `NOT_LICENSED`
    - `NOT_SKILLED`
    - `MEDICAL_RESTRICTION`
    - `PHYSICAL_LIMITATION`
    - `EQUIPMENT_UNAVAILABLE`
    - `APPOINTMENT_CONFLICT`
    - `MANAGER_DECISION`
    - `MANAGER_APPROVED`
  - For a personal decline, `technicianDeclinePolicy` applies.
  - An offer that times out follows `offerTimeoutPolicy`.
  - When the guest declines a technician (`CUSTOMER_DECLINED`), that technician is not offered this guest again.
- **Age boost.** In the unit modes, a capped boost applies after `ageBoostAfterMinutes` of ready wait. It is
  documented in the "why" lines.
