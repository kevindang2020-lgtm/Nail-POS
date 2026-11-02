-- 188_privileged_access_grants.sql — time-boxed privileged-access (elevation) grants + append-only review history. Every
-- grant has a mandatory bounded expiry; approval enforces separation of duties (approver != requester) in code; a sweep
-- marks past-window active grants expired. Grants are never deleted; every step is audited.
CREATE TABLE IF NOT EXISTS privileged_access_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_ref      TEXT NOT NULL UNIQUE,
  user_id        UUID NOT NULL,
  privilege      TEXT NOT NULL,
  scope          TEXT NOT NULL CHECK (scope IN ('platform','tenant')),
  target         TEXT,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','active','denied','revoked','expired','completed')),
  requested_by   UUID,
  approved_by    UUID,
  granted_at     TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_status ON privileged_access_grants (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_privileged_access_grants_user ON privileged_access_grants (user_id, status);

CREATE TABLE IF NOT EXISTS privileged_access_grant_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id      UUID NOT NULL REFERENCES privileged_access_grants (id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id UUID,
  note          TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_privileged_access_grant_events_grant ON privileged_access_grant_events (grant_id, occurred_at);
