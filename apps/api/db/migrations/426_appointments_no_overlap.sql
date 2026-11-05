-- 426_appointments_no_overlap.sql — database-level double-booking guard on pos_tech_appointments (Jul 29, 2026).
--
-- WHY: insertBookingAtomic serializes with pg_advisory_xact_lock + an in-transaction conflict check. That is
-- correct on dedicated connections, but the SAME failure mode recorded for the reconciliation lock (migration 422)
-- applies here: a transaction-pooling proxy (PgBouncer) can route statements to different backends, making a
-- session-scoped serialization strategy porous. A concurrent-race probe in the sandbox demonstrated the hole
-- empirically (two simultaneous inserts for one slot both succeeded when the sessions merged). The fix is the same
-- class as 422: make the DATABASE the last line of defense. Holds already have this guard (372); appointments —
-- the rows that actually matter — did not, until now.
--
-- FORWARD-ONLY: EXCLUDE constraints cannot be added NOT VALID, so a historical double-booked pair anywhere in an
-- existing deployment would make a retroactive constraint fail to apply. The predicate therefore guards rows dated
-- 2026-07-30 onward: history is left alone (any legacy overlap is a human-resolution matter, not a migration
-- casualty), and every new booking is protected.
--
-- Half-open range '[)' as in 372: 10:00–11:00 and 11:00–12:00 are back-to-back, not a conflict.
-- Statuses: only rows that occupy the chair constrain — cancelled/no_show/completed never block a slot.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Times are 'HH:MM' TEXT; a text::time cast is not IMMUTABLE, so the range is built from split_part + int casts
-- (both immutable): minutes-of-day as an int4range. appt_date equates via btree_gist, so the range only needs the
-- time-of-day dimension.
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
  WHERE (status NOT IN ('cancelled', 'no_show', 'completed') AND appt_date >= DATE '2026-07-30');
