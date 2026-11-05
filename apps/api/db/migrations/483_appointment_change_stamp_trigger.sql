-- 483_appointment_change_stamp_trigger.sql — Smooth Refresh spec §15, §25, §59 (Sep 30 2026).
--
-- The Booking board change feed (GET /pos/booking/changes?since=) returns appointments whose updated_at moved past
-- the client's cursor, and drag/drop conflict detection compares `version` (482). Both are only as good as the
-- writers: ten code paths update pos_tech_appointments (booking, tech app start/finish, check-in, queue, service done,
-- customer booking, customer merge…) and not all of them set updated_at, and only the booking repository bumps version.
-- A change nobody stamps is invisible to the feed and to a stale-copy check. So the DATABASE stamps every update:
--   * updated_at := clock_timestamp()  — the statement's wall time (closer to commit than now(), which is the
--     transaction's START; the feed still reads with a look-back window for transactions that commit late)
--   * version    := OLD.version + 1 unless the writer already bumped it (the booking repository sets version + 1
--     itself — no double bump)
-- Self-sufficient: the columns this trigger (and the booking repository) rely on are re-declared idempotently. On a
-- real database 482 already added them and these are no-ops; on an engine where 482's EXCLUDE constraint cannot be
-- built (PGlite has no btree_gist, and a failed multi-statement file rolls back as a whole) the trigger would otherwise
-- reference a missing column and break EVERY update of the table.
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS version             INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_ok         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_reason     TEXT;
ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS overbook_by_user_id TEXT;

CREATE OR REPLACE FUNCTION pos_tech_appointments_stamp_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_tech_appointments_stamp_change ON pos_tech_appointments;
CREATE TRIGGER trg_pos_tech_appointments_stamp_change
  BEFORE UPDATE ON pos_tech_appointments
  FOR EACH ROW EXECUTE FUNCTION pos_tech_appointments_stamp_change();
