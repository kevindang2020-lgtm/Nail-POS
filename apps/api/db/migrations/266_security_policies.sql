-- 186_security_policies.sql — versioned MFA / password / session policy records. Each save creates a new immutable
-- version; one active version per kind (prior active is archived). `config` holds configuration ONLY — never passwords,
-- secrets, or reversible data. `compliant` is the internal-baseline evaluation computed at save time. Every change is
-- audited. Actual runtime enforcement (session timeouts, MFA challenges) reads the active policy — a separate integration.
CREATE TABLE IF NOT EXISTS security_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('mfa','password','session')),
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  compliant     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID,
  activated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT security_policies_version UNIQUE (kind, version)
);
CREATE INDEX IF NOT EXISTS idx_security_policies_active ON security_policies (kind, status, version DESC);
