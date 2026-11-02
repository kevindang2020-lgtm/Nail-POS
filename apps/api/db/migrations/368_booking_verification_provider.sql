-- 368_booking_verification_provider.sql -- the tenant's OWN Twilio Verify configuration.
--
-- EXTENDS `tenant_messaging_credentials` (created in an earlier migration; it already holds the tenant's own
-- account_sid, an AES-256-GCM encrypted auth_token, and their sending number). It is NOT a new credentials
-- table: a second place to keep a tenant's Twilio secret is a second place to leak it from, and a second place
-- for the two to disagree about which account a tenant is really on.
--
-- What it lacks for verification:
--   1. the tenant's own VERIFY SERVICE -- Verify is a separate Twilio product with its own SID
--   2. BRANCH scoping -- the spec allows Branch A and Branch B to be on different Twilio accounts
--   3. HEALTH -- "configured" is not "working"; a tenant may not enable verification on credentials that have
--      never successfully validated

-- The tenant's own Verify Service SID. A REFERENCE, not a secret: it is useless without the account credentials,
-- so it is stored in the clear (unlike auth_token_enc) and may safely appear in an audit record.
ALTER TABLE tenant_messaging_credentials ADD COLUMN IF NOT EXISTS verify_service_sid TEXT;

-- NULL = the tenant-wide default. A row WITH a branch_id overrides it for that branch only.
--
-- Resolution order (booking-verification-provider.ts): branch row first, then the tenant default, then FAIL --
-- never an unrelated branch's configuration, and never a shared platform account.
ALTER TABLE tenant_messaging_credentials ADD COLUMN IF NOT EXISTS branch_id UUID;

-- "configured" only means somebody typed credentials in. This is whether they have ever actually WORKED.
-- The policy resolver treats an unvalidated configuration as an unhealthy provider, which blocks the booking
-- rather than sending a code into the void and telling the customer to wait for it.
ALTER TABLE tenant_messaging_credentials ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ;
ALTER TABLE tenant_messaging_credentials ADD COLUMN IF NOT EXISTS last_validation_error TEXT;

-- One credential row per (tenant, branch), and one tenant-wide default. Two partial indexes rather than one,
-- because NULL is not comparable in a UNIQUE constraint -- without the second index a tenant could accumulate
-- several conflicting tenant-level rows and the resolver would pick one arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tmc_tenant_branch
  ON tenant_messaging_credentials (tenant_id, provider, branch_id)
  WHERE branch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tmc_tenant_default
  ON tenant_messaging_credentials (tenant_id, provider)
  WHERE branch_id IS NULL;

-- -- tenant / branch verification settings ---------------------------------------------------------------
--
-- The tenant's own policy. Read by resolveBookingVerificationPolicy; a branch row overrides the tenant's.
-- Nothing here can loosen a platform requirement -- that precedence lives in the resolver, not in the schema.
CREATE TABLE IF NOT EXISTS booking_verification_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  branch_id                 UUID,                       -- NULL = the tenant-wide default

  enabled                   BOOLEAN,                    -- NULL on a branch row = inherit the tenant

  -- Per-channel switches. Front-desk and walk-in default to FALSE: OTP-ing a customer standing at the counter
  -- is theatre, and the spec says staff-created bookings are not verified unless a tenant opts in.
  channel_online            BOOLEAN NOT NULL DEFAULT true,
  channel_customer_app      BOOLEAN NOT NULL DEFAULT true,
  channel_ai_receptionist   BOOLEAN NOT NULL DEFAULT true,
  channel_kiosk             BOOLEAN NOT NULL DEFAULT false,
  channel_front_desk        BOOLEAN NOT NULL DEFAULT false,
  channel_walk_in           BOOLEAN NOT NULL DEFAULT false,

  verify_every_booking      BOOLEAN NOT NULL DEFAULT false,
  -- How long a previous verification is trusted. 0 = never trust one.
  reverify_after_seconds    INTEGER NOT NULL DEFAULT 86400,

  reverify_on_group_booking BOOLEAN NOT NULL DEFAULT true,
  reverify_on_deposit       BOOLEAN NOT NULL DEFAULT true,
  reverify_on_high_value    BOOLEAN NOT NULL DEFAULT true,

  hold_seconds              INTEGER NOT NULL DEFAULT 600,   -- clamped to the platform's 120..900 in code

  -- Bumped on every change, and stamped onto each verification session, so a disputed booking can be explained
  -- months later: "this is the configuration that was in force when we decided not to verify."
  version                   INTEGER NOT NULL DEFAULT 1,

  updated_by_user_id        UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bvset_tenant_branch
  ON booking_verification_settings (tenant_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvset_tenant_default
  ON booking_verification_settings (tenant_id) WHERE branch_id IS NULL;

-- -- platform policy (Super Admin) -----------------------------------------------------------------------
--
-- One row per tenant, plus a single global row (tenant_id IS NULL) for the emergency kill switch.
--
-- `required_for_tenant` is the one a tenant CANNOT override -- that precedence is enforced in the resolver, and
-- the tenant UI is expected to say "Required by AI PowerSalon platform policy" rather than offer a toggle that
-- silently does nothing.
CREATE TABLE IF NOT EXISTS booking_verification_platform_policy (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID,                       -- NULL = the GLOBAL row
  module_enabled      BOOLEAN NOT NULL DEFAULT true,
  emergency_disabled  BOOLEAN NOT NULL DEFAULT false,
  required_for_tenant BOOLEAN NOT NULL DEFAULT false,
  blocked_for_tenant  BOOLEAN NOT NULL DEFAULT false,
  reason              TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvpp_tenant ON booking_verification_platform_policy (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bvpp_global ON booking_verification_platform_policy ((true)) WHERE tenant_id IS NULL;
