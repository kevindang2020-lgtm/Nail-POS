-- 058: persistent per-device token for mounted customer-display iPads. A paired device authenticates its "what session
-- is active for me right now" lookups with this token (sha256 hash stored; plaintext returned once at issuance). The
-- existing revoked_at column already governs credential revocation.
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS device_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_display_devices_token ON customer_display_devices (device_token_hash) WHERE device_token_hash IS NOT NULL;
