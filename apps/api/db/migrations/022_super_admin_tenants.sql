-- ============================================================================
-- 022_super_admin_tenants.sql
-- Super Admin "Tenants" command center — additive to 001_auth_foundation.
--
-- Adds ONLY what the SA Tenants screen needs that 001 does not already provide.
-- 001 already covers: tenants, branches, users.last_login_at, tenant_subscriptions,
-- tenant_ai_packages, tenant_usage_limits, audit_logs. Everything display-side
-- (display status, plan tier, MRR roll-up, setup completeness) is DERIVED in
-- super-admin-tenants-core.ts and intentionally not stored here.
--
-- Super Admin is CROSS-TENANT: reads here are platform-wide and run behind the
-- `super-admin` guard, never scoped().
-- ============================================================================

-- Suspend metadata on the tenant (suspend modal captures a reason).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at      TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_reason  TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_by      UUID REFERENCES users (id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Payment processor (Fiserv / CardPointe) configuration per tenant.
-- Drives the "Fiserv MID: Configured / Missing" signal + the "Missing Fiserv MID"
-- tab and the setup-completeness derivation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_payment_config (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  processor         TEXT NOT NULL DEFAULT 'fiserv'
                      CHECK (processor IN ('fiserv', 'cardpointe', 'none')),
  merchant_id       TEXT,                       -- live MID; NULL until provisioned
  fiserv_configured BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  configured_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Hardware financing payoff per tenant (kiosk/terminal hardware on payment plan).
-- Drives the "Hardware Payoff" detail row: remaining_cents = 0 -> "Paid off",
-- a NULL row (no record) -> treated as "—" (no hardware financed) by the core.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_hardware_payoff (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  total_cents      BIGINT NOT NULL DEFAULT 0,
  remaining_cents  BIGINT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paid_off', 'none')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Super Admin support / impersonation sessions (audited).
-- When a Super Admin enters a tenant via "Support Access", a row is created here
-- and an audit_logs entry is written. Sessions are short-lived (expires_at).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS super_admin_support_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  reason              TEXT NOT NULL,
  ip_address          INET,
  user_agent          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- Indexes for the SA list query (platform-wide, ordered, status-filtered).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tenants_status_created
  ON tenants (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branches_tenant
  ON branches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_active
  ON super_admin_support_sessions (tenant_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_support_sessions_admin
  ON super_admin_support_sessions (super_admin_user_id, started_at DESC);
