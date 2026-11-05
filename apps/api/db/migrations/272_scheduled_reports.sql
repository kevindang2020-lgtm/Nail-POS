-- 174_scheduled_reports.sql — scheduled report definitions (the deferred "Scheduled Reports" unit, now unblocked by the
-- server-side export job + the delivery notifier). A definition names a report, its filters, a cadence, and a recipient;
-- an external scheduler hits the internal run-due endpoint, which generates the report and hands it to the notifier.
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  report_key         TEXT NOT NULL DEFAULT 'users',     -- which report to generate (currently: users)
  filters            JSONB NOT NULL DEFAULT '{}'::jsonb, -- same filter shape as the directory/export
  cadence            TEXT NOT NULL DEFAULT 'weekly',     -- daily | weekly | monthly
  recipient_email    TEXT,
  format             TEXT NOT NULL DEFAULT 'csv',
  enabled            BOOLEAN NOT NULL DEFAULT true,
  last_run_at        TIMESTAMPTZ,
  last_status        TEXT,                               -- delivered | failed | not_connected | unsupported
  next_run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_reports_due_idx ON scheduled_reports (next_run_at) WHERE enabled = true;
