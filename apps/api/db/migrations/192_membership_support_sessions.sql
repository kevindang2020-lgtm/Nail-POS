-- 192_membership_support_sessions.sql — Audited Support Mode for Membership Programs. A session is time-limited,
-- tenant-scoped, reason-required, and fully audited. Auto-expiry is derived from expires_at at read time; an explicit
-- exit sets closed_at. No customer/payment data is stored here — only the access grant + audit linkage.
CREATE TABLE IF NOT EXISTS membership_support_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  opened_by_user_id  UUID,
  reason             TEXT NOT NULL,
  access_level       TEXT NOT NULL DEFAULT 'read_only' CHECK (access_level IN ('read_only','assist')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','expired')),
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  closed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_membership_support_sessions_active ON membership_support_sessions (status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_support_sessions_tenant ON membership_support_sessions (tenant_id, opened_at DESC);
