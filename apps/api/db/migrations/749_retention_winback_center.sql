-- 749_retention_winback_center.sql — Customer Retention & Win-Back Complete Build Guide (Oct 30 2026), owner recommendation 1:
-- "Check Retention Data". A READ-ONLY verification of the retention data (it never edits a customer, ticket or message);
-- each run is recorded so "last successful verification" per check is a fact, not a guess.
--
--   retention_health_runs   one row per check run: overall status, per-check results (status / affected count / sample
--                           customer ids of THIS salon / cause / fix), the ruleset + settings version it ran under, who ran it.
--                           Manual runs are limited to one per salon per minute (enforced in the same transaction under a
--                           per-salon advisory lock, so two taps at once record ONE run).
--
-- Additive only. Rollback: DROP TABLE retention_health_runs;
CREATE TABLE IF NOT EXISTS retention_health_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  branch_id              uuid,
  trigger                text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual')),
  overall                text NOT NULL CHECK (overall IN ('ready', 'attention_required', 'failed', 'unknown')),
  results                jsonb NOT NULL DEFAULT '{}'::jsonb,
  ruleset_version        text NOT NULL,
  settings_version       integer NOT NULL,
  duration_ms            integer NOT NULL DEFAULT 0,
  created_by_user_id     uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_retention_health_runs_tenant_created ON retention_health_runs (tenant_id, created_at DESC, id DESC);
