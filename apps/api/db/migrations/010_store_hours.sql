-- 010_store_hours.sql — AIPowerSalon store hours + auto logout settings. Tenant/branch-scoped. Idempotent.
-- If store hours already live in another settings table, extend that model instead of duplicating.

CREATE TABLE IF NOT EXISTS store_hours_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID NOT NULL,
  timezone              TEXT NOT NULL DEFAULT 'America/New_York',
  auto_logout_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  warning_minutes       JSONB NOT NULL DEFAULT '[30,15,5]'::jsonb,
  grace_period_minutes  INTEGER NOT NULL DEFAULT 0,
  monday_is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  monday_close_time     TEXT DEFAULT '19:30',
  tuesday_is_open       BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday_close_time    TEXT DEFAULT '19:30',
  wednesday_is_open     BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday_close_time  TEXT DEFAULT '19:30',
  thursday_is_open      BOOLEAN NOT NULL DEFAULT TRUE,
  thursday_close_time   TEXT DEFAULT '19:30',
  friday_is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  friday_close_time     TEXT DEFAULT '19:30',
  saturday_is_open      BOOLEAN NOT NULL DEFAULT TRUE,
  saturday_close_time   TEXT DEFAULT '19:30',
  sunday_is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  sunday_close_time     TEXT,
  apply_to_roles        JSONB NOT NULL DEFAULT '["RECEPTION","FRONT_DESK","MANAGER"]'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id    UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_hours_tenant_branch
  ON store_hours_settings (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_store_hours_tenant
  ON store_hours_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_store_hours_branch
  ON store_hours_settings (branch_id);
