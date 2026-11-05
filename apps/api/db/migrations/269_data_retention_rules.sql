-- 189_data_retention_rules.sql — versioned data-retention rules per data class + a purge-run ledger. Each save creates a
-- new version; one active per data class. Retention below a documented compliance floor is rejected in code. The purge
-- PREVIEW is a dry run (count only, no PII, nothing deleted); physical purge is a separate data-plane integration. Every
-- change + preview is audited/ledgered.
CREATE TABLE IF NOT EXISTS data_retention_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_class     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  retention_days INTEGER NOT NULL,
  action         TEXT NOT NULL DEFAULT 'delete' CHECK (action IN ('delete','anonymize','archive')),
  scope          TEXT NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform','tenant')),
  target         TEXT,
  description    TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT data_retention_rules_version UNIQUE (data_class, version)
);
CREATE INDEX IF NOT EXISTS idx_data_retention_rules_active ON data_retention_rules (data_class, status, version DESC);

CREATE TABLE IF NOT EXISTS data_retention_purge_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_class    TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','executed')),
  cutoff        TIMESTAMPTZ,
  eligible_count INTEGER NOT NULL DEFAULT 0,
  net_count     INTEGER NOT NULL DEFAULT 0,
  actor_user_id UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_retention_purge_runs_class ON data_retention_purge_runs (data_class, occurred_at);
