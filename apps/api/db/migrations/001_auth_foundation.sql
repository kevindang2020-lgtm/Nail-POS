-- 001_auth_foundation.sql — AIPowerSalon auth foundation (PostgreSQL)
-- Idempotent: safe to run on a database that may already have some objects.
-- Apply only the CREATEs that are missing in your pilot DB.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Tenants & branches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  tenant_slug     TEXT NOT NULL,
  tenant_code     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('active','pending','suspended','cancelled')),
  owner_user_id   UUID,
  business_phone  TEXT,
  email           TEXT,
  website         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Users, roles, permissions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants (id) ON DELETE CASCADE,  -- NULL for SUPER_ADMIN
  branch_id        UUID REFERENCES branches (id) ON DELETE SET NULL,
  first_name       TEXT,
  last_name        TEXT,
  full_name        TEXT,
  email            TEXT,
  normalized_phone TEXT,
  password_hash    TEXT,
  status           TEXT NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('active','invited','suspended','inactive')),
  role             TEXT NOT NULL
                     CHECK (role IN ('SUPER_ADMIN','OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN','CUSTOMER')),
  pin_hash         TEXT,            -- for POS staff fast-switch
  mfa_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS permissions (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key   TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id  UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id  UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  permission_id  UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- Sessions, tokens, MFA, resets, attempts, devices
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES tenants (id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches (id) ON DELETE SET NULL,
  device_id   TEXT,
  ip_address  INET,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash            TEXT NOT NULL,
  rotated_from_token_id UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  superseded_by_token_id UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mfa_factors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'totp' CHECK (type IN ('totp','sms')),
  secret_enc  TEXT,
  confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID,
  identifier  TEXT,
  ip_address  INET,
  success     BOOLEAN NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  branch_id      UUID REFERENCES branches (id) ON DELETE SET NULL,
  device_name    TEXT,
  device_type    TEXT,
  trusted_device BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Subscription / feature gating
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  plan        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'trialing'
                CHECK (status IN ('active','trialing','past_due','expired','cancelled')),
  current_period_end TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  tenant_id  UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  feature    TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id, feature)
);

CREATE TABLE IF NOT EXISTS tenant_ai_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  package     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_usage_limits (
  tenant_id   UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,
  limit_value BIGINT NOT NULL DEFAULT 0,
  used_value  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric)
);

-- ----------------------------------------------------------------------------
-- Audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,
  branch_id     UUID,
  user_id       UUID,
  role          TEXT,
  action_type   TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  ip_address    INET,
  user_agent    TEXT,
  metadata_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (tenant_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_code ON tenants (tenant_code);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_phone ON users (tenant_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_refresh_session ON refresh_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts (identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs (tenant_id, created_at);
