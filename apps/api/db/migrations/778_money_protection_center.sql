-- 778_money_protection_center.sql — AI Money Protection guides (Money Protection, Alerts, Investigations, Rules & Detection,
-- Settings, AI Fraud & Money Protection; Nov 2 2026, built Nov 3 2026). Additive only.
-- Rollback: DROP TABLE money_protection_health_runs, money_protection_events, money_protection_detection_runs.
--
-- Alerts, investigations, notes and rule settings stay where they are (migrations 323–325). This adds:
--   • money_protection_detection_runs — every detection pass (scheduled or "Run detection now"): when, how it ended, how many
--     alerts it raised or refreshed. Before this, nothing ran detection on a schedule and nothing recorded a run, so "no alerts"
--     could not be told apart from "never checked".
--   • money_protection_events — the append-only history of human decisions: an alert acknowledged / dismissed / reopened (with
--     a reason), an investigation assigned / moved / resolved, a rule setting changed (before → after, with a reason).
--   • money_protection_health_runs — the evidence of the read-only "Check AI Money Protection System".
CREATE TABLE IF NOT EXISTS money_protection_detection_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  trigger_kind   TEXT NOT NULL CHECK (trigger_kind IN ('scheduled', 'manual')),
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  window_hours   INTEGER NOT NULL DEFAULT 24,
  evaluated      INTEGER NOT NULL DEFAULT 0,
  created_alerts INTEGER NOT NULL DEFAULT 0,
  updated_alerts INTEGER NOT NULL DEFAULT 0,
  layers         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code     TEXT,
  actor_user_id  UUID,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_mp_detection_runs_recent ON money_protection_detection_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS money_protection_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('alert', 'investigation', 'rule')),
  entity_id      TEXT NOT NULL,
  action         TEXT NOT NULL,
  from_state     TEXT,
  to_state       TEXT,
  reason         TEXT CHECK (reason IS NULL OR length(reason) <= 1000),
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_mp_events_entity ON money_protection_events (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mp_events_recent ON money_protection_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS money_protection_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mp_health_recent ON money_protection_health_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mp_alerts_tenant_last_seen ON money_protection_alerts (tenant_id, last_seen_at DESC, id);
