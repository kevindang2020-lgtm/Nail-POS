-- 427_sms_verification_packages.sql — Twilio SMS Verification Packages & Tenant Billing, schema (Jul 29, 2026).
-- Kevin's 71-section spec, P1. Design decisions carried from the filed audit:
--   · Packages are a SEPARATE purchasable product from the three existing sms-limit structures (migs 101/173/279,
--     which gate plan-level/marketing sends); the entitlement service (P2) consumes THIS allowance only for
--     verification categories.
--   · §6: tenant money = integer cents (BIGINT); fractional-cent CARRIER cost recorded separately as micros.
--   · §12: idempotent billing — one Twilio Message SID can never count twice (partial UNIQUE below).
--   · §26: billing-period terms are SNAPSHOTTED onto the cycle row; historical bills never recalculate with
--     today's package definition.
--   · §53: exactly three packages seeded; schema imposes no ceiling so a later tier needs no rewrite.
--   · NO hardcoded pricing (§1/§2): seeds are price 0, inactive-for-self-service, with an honest description.

CREATE TABLE IF NOT EXISTS sms_verification_packages (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          TEXT NOT NULL UNIQUE,
  name                          TEXT NOT NULL,
  description                   TEXT,
  monthly_price_cents           BIGINT NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  included_verification_count   INTEGER NOT NULL DEFAULT 0 CHECK (included_verification_count >= 0),
  overage_enabled               BOOLEAN NOT NULL DEFAULT FALSE,
  overage_unit_price_cents      BIGINT NOT NULL DEFAULT 0 CHECK (overage_unit_price_cents >= 0),
  hard_limit_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  warning_threshold_percent     INTEGER NOT NULL DEFAULT 80 CHECK (warning_threshold_percent BETWEEN 1 AND 100),
  critical_threshold_percent    INTEGER NOT NULL DEFAULT 95 CHECK (critical_threshold_percent BETWEEN 1 AND 100),
  self_service_available        BOOLEAN NOT NULL DEFAULT FALSE,
  active                        BOOLEAN NOT NULL DEFAULT TRUE,
  display_order                 INTEGER NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §7/§8/§50 — one assignment per tenant; changes are audited and historized in the change table below.
CREATE TABLE IF NOT EXISTS tenant_sms_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  package_id           UUID NOT NULL REFERENCES sms_verification_packages (id),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'cancelled')),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancel_at_cycle_end  BOOLEAN NOT NULL DEFAULT FALSE,
  custom_allowance     INTEGER CHECK (custom_allowance IS NULL OR custom_allowance >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_sms_package_changes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  previous_package_id  UUID REFERENCES sms_verification_packages (id),
  new_package_id       UUID NOT NULL REFERENCES sms_verification_packages (id),
  changed_by_user_id   UUID,
  changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tspc_tenant ON tenant_sms_package_changes (tenant_id, changed_at);

-- §25/§26 — the cycle row CARRIES the terms it was billed under (snapshot columns), so editing a package later
-- can never rewrite a historical period.
CREATE TABLE IF NOT EXISTS tenant_sms_billing_cycles (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  package_id                  UUID NOT NULL REFERENCES sms_verification_packages (id),
  cycle_start                 DATE NOT NULL,
  cycle_end                   DATE NOT NULL,
  -- snapshot of terms at cycle open (§26):
  package_code                TEXT NOT NULL,
  package_name                TEXT NOT NULL,
  monthly_price_cents         BIGINT NOT NULL,
  included_count              INTEGER NOT NULL,
  overage_enabled             BOOLEAN NOT NULL,
  overage_unit_price_cents    BIGINT NOT NULL,
  hard_limit_enabled          BOOLEAN NOT NULL,
  -- live counters (§19) — the LEDGER below remains the auditable source; these are the cycle rollup:
  used_included               INTEGER NOT NULL DEFAULT 0,
  overage_count               INTEGER NOT NULL DEFAULT 0,
  failed_count                INTEGER NOT NULL DEFAULT 0,
  credit_allowance            INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cycle_start)
);
CREATE INDEX IF NOT EXISTS idx_tsbc_tenant_open ON tenant_sms_billing_cycles (tenant_id, status);

-- §19/§20 — the immutable usage LEDGER. §12: a provider message id counts once, ever (partial unique).
CREATE TABLE IF NOT EXISTS sms_usage_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  branch_id             UUID,
  package_id            UUID REFERENCES sms_verification_packages (id),
  billing_cycle_id      UUID REFERENCES tenant_sms_billing_cycles (id),
  purpose               TEXT NOT NULL CHECK (purpose IN (
                          'BOOKING_VERIFICATION', 'CUSTOMER_PHONE_VERIFICATION', 'CUSTOMER_PHONE_CHANGE',
                          'TECHNICIAN_VERIFICATION', 'PASSWORD_RESET', 'OWNER_VERIFICATION', 'LOGIN_OTP',
                          'OTHER_VERIFICATION')),
  category              TEXT NOT NULL DEFAULT 'TENANT_VERIFICATION' CHECK (category IN (
                          'TENANT_VERIFICATION', 'PLATFORM_SECURITY', 'TENANT_MARKETING', 'PLATFORM_SUPPORT')),
  provider              TEXT NOT NULL DEFAULT 'twilio',
  provider_message_id   TEXT,
  recipient_masked      TEXT,
  status                TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
                          'REQUESTED', 'SUBMITTED', 'ACCEPTED', 'DELIVERED', 'UNDELIVERED', 'FAILED')),
  billable              BOOLEAN NOT NULL DEFAULT FALSE,
  unit_price_cents      BIGINT CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  provider_cost_micros  BIGINT,            -- §6/§22: exact carrier cost in millionths of a dollar, never tenant math
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at          TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_usage_provider_sid
  ON sms_usage_records (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_usage_tenant_time ON sms_usage_records (tenant_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_sms_usage_cycle ON sms_usage_records (billing_cycle_id);

-- §53 seeds — three packages, honestly unpriced until Super Admin configures them (§1: no hardcoded pricing).
INSERT INTO sms_verification_packages (code, name, description, display_order, active, self_service_available)
VALUES
  ('sms_starter', 'Package 1 — Starter', 'Pricing and included volume not yet set by Super Admin. Configure before offering to tenants.', 1, TRUE, FALSE),
  ('sms_growth',  'Package 2 — Growth',  'Pricing and included volume not yet set by Super Admin. Configure before offering to tenants.', 2, TRUE, FALSE),
  ('sms_pro',     'Package 3 — Pro',     'Pricing and included volume not yet set by Super Admin. Configure before offering to tenants.', 3, TRUE, FALSE)
ON CONFLICT (code) DO NOTHING;
