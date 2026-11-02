-- 151_workflow_runs.sql
-- Per-workflow run-history (spec §19, §23): one row per automation send so the Automation Workflows panel
-- (Birthday Campaigns, Review Requests, Rebooking Flows, Thank You Messages, AI Follow-Up Sequences) reports REAL
-- sent-today + success-rate per workflow instead of fixtures. Idempotent on (tenant_id, dedupe_key) so a retried job
-- never double-counts a send (spec §23). Producers (campaigns/communications/end-of-day-followups) call
-- WorkflowRunsService.record(). Tenant/branch scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS workflow_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  workflow_key   TEXT NOT NULL CHECK (workflow_key IN
                   ('appointment_reminder','birthday_campaign','review_request','rebooking_flow','thank_you','ai_follow_up')),
  dedupe_key     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped','queued')),
  customer_id    UUID,
  appointment_id UUID,
  detail         TEXT,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_key_time ON workflow_runs (tenant_id, workflow_key, ran_at DESC);
