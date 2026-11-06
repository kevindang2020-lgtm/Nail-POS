-- 826_ai_business_alert_incidents.sql — A2 AI Business Alerts guide, the parts listed as "not built" (Nov 6 2026):
-- incidents, notifications with cooldown / quiet hours / escalation and a delivery log, per-rule severity and recipients.
-- Additive only. Rollback: drop the two tables and the added columns.
--
-- Rule delivery settings (ai_business_alerts):
--   severity          info | warning | critical
--   channels          where a triggered alert goes: in_app (the Owner app Alerts inbox, owner_alerts) / email / sms
--   recipient_user_ids staff accounts to notify by email / SMS; empty = the salon's owners and managers
--   quiet_hours_*     salon-local hours when email / SMS wait (in-app always lands); equal = no quiet window
--   cooldown_minutes  a rule that re-triggers inside the cooldown is recorded, not re-sent
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'warning';
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS channels TEXT[];
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS recipient_user_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT NOT NULL DEFAULT 21;
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT NOT NULL DEFAULT 8;
ALTER TABLE ai_business_alerts ADD COLUMN IF NOT EXISTS cooldown_minutes INTEGER NOT NULL DEFAULT 60;
UPDATE ai_business_alerts SET channels = ARRAY[channel] WHERE channels IS NULL;
ALTER TABLE ai_business_alerts ALTER COLUMN channels SET DEFAULT ARRAY['in_app'];
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_business_alerts_severity_chk') THEN
    ALTER TABLE ai_business_alerts ADD CONSTRAINT ai_business_alerts_severity_chk CHECK (severity IN ('info', 'warning', 'critical'));
    ALTER TABLE ai_business_alerts ADD CONSTRAINT ai_business_alerts_quiet_chk CHECK (quiet_hours_start BETWEEN 0 AND 23 AND quiet_hours_end BETWEEN 0 AND 23);
    ALTER TABLE ai_business_alerts ADD CONSTRAINT ai_business_alerts_cooldown_chk CHECK (cooldown_minutes BETWEEN 0 AND 10080);
  END IF;
END $$;

-- Incidents: a TRIGGERED event is an incident. open → investigating → resolved (or snoozed until a time); reopen allowed.
-- Acknowledge (781) stays and now also moves an open incident to investigating.
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS incident_status TEXT;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS assignee_user_id UUID;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE ai_business_alert_events ADD COLUMN IF NOT EXISTS incident_version INTEGER NOT NULL DEFAULT 1;
UPDATE ai_business_alert_events SET incident_status = CASE WHEN acknowledged_at IS NULL THEN 'open' ELSE 'investigating' END
 WHERE triggered AND state_change = 'triggered' AND incident_status IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_business_alert_events_incident_chk') THEN
    ALTER TABLE ai_business_alert_events ADD CONSTRAINT ai_business_alert_events_incident_chk CHECK (incident_status IS NULL OR incident_status IN ('open', 'investigating', 'snoozed', 'resolved'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_events_incidents ON ai_business_alert_events (tenant_id, incident_status, evaluated_at DESC) WHERE incident_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_business_alert_incident_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  event_id       UUID NOT NULL REFERENCES ai_business_alert_events(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('note', 'status', 'assign', 'notify', 'escalate')),
  body           TEXT NOT NULL,
  author_user_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_incident_notes ON ai_business_alert_incident_notes (tenant_id, event_id, created_at);

-- Delivery log: one row per channel × recipient for each triggered (or escalated) event, sent / skipped (with why) / failed.
CREATE TABLE IF NOT EXISTS ai_business_alert_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  event_id          UUID NOT NULL REFERENCES ai_business_alert_events(id) ON DELETE CASCADE,
  alert_id          UUID NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'sms')),
  recipient_user_id UUID,
  recipient         TEXT,
  kind              TEXT NOT NULL DEFAULT 'trigger' CHECK (kind IN ('trigger', 'escalation')),
  status            TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  reason            TEXT,
  provider_ref      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_deliveries_event ON ai_business_alert_deliveries (tenant_id, event_id);
CREATE INDEX IF NOT EXISTS ix_ai_business_alert_deliveries_alert ON ai_business_alert_deliveries (tenant_id, alert_id, created_at DESC);
