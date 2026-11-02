-- 358_go_checkin_confirmation_timeout.sql — how long the Go Check-In "You're Checked In!" confirmation stays on a
-- paired display before it auto-returns to the welcome screen (so a kiosk resets itself after a guest walks away).
-- Additive with a sane default; existing rows get 12s. Surfaced read-only in KioskConfig.settings.
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS confirmation_timeout_seconds INTEGER NOT NULL DEFAULT 12;
