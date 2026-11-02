-- 445_incident_workflow.sql — Constitution 11 §168–176: harden status_incidents in place rather than add a second
-- incident table (audit decision D6: it already drives the status page, tenant notifications and post-incident
-- reports; a parallel table would split those).

-- §169 MITIGATING. The Super Admin timeline funnel already showed a "Mitigating" stage, but because this status could
-- not be stored it counted status = 'identified' under it — every identified incident appeared twice. Now real.
-- Same constraint name on re-add, so a mismatched drop collides and fails LOUDLY rather than leaving two checks.
ALTER TABLE status_incidents DROP CONSTRAINT IF EXISTS status_incidents_status_check;
ALTER TABLE status_incidents ADD CONSTRAINT status_incidents_status_check
  CHECK (status IN ('investigating','identified','mitigating','monitoring','resolved'));

-- §168 the fields the lifecycle was missing. recovery_owner (migration 247) is the incident commander (§171).
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS detected_at             TIMESTAMPTZ;
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS resolution              TEXT;
-- §176 alert → incident promotion: the alert this incident grew out of.
ALTER TABLE status_incidents ADD COLUMN IF NOT EXISTS promoted_from_alert_id  UUID;

-- §170 the incident timeline: detection, alerts, actions, provider updates, deployments, resolution — append-only.
CREATE TABLE IF NOT EXISTS status_incident_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('detected','promoted_from_alert','status_change','commander_assigned','action','provider_update','deployment','note','resolution')),
  body         TEXT NOT NULL,
  actor        TEXT,                       -- who (a Super Admin's id or name); NULL for system-written entries
  ref          TEXT,                       -- a request id, alert id, deployment id — whatever links this to evidence
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_status_incident_events_incident ON status_incident_events (incident_id, created_at);

-- §176 the reverse link: an alert that has been promoted knows its incident, so it is not promoted twice.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS incident_id UUID;
