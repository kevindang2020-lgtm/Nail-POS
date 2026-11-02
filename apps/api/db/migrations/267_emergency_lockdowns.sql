-- 187_emergency_lockdowns.sql — deliberate, multi-step, reversible emergency lockdowns + append-only history. A lockdown
-- is proposed, then confirmed with BOTH step-up re-auth AND a typed confirmation phrase, then executed, and can be lifted.
-- The initiating admin is never in scope (self-preservation). Every step is audited. Never one-click.
CREATE TABLE IF NOT EXISTS emergency_lockdowns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lockdown_ref    TEXT NOT NULL UNIQUE,
  scope           TEXT NOT NULL CHECK (scope IN ('account','tenant','platform')),
  target          TEXT,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','confirmed','active','lifted','cancelled')),
  step_up_verified BOOLEAN NOT NULL DEFAULT FALSE,
  affected_estimate INTEGER,
  affected_sessions INTEGER,
  correlation_id  TEXT,
  initiated_by    UUID,
  confirmed_by    UUID,
  activated_at    TIMESTAMPTZ,
  lifted_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_lockdowns_status ON emergency_lockdowns (status, created_at);

CREATE TABLE IF NOT EXISTS emergency_lockdown_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lockdown_id   UUID NOT NULL REFERENCES emergency_lockdowns (id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id UUID,
  note          TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_lockdown_events_lockdown ON emergency_lockdown_events (lockdown_id, occurred_at);
