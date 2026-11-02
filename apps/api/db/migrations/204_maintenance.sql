-- 175_maintenance.sql
-- Platform maintenance mode + scheduled/historical maintenance events for General Settings.
-- maintenance_state is a singleton read by the enforcement middleware; maintenance_events is the schedule + history.

CREATE TABLE IF NOT EXISTS maintenance_state (
  id                   text PRIMARY KEY DEFAULT 'singleton',
  active               boolean NOT NULL DEFAULT false,
  mode                 text NOT NULL DEFAULT 'full',   -- read_only|full
  message              text NOT NULL DEFAULT '',
  expected_restoration timestamptz,
  allowed_roles        jsonb NOT NULL DEFAULT '[]',
  announcement_banner  text NOT NULL DEFAULT '',
  active_event_id      uuid,
  enabled_by           text,
  enabled_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
INSERT INTO maintenance_state (id, active) VALUES ('singleton', false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS maintenance_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'scheduled', -- scheduled|in_progress|completed|cancelled|failed|extended|partially_completed
  scope             text NOT NULL DEFAULT 'platform',  -- platform|service|tenant|branch
  mode              text NOT NULL DEFAULT 'full',      -- read_only|full
  starts_at         timestamptz,
  ends_at           timestamptz,
  duration_minutes  integer,
  timezone          text,
  read_only         boolean NOT NULL DEFAULT false,
  affected_services jsonb NOT NULL DEFAULT '[]',
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_events (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_maint_start ON maintenance_events (starts_at DESC);
