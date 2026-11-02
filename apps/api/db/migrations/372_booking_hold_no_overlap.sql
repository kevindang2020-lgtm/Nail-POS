-- 372_booking_hold_no_overlap.sql -- stop two DIFFERENT sessions from holding the same technician at the same time.
--
-- == FOUND BY THE LOAD TEST, NOT BY REASONING ==============================================================
--
-- The concurrency harness (scripts/booking-verification-load-test.mjs) fired 20 simultaneous holds from 20
-- DIFFERENT booking sessions at ONE technician's slot. All 20 were accepted.
--
-- The unique index from migration 367 does not cover this: it enforces one live hold per *session*, which stops a
-- single customer parking five slots. It says nothing about two customers racing for the same one.
--
-- The only thing standing between them was the service's overlap check -- which READS the live holds, then WRITES.
-- Between the read and the write there is a window, and under concurrency a window is not a theory.
--
-- The consequence is NOT a double-booking: `uq_booking_holds_appointment` still guarantees one hold becomes one
-- appointment, so the loser is caught at conversion. But both customers are told "your slot is reserved", both
-- verify their phone, and one of them is refused at the final step -- after doing everything right. That is a
-- terrible experience and it is entirely avoidable.
--
-- == THE FIX ===============================================================================================
--
-- An EXCLUSION constraint: the database itself refuses a hold whose time range overlaps a live hold on the same
-- technician. No read-then-write, no window. This is the only construct that can express "these two rows conflict
-- on a RANGE", which is exactly the shape of the problem and exactly why a unique index cannot do it.
--
-- WHERE clause: only LIVE holds constrain. A released or converted hold must not block the slot forever.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE booking_holds
  ADD CONSTRAINT booking_holds_no_overlap
  EXCLUDE USING gist (
    tenant_id     WITH =,
    branch_id     WITH =,
    technician_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (released_at IS NULL AND converted_appointment_id IS NULL AND technician_id IS NOT NULL);

-- Half-open range '[)' deliberately: a 10:00-11:00 hold and an 11:00-12:00 hold do NOT overlap. Treating the
-- boundary as a conflict would make back-to-back appointments impossible, which is how salons actually run.
--
-- `technician_id IS NOT NULL` in the predicate: a "first available" hold has no technician yet, so it cannot be
-- expressed as a range conflict against one. Those are still handled by the service's overlap rule (a
-- first-available hold conflicts with EVERY technician at that time), which is conservative and correct -- it
-- just cannot be pushed into the database.
