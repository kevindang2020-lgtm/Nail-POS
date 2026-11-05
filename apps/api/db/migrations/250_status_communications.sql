-- 190_status_communications.sql
-- Communication log for tenant/public notifications sent from System Status (incident + maintenance notices). Records
-- only a safe message summary and audience — never private tenant contact details. Delivery uses the Communications
-- module; this table is the audit-facing log of what was sent.
CREATE TABLE IF NOT EXISTS status_communications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_reference TEXT,
  channel            TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('email','sms','push','in_app','public_status','tenant_notice')),
  audience           TEXT NOT NULL DEFAULT 'affected_tenants',
  message            TEXT NOT NULL,
  sent_by            TEXT,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_status_comm_sent ON status_communications (sent_at DESC);
CREATE INDEX IF NOT EXISTS ix_status_comm_incident ON status_communications (incident_reference);
