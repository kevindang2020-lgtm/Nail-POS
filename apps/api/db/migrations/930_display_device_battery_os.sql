-- 930_display_device_battery_os.sql — Tablets 02 "Connection & Battery Health" (extras round 10, Nov 13 2026; agent 3 range 930–939).
--
-- A paired customer display / tablet already reports its mode, app version and screen with every heartbeat (migration 511).
-- It now also reports, WHEN ITS BROWSER EXPOSES THEM, the operating system it runs (from the browser's own platform data) and
-- its battery (percent 0–100 and whether it is charging, from the Battery Status API). A device that cannot read them sends
-- nothing and the fleet shows "—" — never a guessed value. battery_reported_at says when the battery figure was last read, so a
-- stale reading is never shown as current.
--
-- Additive, nullable, idempotent. Rollback: drop the four columns (nothing else reads them).
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS os_version TEXT;
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS battery_percent INTEGER;
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS battery_charging BOOLEAN;
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS battery_reported_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE customer_display_devices ADD CONSTRAINT chk_customer_display_devices_battery_percent CHECK (battery_percent IS NULL OR (battery_percent BETWEEN 0 AND 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
