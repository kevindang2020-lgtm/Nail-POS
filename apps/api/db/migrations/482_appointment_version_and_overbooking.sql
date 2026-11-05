-- 482_appointment_version_and_overbooking.sql — Smooth Refresh / Booking Concurrency spec §9, §11, §15, §59 (Sep 30 2026).
--
-- 1. pos_tech_appointments.version — optimistic-concurrency version, incremented by every mutating write (the repo
--    does it in the same UPDATE). A client that drags/reschedules sends expectedVersion; a stale copy gets
--    VERSION_CONFLICT instead of silently overwriting a newer change (§14–§16, §50). Realtime frames carry it so a
--    client can drop an older frame (§59/§60).
-- 2. Intentional overbooking (§11). Migration 426's EXCLUDE constraint made ANY overlap impossible at the database, so
--    the existing allowOverbooking / managerOverride paths could never actually create an overlapping row (the
--    constraint threw 23P01 → a 500). An overbooked appointment is now an explicit, audited decision recorded ON THE
--    ROW (who, why), and only such rows are exempt from the no-overlap guard. Everything else stays protected.
--    EXCLUDE constraints cannot be altered in place: drop + re-add with the extended predicate. Every existing row
--    satisfied the old constraint, so re-validation on add cannot fail.
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS version            INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_ok        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_reason    TEXT;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_by_user_id TEXT;

ALTER TABLE pos_tech_appointments DROP CONSTRAINT IF EXISTS pos_tech_appointments_no_overlap;
ALTER TABLE pos_tech_appointments
  ADD CONSTRAINT pos_tech_appointments_no_overlap
  EXCLUDE USING gist (
    tenant_id     WITH =,
    technician_id WITH =,
    appt_date     WITH =,
    int4range(
      (split_part(start_time, ':', 1)::int * 60 + split_part(start_time, ':', 2)::int),
      (split_part(end_time,   ':', 1)::int * 60 + split_part(end_time,   ':', 2)::int),
      '[)'
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show', 'completed') AND appt_date >= DATE '2026-07-30' AND NOT overbook_ok);

-- §25/§26 delta sync (next phase) reads "what changed since": the cursor is (updated_at, id) per tenant/branch.
CREATE INDEX IF NOT EXISTS idx_pos_tech_appointments_tenant_branch_updated
  ON pos_tech_appointments (tenant_id, branch_id, updated_at, id);
