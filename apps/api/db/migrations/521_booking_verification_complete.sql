-- 521_booking_verification_complete.sql — BUILD_PLAN Phase 4 (customer_booking_phone_verification → complete).
--
-- 1. A verification is a PROOF FOR ONE BOOKING. The audit found the customer app looping on 428 forever and "verify
--    every booking" impossible to satisfy, because a successful check only wrote the per-phone trust row and nothing
--    tied it to the booking that asked for it. A verified session is now consumed by exactly one appointment.
-- 2. A manager's override is recorded on the session (who, why, how they confirmed the customer) and the appointment
--    it produced is labelled — it never becomes phone trust.
-- 3. Delivery callbacks record delivery without moving the session's state (the webhook used to wait for a status the
--    sessions were never inserted with).
-- 4. Bypass can be forbidden separately from forbidding the whole feature (it reused blocked_for_tenant).
-- 5. Twilio credentials: per-branch rows can finally coexist with the salon default (migration 311's full unique index
--    is dropped; 368's two partial indexes already enforce one default + one per branch), and a salon may sign Verify
--    calls with an API key instead of its account auth token.

-- ── 1–3. verification sessions ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE booking_verification_sessions
  ADD COLUMN IF NOT EXISTS consumed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_appointment_id  uuid,
  ADD COLUMN IF NOT EXISTS delivered_at             timestamptz,
  ADD COLUMN IF NOT EXISTS override_by_user_id      uuid,
  ADD COLUMN IF NOT EXISTS override_at              timestamptz,
  ADD COLUMN IF NOT EXISTS override_reason          text,
  ADD COLUMN IF NOT EXISTS override_contact_method  text,
  -- the internal fallback (no Verify Service): the code's HASH (argon2/scrypt via the platform hasher), never the code.
  -- Twilio Verify sessions leave it NULL — Twilio holds those codes.
  ADD COLUMN IF NOT EXISTS code_hash                text;

ALTER TABLE booking_verification_sessions DROP CONSTRAINT IF EXISTS booking_verification_sessions_override_contact_chk;
ALTER TABLE booking_verification_sessions ADD CONSTRAINT booking_verification_sessions_override_contact_chk
  CHECK (override_contact_method IS NULL OR override_contact_method IN ('in_person', 'staff_called_back', 'known_customer'));

-- one appointment per proof, enforced by the database (two concurrent bookings presenting the same proof: one wins)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvs_consumed_appointment ON booking_verification_sessions (consumed_appointment_id)
  WHERE consumed_appointment_id IS NOT NULL;
-- the proof lookup: this salon, this booking session
CREATE INDEX IF NOT EXISTS idx_bvs_tenant_booking_session ON booking_verification_sessions (tenant_id, booking_session_id, created_at DESC);
-- the expiry sweep: unproven sessions past their deadline
CREATE INDEX IF NOT EXISTS idx_bvs_open_expiry ON booking_verification_sessions (expires_at)
  WHERE status IN ('pending', 'sent');
-- the override's earlier attempt wrote 'staff_override:' into failure_reason and status 'verified' (indistinguishable
-- from a real proof). Any such row is moved to the explicit columns, and stays verified-by-override, never by SMS.
UPDATE booking_verification_sessions
   SET override_reason = substr(failure_reason, length('staff_override:') + 1),
       override_at = coalesce(verified_at, updated_at),
       failure_reason = NULL
 WHERE failure_reason LIKE 'staff_override:%' AND override_reason IS NULL;

-- ── 2. the appointment says how its phone was proven ──────────────────────────────────────────────────────────
ALTER TABLE pos_tech_appointments
  ADD COLUMN IF NOT EXISTS phone_verification            text,
  ADD COLUMN IF NOT EXISTS phone_verification_session_id uuid;
ALTER TABLE pos_tech_appointments DROP CONSTRAINT IF EXISTS pos_tech_appointments_phone_verification_chk;
ALTER TABLE pos_tech_appointments ADD CONSTRAINT pos_tech_appointments_phone_verification_chk
  CHECK (phone_verification IS NULL OR phone_verification IN ('verified', 'recently_verified', 'staff_override'));

-- ── 4. bypass is its own switch ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE booking_verification_platform_policy
  ADD COLUMN IF NOT EXISTS bypass_blocked boolean NOT NULL DEFAULT false;

-- ── 5. credentials ────────────────────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS uq_tenant_messaging_credentials;
ALTER TABLE tenant_messaging_credentials
  ADD COLUMN IF NOT EXISTS api_key_sid        text,
  ADD COLUMN IF NOT EXISTS api_key_secret_enc text;

-- The hard per-IP / per-device send caps count across every salon (one address texting a stream of numbers).
CREATE INDEX IF NOT EXISTS idx_bvs_ip_sent ON booking_verification_sessions (request_ip, last_sent_at) WHERE request_ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bvs_device_sent ON booking_verification_sessions (device_id, last_sent_at) WHERE device_id IS NOT NULL;
