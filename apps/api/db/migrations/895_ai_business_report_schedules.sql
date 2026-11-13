-- 895_ai_business_report_schedules.sql — AI Business Reports 14 "Automated daily, weekly and monthly reports" (extras, Nov 12 2026).
-- (Numbered 895: agent 5 of the final extras round already used 875 and 885; 89x is used by nobody else.)
--
-- Until now a report existed only when someone pressed a button with the page open. A person now turns on their OWN schedule
-- (self-consented, like the Daily Summary e-mail of migration 845) and the existing AI Business background tick (the one that
-- already evaluates alert rules every 5 minutes, runAsSingleOwner) makes the report on the server:
--   daily_brief     every day,                        for YESTERDAY (a complete salon day)   — at or after send_hour, salon time
--   weekly_summary  every Sunday,                     for THIS WEEK (Monday → Sunday)       — at or after send_hour
--   monthly_review  on the last day of each month,    for THIS MONTH                         — at or after send_hour
-- It is made through the SAME report path as the button (AiBusinessReportsService.create + the canonical Sales Report
-- snapshot Verify checks), as the schedule's owner with that person's CURRENT role — an owner who left, or lost AI Business,
-- gets no report (recorded as skipped, never run as someone else). One report per occurrence (claimed with last_occurrence,
-- so two processes or a retry never make two). When it is ready, an in-app line lands in the Owner app Alerts inbox
-- (owner_alerts) with no figures in it. Nothing here edits a sale, a booking or a schedule of anyone.
CREATE TABLE IF NOT EXISTS ai_business_report_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  branch_id        UUID,                                    -- the location the owner's reports are scoped to (NULL = salon-wide)
  owner_user_id    UUID NOT NULL,
  report_type      TEXT NOT NULL CHECK (report_type IN ('daily_brief', 'weekly_summary', 'monthly_review')),
  send_hour        SMALLINT NOT NULL CHECK (send_hour BETWEEN 0 AND 23),
  active           BOOLEAN NOT NULL DEFAULT true,
  notify_in_app    BOOLEAN NOT NULL DEFAULT true,
  last_occurrence  TEXT,                                    -- the salon-local date of the last occurrence handled (claim key)
  last_run_at      TIMESTAMPTZ,
  last_outcome     TEXT CHECK (last_outcome IS NULL OR last_outcome IN ('generated', 'failed', 'skipped')),
  last_reason      TEXT CHECK (last_reason IS NULL OR length(last_reason) <= 300),
  last_report_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_business_report_schedules_owner ON ai_business_report_schedules (tenant_id, owner_user_id, report_type, branch_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS ix_ai_business_report_schedules_due ON ai_business_report_schedules (active, last_run_at);

-- which schedule made a report (NULL = made by hand); shown on the report as "Made by your schedule"
ALTER TABLE ai_business_report_jobs ADD COLUMN IF NOT EXISTS schedule_id UUID;
