-- 398_technician_clock_pins.sql — a dedicated, hashed 4-digit Clock PIN per technician, per tenant.
--
-- This is NOT the last-four-of-phone hint: it is a separate secret, stored ONLY as a hash (never plaintext), so a Go
-- Check-In device can identify a technician for clock-in/out without exposing any technician list. Records are
-- tenant-scoped (a global technician who works at several salons has a distinct PIN row per tenant), matching the rule
-- that the global account is shared but attendance/time-clock data is salon-specific.
--
-- Rate-limit state lives on the row (failed_attempts + locked_until) so repeated wrong guesses lock the PIN rather than
-- allowing brute force against a 4-digit space.

CREATE TABLE IF NOT EXISTS technician_clock_pins (
  tenant_id        UUID        NOT NULL,
  technician_id    UUID        NOT NULL,
  pin_hash         TEXT        NOT NULL,           -- hash only; the plaintext PIN is never stored or logged
  failed_attempts  INT         NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,                    -- set when failed_attempts crosses the threshold; NULL = not locked
  updated_by       UUID,                           -- manager/actor who last set or reset it (NULL = self/onboarding)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, technician_id)
);

-- Identify-by-PIN scans a branch's active technicians, so the lookup is always tenant-scoped first.
CREATE INDEX IF NOT EXISTS idx_technician_clock_pins_tenant ON technician_clock_pins (tenant_id);
