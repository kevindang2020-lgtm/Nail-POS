-- 373_customer_phone_management.sql -- customers can change their phone number.
--
-- == WHAT THE AUDIT FOUND ==================================================================================
--
-- 1. NO CODE ANYWHERE UPDATES A CUSTOMER'S PHONE NUMBER. Not from the POS, not from the app. This is green-field.
--
-- 2. `customer_identities.normalized_phone` is NOT NULL UNIQUE -- and it is the LOGIN CREDENTIAL
--    (auth-user.kysely.repository: "select * from customer_identities where normalized_phone = $1").
--    `customers.normalized_phone` is NOT unique.
--
--    That is not a contradiction with "support shared family phones". It is the RESOLUTION:
--
--      IDENTITY phone  = a CREDENTIAL. Unique, because two accounts on one login is an ambiguous login.
--      CUSTOMER phone  = a CONTACT NUMBER. Not unique -- and this is where shared family phones live.
--
--    A mother and daughter at one salon share a number; only one of them has an app login on it. Everything below
--    keeps those two apart.
--
-- 3. `customers` has ONE phone column and no status, no history, no version. The spec's status model
--    (active_verified / pending_verification / replaced / ...) has nothing to build on.

-- -- customer_phones: the status model ------------------------------------------------------------------
--
-- A boolean cannot express this, and the spec is right to say so: "verified", "we never asked", and "we asked and
-- it failed" demand completely different behaviour, and a boolean collapses all three into `false`.
--
-- NOT a replacement for `customers.normalized_phone` -- that stays as the tenant's contact number and is what every
-- existing query reads. This table is the HISTORY and the STATUS around it, so an old number can be retired rather
-- than deleted.
CREATE TABLE IF NOT EXISTS customer_phones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID,
  customer_id         UUID NOT NULL,

  -- E.164. Stored in full HERE, deliberately: this is the customer's own record at their own salon, and the salon
  -- must be able to phone them. What we do NOT do is build a globally searchable plaintext phone index across
  -- tenants -- that is what `phone_hash` is for.
  normalized_phone    TEXT NOT NULL,
  phone_display       TEXT,
  phone_mask          TEXT NOT NULL,
  country_code        TEXT,

  -- For duplicate detection WITHOUT a cross-tenant plaintext index. The spec asks for exactly this.
  phone_hash          TEXT NOT NULL,

  status              TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('active_verified','active_unverified','pending_verification','verification_failed',
                      'verification_expired','replaced','inactive','disputed','locked','manual_review_required')),

  verification_provider TEXT CHECK (verification_provider IN ('twilio_verify','internal_otp','staff_override')),
  verified_at         TIMESTAMPTZ,

  -- WHO changed it and HOW. A phone change is a security event; "somebody edited it" is not an answer.
  added_by_user_id    UUID,
  update_source       TEXT CHECK (update_source IN ('staff_pos','customer_app','kiosk','ai_receptionist','import')),
  change_reason       TEXT,

  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The old number is RETIRED, never deleted: historical appointments and messages must keep their original
  -- contact reference, and a deleted row makes an audit trail lie by omission.
  replaced_by_phone_id UUID REFERENCES customer_phones(id),

  risk_status         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ONE active number per customer. Partial, so the history (replaced/inactive rows) is unconstrained -- otherwise
-- keeping the audit trail would be impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_phones_one_active
  ON customer_phones (tenant_id, customer_id)
  WHERE status IN ('active_verified','active_unverified');

-- ONE pending number per customer. Without this, a receptionist clicking Save twice -- or two receptionists at two
-- terminals -- creates two competing pending numbers, and whichever code arrives second silently wins.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_phones_one_pending
  ON customer_phones (tenant_id, customer_id)
  WHERE status = 'pending_verification';

-- Duplicate detection: "who else at THIS TENANT has this number?" Tenant-scoped by the leading column, so a
-- lookup can never wander into another salon's customers.
CREATE INDEX IF NOT EXISTS idx_customer_phones_hash ON customer_phones (tenant_id, phone_hash, status);
CREATE INDEX IF NOT EXISTS idx_customer_phones_customer ON customer_phones (tenant_id, customer_id, status);

