-- 099_go_checkin_token_expiry.sql — give each Go Check-In device pairing token an expiry so a kiosk credential can't live
-- forever. NULL = never expires (existing devices are unaffected until their token is next created/regenerated, which sets
-- a fresh expiry). The device-facing resolve flips an expired device to 'expired' and refuses sessions until re-paired.
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
