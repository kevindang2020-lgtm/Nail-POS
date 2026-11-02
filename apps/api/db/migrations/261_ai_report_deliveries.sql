-- 181_ai_report_deliveries.sql — recipient-level delivery for a report run. One row per (run, recipient); a retry
-- reuses it (UNIQUE run_id+recipient_id), so a delivery-only failure is retried WITHOUT regenerating the report. Status
-- is tracked per recipient; the aggregate run delivery status follows a documented rule. Ineligible recipients are
-- recorded (excluded) with a reason — never silently delivered, and never across tenants.
CREATE TABLE IF NOT EXISTS ai_report_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES ai_report_runs (id) ON DELETE CASCADE,
  recipient_id      UUID NOT NULL,
  recipient_type    TEXT NOT NULL DEFAULT 'user',
  recipient_tenant  UUID,
  channel           TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','in_app','signed_link')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','queued','in_progress','delivered','failed','bounced','suppressed','excluded','cancelled')),
  excluded_reason   TEXT,
  failure_category  TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  delivered_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_report_deliveries_uniq UNIQUE (run_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_report_deliveries_run ON ai_report_deliveries (run_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_report_deliveries_status ON ai_report_deliveries (status, created_at);
