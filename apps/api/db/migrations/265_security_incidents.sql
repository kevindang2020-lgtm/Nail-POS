-- 185_security_incidents.sql — dedicated security incidents (distinct from infra status_incidents) + an append-only
-- transition history. Statuses are controlled and transitions validated in code; every transition records actor, reason,
-- previous & new state, timestamp, and correlation id. Incidents are never deleted on close.
CREATE TABLE IF NOT EXISTS security_incidents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_ref   TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT,
  category       TEXT NOT NULL DEFAULT 'other',
  severity       TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','informational')),
  status         TEXT NOT NULL DEFAULT 'detected'
                   CHECK (status IN ('detected','investigating','contained','remediating','monitoring','closed','reopened')),
  detection_source TEXT,
  tenant_id      UUID,
  branch_id      UUID,
  assigned_to_user_id UUID,
  correlation_id TEXT,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  contained_at   TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents (status, severity, detected_at);
CREATE INDEX IF NOT EXISTS idx_security_incidents_tenant ON security_incidents (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS security_incident_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id    UUID NOT NULL REFERENCES security_incidents (id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_user_id  UUID,
  reason         TEXT,
  correlation_id TEXT,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_incident_events_incident ON security_incident_events (incident_id, occurred_at);