-- -- customer_phone_update_sessions ---------------------------------------------------------------------
--
-- One row per attempt to change a number. It is what a verification code is BOUND to -- so a code sent for one
-- proposed number cannot activate a different one, and a stale code from an abandoned attempt cannot complete a
-- newer one.
CREATE TABLE IF NOT EXISTS customer_phone_update_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID,
  customer_id           UUID NOT NULL,

  -- The number being PROPOSED. Not yet the customer's number.
  proposed_phone        TEXT NOT NULL,
  proposed_phone_hash   TEXT NOT NULL,
  proposed_phone_mask   TEXT NOT NULL,

  -- The number being REPLACED, so a rollback knows what to restore and the audit knows what changed.
  previous_phone_id     UUID REFERENCES customer_phones(id),

  state                 TEXT NOT NULL DEFAULT 'phone_update_started',
  update_source         TEXT NOT NULL
    CHECK (update_source IN ('staff_pos','customer_app','kiosk','ai_receptionist')),

  requested_by_user_id  UUID,
  requested_by_role     TEXT,
  change_reason         TEXT,

  -- Links to the EXISTING booking-verification module. We do not build a second OTP store: that module already
  -- owns secure generation, hashed storage, expiry, attempt limits, resend cooldown and enumeration-safety.
  verification_session_id UUID,

  duplicate_outcome     TEXT,
  duplicate_resolved_by UUID,

  -- OPTIMISTIC LOCKING. The customer row's version at the moment this update was STARTED. If it has moved by the
  -- time we commit, somebody else changed the customer underneath us and this screen is stale -- so we refuse
  -- rather than overwrite a newer number with an older one.
  customer_version      INTEGER,

  idempotency_key       TEXT,
  correlation_id        UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

-- Idempotency: a retried request (a flaky connection, a double-tap) must not open a second update session and send
-- a second SMS on the tenant's bill.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpus_idempotency
  ON customer_phone_update_sessions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ONE open update per customer. Two concurrent changes to the same person's number is exactly how a stale code
-- ends up activating the wrong one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpus_one_open
  ON customer_phone_update_sessions (tenant_id, customer_id)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cpus_customer ON customer_phone_update_sessions (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpus_state ON customer_phone_update_sessions (state) WHERE completed_at IS NULL;

-- -- optimistic locking on the customer -----------------------------------------------------------------
--
-- "Prevent stale profile screens overwriting a newer update."
--
-- Without a version, two receptionists with the profile open both hit Save and the second silently wins -- with
-- whatever was on screen when they opened it, which may be minutes old. There is no way to detect it after the
-- fact, and the customer simply stops receiving messages.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS record_version INTEGER NOT NULL DEFAULT 1;

-- -- tenant settings ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_customer_phone_settings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID,

  allow_receptionist_updates  BOOLEAN NOT NULL DEFAULT true,
  require_manager_approval    BOOLEAN NOT NULL DEFAULT false,
  require_sms_verification    BOOLEAN NOT NULL DEFAULT true,
  allow_pending_unverified    BOOLEAN NOT NULL DEFAULT true,
  allow_shared_family_phones  BOOLEAN NOT NULL DEFAULT true,

  customer_app_self_service   BOOLEAN NOT NULL DEFAULT true,
  require_reauthentication    BOOLEAN NOT NULL DEFAULT true,
  notify_old_number           BOOLEAN NOT NULL DEFAULT true,

  -- OFF by default, and the spec is right to insist: a manually confirmed number is a manager's judgement, not
  -- cryptographic evidence, and a tenant should have to choose to allow it.
  allow_manual_confirmation   BOOLEAN NOT NULL DEFAULT false,

  version                     INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id          UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcps_tenant_branch
  ON tenant_customer_phone_settings (tenant_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcps_tenant_default
  ON tenant_customer_phone_settings (tenant_id) WHERE branch_id IS NULL;
