-- 070_daily_follow_up_queue.sql — End-of-Day Tech Follow-Up / "Daily Follow-Up Queue".
-- Generates one follow-up task per COMPLETED ticket service line at end of business day (branch-local ~20:00),
-- OWNED BY THE LINE'S technician_id (the main tech for that line). The ticket-level helper_technician_id (025) is
-- never used as an owner, so a helping tech receives no duplicate task; a tech who is the main tech on a different
-- line gets a task for THAT line. Tenant- and branch-scoped throughout. Idempotent (CREATE ... IF NOT EXISTS) so it
-- can be re-applied safely; the unique indexes make re-running generation a no-op.

CREATE TABLE IF NOT EXISTS service_follow_up_tasks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID NOT NULL,
  business_date               DATE NOT NULL,
  customer_id                 UUID NOT NULL,
  technician_id               UUID NOT NULL,
  ticket_id                   UUID NOT NULL,
  ticket_service_line_id      UUID NOT NULL,
  appointment_id              UUID,
  service_id                  UUID,
  service_name_snapshot       TEXT NOT NULL DEFAULT '',
  customer_name_snapshot      TEXT NOT NULL DEFAULT '',
  customer_phone_snapshot     TEXT,
  technician_name_snapshot    TEXT NOT NULL DEFAULT '',
  customer_app_user_id        UUID,
  completed_at                TIMESTAMPTZ,
  status                      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','dismissed','failed','customer_not_available','customer_replied','rebooked')),
  message_template_key        TEXT,
  suggested_message           TEXT NOT NULL DEFAULT '',
  sent_message                TEXT,
  sent_at                     TIMESTAMPTZ,
  sent_by_user_id             UUID,
  skip_reason                 TEXT,
  customer_app_notification_id UUID,
  customer_viewed_at          TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);
-- Dedup: at most one live task per (tenant, branch, service line, technician). This is the spec's unique key and is
-- what makes a duplicate job run — or a manual "Generate Now" — insert only genuinely new lines.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sfut_line_tech
  ON service_follow_up_tasks (tenant_id, branch_id, ticket_service_line_id, technician_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sfut_tech_date    ON service_follow_up_tasks (tenant_id, branch_id, technician_id, business_date);
CREATE INDEX IF NOT EXISTS ix_sfut_branch_date  ON service_follow_up_tasks (tenant_id, branch_id, business_date);
CREATE INDEX IF NOT EXISTS ix_sfut_customer     ON service_follow_up_tasks (tenant_id, customer_id, created_at DESC);

-- Per-branch/day generation marker — the idempotency guard for the scheduler (one run per branch per business date).
CREATE TABLE IF NOT EXISTS daily_follow_up_generation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  business_date   DATE NOT NULL,
  run_status      TEXT NOT NULL DEFAULT 'completed' CHECK (run_status IN ('started','completed','failed')),
  trigger_source  TEXT NOT NULL DEFAULT 'scheduler' CHECK (trigger_source IN ('scheduler','manual')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  created_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dfugr_tenant_branch_date
  ON daily_follow_up_generation_runs (tenant_id, branch_id, business_date);

-- Per-branch feature settings. Branch timezone is read from store_hours_settings (010); `timezone` here is an optional
-- override only.
CREATE TABLE IF NOT EXISTS daily_follow_up_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL,
  branch_id                 UUID NOT NULL,
  enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
  generation_time           TEXT NOT NULL DEFAULT '20:00',
  timezone                  TEXT,
  default_message_template  TEXT,
  allow_tech_edit_message   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_customer_replies    BOOLEAN NOT NULL DEFAULT TRUE,
  require_manager_approval  BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_to_tech          BOOLEAN NOT NULL DEFAULT TRUE,
  create_mode               TEXT NOT NULL DEFAULT 'end_of_day' CHECK (create_mode IN ('end_of_day','after_checkout')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id        UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dfus_tenant_branch
  ON daily_follow_up_settings (tenant_id, branch_id);
