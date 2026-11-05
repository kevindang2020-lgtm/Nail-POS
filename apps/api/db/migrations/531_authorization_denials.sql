-- 531_authorization_denials.sql — BUILD_PLAN Phase 9 (Constitution 2 §denial metrics): every tenant-side permission
-- denial the guards / decision object return is recorded (sampled per user + key + reason to at most one row a minute), so
-- the owner's security report can show what people keep being refused and the platform can spot probing. No request
-- bodies, no customer data — the key, the reason code, the route template.
CREATE TABLE IF NOT EXISTS authorization_denials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID,
  user_id     UUID,
  role        TEXT,
  permission  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  route       TEXT,
  count       INT NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_authz_denials_tenant ON authorization_denials (tenant_id, last_at DESC);
CREATE INDEX IF NOT EXISTS ix_authz_denials_bucket ON authorization_denials (tenant_id, user_id, permission, reason, last_at DESC);
