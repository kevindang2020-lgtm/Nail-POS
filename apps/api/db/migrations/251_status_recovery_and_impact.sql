-- 191_status_recovery_and_impact.sql
-- Completes System Status: recovery-progress fields on incidents + a per-tenant/branch impact table. recovery_owner
-- already exists (migration 187); this adds the percentage + next milestone. Impact rows drive the Affected
-- Tenants / Branches panel and are scoped per tenant/branch so one tenant's impact is never shown to another.
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS recovery_percentage INTEGER NOT NULL DEFAULT 0 CHECK (recovery_percentage >= 0 AND recovery_percentage <= 100);
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS next_milestone      TEXT;

CREATE TABLE IF NOT EXISTS status_incident_impact (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference TEXT,
  tenant_id          UUID,
  tenant_name        TEXT,
  branch_name        TEXT,
  service            TEXT,
  impact_level       TEXT NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('critical','high','medium','low','informational')),
  comm_status        TEXT NOT NULL DEFAULT 'not_notified' CHECK (comm_status IN ('not_notified','scheduled','sent','delivered','partially_delivered','failed','in_progress')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_status_impact_incident ON status_incident_impact (incident_reference);
CREATE INDEX IF NOT EXISTS ix_status_impact_tenant ON status_incident_impact (tenant_id);
