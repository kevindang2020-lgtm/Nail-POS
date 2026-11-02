-- 357_go_checkin_welcome_message.sql — optional custom idle greeting for a Go Check-In / dual-purpose display device.
-- Additive and nullable: when NULL the display shows the default "Welcome to <salon>". Surfaced read-only in the
-- public KioskConfig so the paired display can render it while idle. No behavior change until a message is set.
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS welcome_message TEXT;
