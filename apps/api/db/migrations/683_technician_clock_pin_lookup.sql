-- 683_technician_clock_pin_lookup.sql — 200-technician mandate §46/§47/§89 (Oct 23 2026).
--
-- Identify-by-PIN ran one scrypt check per pinned technician at the branch — 200 technicians made every kiosk tap cost
-- ~200 password-hash checks, and an opening burst of 100 clock-ins queued behind each other. pin_lookup holds an
-- HMAC-SHA256 of (tenant, PIN) under a SERVER-side key (never stored here); pin_lookup_kid names that key. The kiosk
-- narrows to the matching row(s) and still verifies pin_hash with scrypt. Rows written before this (or under a rotated
-- key) keep NULL / another kid and are scanned the old way, then re-keyed on their next successful match.
ALTER TABLE technician_clock_pins ADD COLUMN IF NOT EXISTS pin_lookup     TEXT;
ALTER TABLE technician_clock_pins ADD COLUMN IF NOT EXISTS pin_lookup_kid TEXT;
CREATE INDEX IF NOT EXISTS idx_technician_clock_pins_lookup ON technician_clock_pins (tenant_id, pin_lookup) WHERE pin_lookup IS NOT NULL;
