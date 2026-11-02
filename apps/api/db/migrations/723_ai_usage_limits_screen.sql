-- 723_ai_usage_limits_screen.sql — AI Usage & Limits Complete Build Guide (Oct 30 2026). EXPAND-ONLY and idempotent.
--
--   platform_ai_package_settings      Super Admin's GLOBAL availability per AI package code (the catalog itself stays the
--                                     code registry, modules/ai/src/ai/ai-catalog.ts). No row = enabled. The access gate
--                                     reads it (packageEnabled), so "Disabled by admin" on the screen is what is enforced.
--   ai_usage_alerts                   server-side 80 / 90 / 100 % usage alerts, ONE per tenant × package × billing period
--                                     × threshold (unique). Written when usage crosses a threshold (usage logger) and on
--                                     read (backfills / late events); acknowledging is the only update. Never charges,
--                                     upgrades or raises a limit.
--   tenant_ai_subscription_events     append-only history of tenant-initiated subscription changes on the AI Usage page
--                                     (trial started, cancelled) with actor, from → to and the client's idempotency key
--                                     (unique per tenant: a double tap is one change).
--
-- Recovery: rolling back the code leaves these tables unread (packageEnabled falls back to true); nothing existing is
-- rewritten. Dropping ai_usage_alerts / tenant_ai_subscription_events would lose history — forward-fix only.

CREATE TABLE IF NOT EXISTS platform_ai_package_settings (
  package_code        text PRIMARY KEY,
  enabled             boolean NOT NULL DEFAULT true,
  disabled_reason     text,
  version             integer NOT NULL DEFAULT 1,
  updated_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_ai_package_settings_reason CHECK (enabled OR length(btrim(coalesce(disabled_reason, ''))) BETWEEN 3 AND 300)
);

CREATE TABLE IF NOT EXISTS ai_usage_alerts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  package_code          text NOT NULL,
  period_start          timestamptz NOT NULL,
  threshold             smallint NOT NULL CHECK (threshold IN (80, 90, 100)),
  used                  bigint NOT NULL,
  usage_limit           bigint NOT NULL CHECK (usage_limit > 0),
  usage_unit            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  acknowledged_at       timestamptz,
  acknowledged_by_user_id uuid,
  CONSTRAINT uq_ai_usage_alerts UNIQUE (tenant_id, package_code, period_start, threshold)
);
CREATE INDEX IF NOT EXISTS ai_usage_alerts_open_idx ON ai_usage_alerts (tenant_id, created_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant_ai_subscription_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  package_code      text NOT NULL,
  event_type        text NOT NULL CHECK (event_type IN ('trial_started', 'cancelled')),
  from_status       text,
  to_status         text NOT NULL,
  actor_user_id     uuid,
  actor_role        text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_ai_subscription_events_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS tenant_ai_subscription_events_pkg_idx ON tenant_ai_subscription_events (tenant_id, package_code, created_at DESC);

CREATE OR REPLACE FUNCTION tenant_ai_subscription_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tenant_ai_subscription_events is append-only'; END $$;
DROP TRIGGER IF EXISTS tenant_ai_subscription_events_no_change ON tenant_ai_subscription_events;
CREATE TRIGGER tenant_ai_subscription_events_no_change BEFORE UPDATE OR DELETE ON tenant_ai_subscription_events
  FOR EACH ROW EXECUTE FUNCTION tenant_ai_subscription_events_append_only();

CREATE INDEX IF NOT EXISTS ai_usage_logs_tenant_created_idx ON ai_usage_logs (tenant_id, created_at DESC);
