-- 367_booking_phone_verification.sql — reserve a slot while the customer verifies their phone.
--
-- == A CORRECTION, AND WHY IT MATTERS =====================================================================
--
-- The first draft of this migration CREATED `booking_holds` and `customer_phone_verifications`. Both already
-- exist:
--
--   * booking_holds                 -- migration 009_booking.sql
--   * customer_phone_verifications  -- migration 049_phone_verification.sql
--
-- The audit missed them because it grepped the TypeScript for a hold service and found none: `booking_holds` is
-- an ORPHAN TABLE, created in 009 and referenced by no code at all. Absence of code is not absence of schema.
--
-- The failure mode would have been QUIET, which is the dangerous part: `CREATE TABLE IF NOT EXISTS` against an
-- existing table is a NO-OP. The migration would have "succeeded", the new columns would never have been
-- created, and the hold service would have failed at runtime against a table that looked right in the source
-- and was wrong in the database.
--
-- So this migration EXTENDS what exists and adds only what is genuinely new.
--
-- == WHAT IS DELIBERATELY NOT HERE ========================================================================
--
-- No verification codes, in any form. Codes are generated, hashed and checked by the EXISTING
-- customer-activation machinery (secure generation, bcrypt-hashed storage, expiry, attempt limits, resend
-- cooldown, one-time use) writing to the EXISTING `customer_phone_verifications` code store. No second OTP
-- table is added here, because a second OTP store is a second place to leak one from.

-- -- 1. EXTEND the existing booking_holds ---------------------------------------------------------------
--
-- 009 gave it: tenant_id, branch_id, technician_id, customer_id, service_ids_json, start_time, end_time,
-- expires_at, status, created_by_user_id. That is most of a hold. What it lacks is everything that ties a hold
-- to a VERIFIED booking session and stops it from being converted twice.

-- The SERVER-issued booking session. Never a client-supplied id: it is what proves the person converting the
-- hold is the person who verified the phone.
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS booking_session_id UUID;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS channel TEXT;

-- Set exactly once, when the hold becomes a real appointment.
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS converted_appointment_id UUID;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS release_reason TEXT;

-- ONE live hold per booking session, enforced by the DATABASE. Without this, a customer clicking through five
-- times parks five slots, and an abandoned flow leaves them all parked -- a denial-of-service on the salon's own
-- calendar. Partial: only LIVE holds are unique, so a session may take a new hold once its previous one is
-- released or converted.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_holds_live_session
  ON booking_holds (booking_session_id)
  WHERE booking_session_id IS NOT NULL
    AND released_at IS NULL
    AND converted_appointment_id IS NULL;

-- A hold may become an appointment exactly ONCE. This is the last line against a replayed confirmation creating
-- a second appointment from one reservation -- enforced HERE rather than trusted to application code, because a
-- race between two confirms would beat any check the service could make.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_holds_appointment
  ON booking_holds (converted_appointment_id)
  WHERE converted_appointment_id IS NOT NULL;

-- The conflict query: live holds for a tenant+branch overlapping a time range.
CREATE INDEX IF NOT EXISTS idx_booking_holds_live_slot
  ON booking_holds (tenant_id, branch_id, start_time, end_time)
  WHERE released_at IS NULL AND converted_appointment_id IS NULL;

-- The expiry sweep.
CREATE INDEX IF NOT EXISTS idx_booking_holds_expiry
  ON booking_holds (expires_at)
  WHERE released_at IS NULL AND converted_appointment_id IS NULL;

-- -- 2. booking_verification_sessions (genuinely new) ---------------------------------------------------
--
-- One row per booking that must prove a phone number. Bound to a tenant, a hold, and a booking session -- so a
-- verification can never be replayed into a different booking, a different tenant, or a different session.
CREATE TABLE IF NOT EXISTS booking_verification_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  branch_id                 UUID NOT NULL,
  booking_session_id        UUID NOT NULL,
  booking_hold_id           UUID REFERENCES booking_holds(id),
  customer_id               UUID,

  -- The phone, stored SAFELY:
  --   phone_hash -- what we compare against, so the raw number is not sitting in a verification table
  --   phone_mask -- what we show; the spec forbids echoing the full number back after the code is sent
  -- Both derived by customer-activation-core (phoneKey / maskPhone). The plaintext E.164 lives on the customer
  -- record, where it belongs -- not duplicated here.
  phone_hash                TEXT NOT NULL,
  phone_mask                TEXT NOT NULL,

  channel                   TEXT NOT NULL
                              CHECK (channel IN ('online','customer_app','ai_receptionist','kiosk','front_desk','walk_in')),

  -- 'twilio_verify' delegates the code to Twilio and we never see it. 'internal_otp' is the existing hashed-OTP
  -- fallback. Either way NO PLAINTEXT CODE IS STORED, here or anywhere.
  provider                  TEXT NOT NULL DEFAULT 'internal_otp'
                              CHECK (provider IN ('twilio_verify','internal_otp')),
  provider_service_sid      TEXT,
  provider_verification_sid TEXT,

  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','verified','failed','expired','locked','canceled')),

  attempt_count             INTEGER NOT NULL DEFAULT 0,
  resend_count              INTEGER NOT NULL DEFAULT 0,

  expires_at                TIMESTAMPTZ NOT NULL,
  verified_at               TIMESTAMPTZ,
  last_sent_at              TIMESTAMPTZ,
  failure_reason            TEXT,

  -- So a disputed booking can be explained months later: which policy, and which config versions, produced the
  -- decision to require (or not require) verification.
  policy_version            TEXT,
  tenant_config_version     INTEGER,
  branch_config_version     INTEGER,
  provider_config_version   INTEGER,

  correlation_id            UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provider-event idempotency, TENANT-SCOPED: the same Twilio verification SID can never be recorded twice, and
-- never under two tenants. This is the uniqueness the spec names explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvs_provider_verification
  ON booking_verification_sessions (tenant_id, provider, provider_verification_sid)
  WHERE provider_verification_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bvs_session ON booking_verification_sessions (tenant_id, booking_session_id);
CREATE INDEX IF NOT EXISTS idx_bvs_hold    ON booking_verification_sessions (booking_hold_id);
CREATE INDEX IF NOT EXISTS idx_bvs_phone   ON booking_verification_sessions (tenant_id, phone_hash, status);
CREATE INDEX IF NOT EXISTS idx_bvs_expiry  ON booking_verification_sessions (expires_at) WHERE status IN ('pending','sent');

-- -- 3. booking_verified_phones (genuinely new) ---------------------------------------------------------
--
-- "This phone is verified for this tenant" -- the record the re-verification window reads.
--
-- NOT `customer_phone_verifications`: that table (049) is the OTP CODE STORE -- one row per code, with a
-- code_hash and an attempt counter. It answers "is this code valid right now". This table answers a different
-- question -- "has this phone been proven, and how recently" -- and conflating the two would put a durable trust
-- record in a table designed to be emptied the moment a code is consumed.
--
-- TENANT-SCOPED BY UNIQUE KEY. A phone verified at Tenant A is NOT verified at Tenant B. The spec is explicit,
-- and UNIQUE (tenant_id, phone_hash) makes the cross-tenant shortcut structurally unavailable rather than
-- merely discouraged.
CREATE TABLE IF NOT EXISTS booking_verified_phones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  customer_id       UUID,
  phone_hash        TEXT NOT NULL,
  phone_mask        TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('twilio_verify','internal_otp','staff_override')),
  channel           TEXT,
  verified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  last_booking_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS idx_bvp_lookup ON booking_verified_phones (tenant_id, phone_hash, verified_at DESC);
