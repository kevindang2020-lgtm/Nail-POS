-- 187_system_status.sql
-- System Status enrichment. Reuses the existing status_components + status_incidents tables (migration 147), which
-- already carry the correct status levels (operational/degraded/partial_outage/major_outage/maintenance). Adds the
-- reference columns those tables lack (service category, uptime, response time, owning team, affected-tenant count,
-- last-incident time) plus incident triage fields, a scheduled-maintenance table, and a public status-update log.
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS category          TEXT;               -- application | api | payments | communications | infrastructure | identity | ai | mobile
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS uptime_pct        NUMERIC(6,3);
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS response_time_ms  INTEGER;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS owner_team        TEXT;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS affected_tenants  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS last_incident_at  TIMESTAMPTZ;

ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS incident_reference TEXT;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS component_key      TEXT;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS severity           TEXT DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','informational'));
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS recovery_owner     TEXT;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS eta_at             TIMESTAMPTZ;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS affected_tenants   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS root_cause         TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_status_incident_ref ON status_incidents (incident_reference) WHERE incident_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS status_scheduled_maintenance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service        TEXT,
  component_key  TEXT,
  scope          TEXT,                          -- Global | Regional | single tenant
  window_start   TIMESTAMPTZ NOT NULL,
  window_end     TIMESTAMPTZ NOT NULL,
  tenant_impact  INTEGER NOT NULL DEFAULT 0,
  notice_status  TEXT NOT NULL DEFAULT 'draft' CHECK (notice_status IN ('draft','published','cancelled','completed')),
  owner_team     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start)
);
CREATE INDEX IF NOT EXISTS ix_status_maint_window ON status_scheduled_maintenance (window_start);

CREATE TABLE IF NOT EXISTS status_public_updates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID,
  title        TEXT NOT NULL,
  body         TEXT,
  audience     TEXT NOT NULL DEFAULT 'all_tenants',  -- all_tenants | affected_tenants | internal
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retracted')),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_status_public_update_pub ON status_public_updates (published_at DESC);
