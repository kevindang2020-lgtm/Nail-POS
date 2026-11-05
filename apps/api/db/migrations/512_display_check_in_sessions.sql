-- 512_display_check_in_sessions.sql — 23-inch dual-screen spec §8, §12, §18 (Unit 7): ONE identity per device.
--
-- A paired customer display used to run its guests' check-in on a Go Check-In KIOSK's identity: it was handed the slug
-- of a kiosk in its branch (or a salon-wide one) and opened kiosk sessions with it. A salon with no kiosk had no
-- check-in on its display at all, and the display's check-in followed whatever happened to that other device. Now a
-- check-in session belongs to exactly one device: a kiosk (device_id) or a paired customer display
-- (display_device_id, proved by the display's own credential). The session carries the display's salon and branch, and
-- every request re-checks the display — a revoked, unpaired or maintenance display's check-in stops at once.
ALTER TABLE go_checkin_sessions ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE go_checkin_sessions ADD COLUMN IF NOT EXISTS display_device_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gcs_display_device') THEN
    ALTER TABLE go_checkin_sessions ADD CONSTRAINT fk_gcs_display_device
      FOREIGN KEY (tenant_id, display_device_id) REFERENCES customer_display_devices (tenant_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_gcs_one_device') THEN
    ALTER TABLE go_checkin_sessions ADD CONSTRAINT ck_gcs_one_device CHECK ((device_id IS NULL) <> (display_device_id IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_go_checkin_sessions_display ON go_checkin_sessions (display_device_id) WHERE display_device_id IS NOT NULL;
