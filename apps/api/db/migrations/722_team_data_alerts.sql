-- 722_team_data_alerts.sql — Team Management Data Accuracy Alerts (Team Management build guide §13, 30 Oct 2026).
-- EXPAND-ONLY and idempotent: three new tables, their indexes and triggers. No existing row, employee, shift, override,
-- time-clock punch, commission snapshot, adjustment, payout, rating or approval is read, rewritten or dropped here.
--
--   team_data_alerts         one persisted alert per data-backed finding (stable fingerprint per tenant): shift/status
--                            mismatch, missing service mapping, commission earned vs paid for a paid payroll period,
--                            attendance disagreement (clock-in vs scheduled start beyond the documented tolerance),
--                            duplicate / stale directory links. A rescan only refreshes last_seen_at — it never resets a
--                            reviewer's decision. An alert is WORKFLOW ONLY: nothing pays, deducts, edits a shift, a
--                            status, a mapping or a link because of it.
--   team_data_alert_events   its append-only history (DETECTED / ASSIGNED / INVESTIGATION_STARTED / NOTE_ADDED /
--                            RESOLVED / DISMISSED / REOPENED / DENIED) with actor, old → new status, reason, request id.
--   team_data_alert_runs     each Run Check (who, when, which detectors, counts) — the "last checked" timestamp.
--
-- Recovery: every table is new. Rolling the code back leaves them unread; nothing must be dropped (dropping them would
-- destroy review decisions) — forward-fix only (docs/handoff/TEAM_MANAGEMENT_2026-10-30.md).

CREATE TABLE IF NOT EXISTS team_data_alerts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  branch_id            uuid,
  fingerprint          text NOT NULL,
  alert_type           text NOT NULL,
  status               text NOT NULL DEFAULT 'OPEN',
  severity             text NOT NULL DEFAULT 'medium',
  user_id              uuid,                  -- the staff member the alert concerns (users.id), when known
  technician_id        uuid,                  -- the technician record, when the alert concerns one
  related_user_id      uuid,                  -- the OTHER record of a duplicate pair
  related_technician_id uuid,
  subject_date         date,                  -- salon-local day the evidence is about (shift / attendance alerts)
  period_ref           text,                  -- payroll period id (commission alerts)
  summary              text NOT NULL,
  evidence_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_user_id  uuid,
  assigned_at          timestamptz,
  investigating_at     timestamptz,
  resolution_note      text,
  resolved_at          timestamptz,
  resolved_by          uuid,
  dismiss_reason       text,
  dismissed_at         timestamptz,
  dismissed_by         uuid,
  version              integer NOT NULL DEFAULT 1,
  detected_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  run_id               uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_data_alert_fingerprint UNIQUE (tenant_id, fingerprint),
  CONSTRAINT uq_team_data_alert_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_team_data_alert_status CHECK (status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
  CONSTRAINT ck_team_data_alert_type CHECK (alert_type IN ('SHIFT_STATUS_MISMATCH', 'MISSING_SERVICE_MAPPING', 'COMMISSION_PAID_MISMATCH',
    'ATTENDANCE_DISAGREEMENT', 'DUPLICATE_CONTACT', 'STALE_USER_LINK')),
  CONSTRAINT ck_team_data_alert_severity CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT ck_team_data_alert_lengths CHECK (length(fingerprint) BETWEEN 1 AND 300 AND length(summary) <= 500
    AND (resolution_note IS NULL OR length(resolution_note) <= 2000) AND (dismiss_reason IS NULL OR length(dismiss_reason) <= 2000)),
  CONSTRAINT ck_team_data_alert_version CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_tda_status_detected ON team_data_alerts (tenant_id, status, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tda_detected ON team_data_alerts (tenant_id, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tda_user ON team_data_alerts (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tda_technician ON team_data_alerts (tenant_id, technician_id) WHERE technician_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_data_alert_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid,
  alert_id           uuid NOT NULL,
  actor_user_id      uuid,
  event_type         text NOT NULL,
  old_status         text,
  new_status         text,
  reason             text,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- the alert must belong to the SAME tenant
  CONSTRAINT fk_tda_event_alert FOREIGN KEY (tenant_id, alert_id) REFERENCES team_data_alerts (tenant_id, id),
  CONSTRAINT ck_tda_event_type CHECK (event_type IN ('DETECTED', 'ASSIGNED', 'INVESTIGATION_STARTED', 'NOTE_ADDED', 'RESOLVED', 'DISMISSED', 'REOPENED', 'DENIED')),
  CONSTRAINT ck_tda_event_lengths CHECK ((reason IS NULL OR length(reason) <= 2000) AND (request_id IS NULL OR length(request_id) <= 100))
);
CREATE INDEX IF NOT EXISTS idx_tda_events_alert ON team_data_alert_events (tenant_id, alert_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS team_data_alert_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid,
  actor_user_id uuid,
  status        text NOT NULL DEFAULT 'running',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  summary_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    text,
  CONSTRAINT ck_tda_run_status CHECK (status IN ('running', 'succeeded', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_tda_runs ON team_data_alert_runs (tenant_id, started_at DESC, id DESC);

-- the history is append-only; an alert row is never deleted (a false positive is DISMISSED with a reason, not removed)
CREATE OR REPLACE FUNCTION team_data_alerts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_tda_events_append_only ON team_data_alert_events;
CREATE TRIGGER trg_tda_events_append_only BEFORE UPDATE OR DELETE ON team_data_alert_events FOR EACH ROW EXECUTE FUNCTION team_data_alerts_append_only();
CREATE OR REPLACE FUNCTION team_data_alerts_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'team_data_alerts rows are never deleted'; END $$;
DROP TRIGGER IF EXISTS trg_tda_no_delete ON team_data_alerts;
CREATE TRIGGER trg_tda_no_delete BEFORE DELETE ON team_data_alerts FOR EACH ROW EXECUTE FUNCTION team_data_alerts_no_delete();
