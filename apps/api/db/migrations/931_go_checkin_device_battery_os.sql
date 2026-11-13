-- 931_go_checkin_device_battery_os.sql — Tablets 02 "Connection & Battery Health" for Go Check-In kiosks / iPads (extras round
-- 10, Nov 13 2026; agent 3 range 930–939). The same four facts as migration 930 gives the customer displays: the OS and the
-- battery the device's own browser exposes, sent with the session heartbeat. Not reported = NULL (never guessed);
-- battery_reported_at dates the battery reading so a stale figure is never shown as the current level.
-- Additive, nullable, idempotent. Rollback: drop the four columns.
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS os_version TEXT;
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS battery_percent INTEGER;
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS battery_charging BOOLEAN;
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS battery_reported_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE go_checkin_devices ADD CONSTRAINT chk_go_checkin_devices_battery_percent CHECK (battery_percent IS NULL OR (battery_percent BETWEEN 0 AND 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
