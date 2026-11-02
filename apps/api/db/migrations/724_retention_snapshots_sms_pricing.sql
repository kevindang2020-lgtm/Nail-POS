-- 724_retention_snapshots_sms_pricing.sql — Customer Retention, Four-Module Completion Guide (Oct 30 2026) CR-01 + CR-03.
-- EXPAND-ONLY and idempotent (every statement may run again; nothing existing is rewritten or dropped).
--
--   tenant_retention_settings_history   append-only: every version of a salon's thresholds with the instant it took effect.
--                                       The backfill reads the definition IN FORCE on a past date from here (a later edit
--                                       never rewrites history: it is a new definition_version). Seeded once from the
--                                       current tenant_retention_settings rows (the earlier versions were not kept before
--                                       this migration — a past date before the seeded row is reported as incomplete).
--   customer_retention_snapshot_runs    one row per (salon, salon-local date, definition_version): status running /
--                                       completed / failed, coverage complete / reconstructed / incomplete (+ reason),
--                                       kind nightly / backfill, the thresholds used, the source watermark, the job id,
--                                       attempts and the error of a failed attempt (a failure is visible, never zero).
--   customer_retention_daily_snapshots  append-only: one row per customer per completed salon-local day per definition
--                                       version — segment, first / last qualifying visit, visit count, net lifetime value,
--                                       days away, data quality, run id, calculated_at, source watermark.
--   tenant_sms_pricing                  append-only, effective-dated: the salon's SMS retail price per segment, carrier fee
--                                       per segment (NULL = unknown), tax rate (NULL = unknown), currency. No row = "Price
--                                       unknown — cannot estimate" (never $0). Changes are audited (retention.sms_pricing.set).
--
-- Recovery: rolling the code back leaves these tables unread. Do NOT drop them (they are the salon's history and its
-- configured price). A production run needs owner approval; the indexes are small (new tables) so no CONCURRENTLY needed.

CREATE TABLE IF NOT EXISTS tenant_retention_settings_history (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  version                   integer NOT NULL,
  risk_days                 integer NOT NULL,
  approaching_days          integer NOT NULL,
  observation_window_days   integer NOT NULL,
  effective_from            timestamptz NOT NULL,
  source                    text NOT NULL DEFAULT 'settings_update' CHECK (source IN ('settings_update', 'migration_seed')),
  changed_by_user_id        uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_retention_settings_history_uq UNIQUE (tenant_id, version)
);
CREATE INDEX IF NOT EXISTS tenant_retention_settings_history_eff_idx ON tenant_retention_settings_history (tenant_id, effective_from);
INSERT INTO tenant_retention_settings_history (tenant_id, version, risk_days, approaching_days, observation_window_days, effective_from, source, changed_by_user_id)
  SELECT s.tenant_id, s.version, s.risk_days, s.approaching_days, s.observation_window_days, s.updated_at, 'migration_seed', s.updated_by_user_id
  FROM tenant_retention_settings s
  ON CONFLICT (tenant_id, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS customer_retention_snapshot_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  snapshot_local_date       date NOT NULL,
  definition_version        text NOT NULL,
  settings_version          integer NOT NULL,
  segmentation_version      text NOT NULL,
  risk_days                 integer NOT NULL,
  approaching_days          integer NOT NULL,
  time_zone                 text NOT NULL,
  kind                      text NOT NULL CHECK (kind IN ('nightly', 'backfill')),
  status                    text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  coverage                  text CHECK (coverage IN ('complete', 'reconstructed', 'incomplete')),
  coverage_reason           text,
  source_watermark          timestamptz,
  earliest_ticket_at        timestamptz,
  customers_count           integer NOT NULL DEFAULT 0,
  rows_written              integer NOT NULL DEFAULT 0,
  attempts                  integer NOT NULL DEFAULT 1,
  last_error                text,
  job_id                    uuid,
  requested_by_user_id      uuid,
  started_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_retention_snapshot_runs_uq UNIQUE (tenant_id, snapshot_local_date, definition_version)
);
CREATE INDEX IF NOT EXISTS customer_retention_snapshot_runs_date_idx ON customer_retention_snapshot_runs (tenant_id, snapshot_local_date DESC);

CREATE TABLE IF NOT EXISTS customer_retention_daily_snapshots (
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  customer_id               uuid NOT NULL,
  snapshot_local_date       date NOT NULL,
  definition_version        text NOT NULL,
  settings_version          integer NOT NULL,
  segment                   text NOT NULL CHECK (segment IN ('never_visited', 'active', 'approaching', 'at_risk')),
  first_visit_at            timestamptz,
  last_visit_at             timestamptz,
  visit_count               integer NOT NULL DEFAULT 0,
  net_lifetime_value_cents  bigint NOT NULL DEFAULT 0,
  days_away                 integer,
  data_quality              text NOT NULL CHECK (data_quality IN ('complete', 'reconstructed', 'incomplete')),
  run_id                    uuid NOT NULL REFERENCES customer_retention_snapshot_runs(id),
  source_watermark          timestamptz,
  calculated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_retention_daily_snapshots_pk PRIMARY KEY (tenant_id, customer_id, snapshot_local_date, definition_version)
);
CREATE INDEX IF NOT EXISTS customer_retention_daily_snapshots_seg_idx ON customer_retention_daily_snapshots (tenant_id, snapshot_local_date, definition_version, segment);
CREATE INDEX IF NOT EXISTS customer_retention_daily_snapshots_cust_idx ON customer_retention_daily_snapshots (tenant_id, customer_id, snapshot_local_date);

CREATE TABLE IF NOT EXISTS tenant_sms_pricing (
  id                                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                          uuid NOT NULL REFERENCES tenants(id),
  currency                           text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  retail_price_per_segment           numeric(12,5) NOT NULL CHECK (retail_price_per_segment >= 0 AND retail_price_per_segment <= 10),
  carrier_fee_per_segment            numeric(12,5) CHECK (carrier_fee_per_segment IS NULL OR (carrier_fee_per_segment >= 0 AND carrier_fee_per_segment <= 10)),
  tax_rate_percent                   numeric(7,4) CHECK (tax_rate_percent IS NULL OR (tax_rate_percent >= 0 AND tax_rate_percent <= 50)),
  effective_from                     timestamptz NOT NULL DEFAULT now(),
  note                               text,
  set_by_user_id                     uuid,
  set_by_role                        text,
  created_at                         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_sms_pricing_eff_idx ON tenant_sms_pricing (tenant_id, effective_from DESC, created_at DESC);

-- append-only guards (history is never edited in place)
CREATE OR REPLACE FUNCTION retention_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_retention_settings_history_append_only ON tenant_retention_settings_history;
CREATE TRIGGER trg_retention_settings_history_append_only BEFORE UPDATE OR DELETE ON tenant_retention_settings_history FOR EACH ROW EXECUTE FUNCTION retention_history_append_only();
DROP TRIGGER IF EXISTS trg_retention_daily_snapshots_append_only ON customer_retention_daily_snapshots;
CREATE TRIGGER trg_retention_daily_snapshots_append_only BEFORE UPDATE OR DELETE ON customer_retention_daily_snapshots FOR EACH ROW EXECUTE FUNCTION retention_history_append_only();
DROP TRIGGER IF EXISTS trg_tenant_sms_pricing_append_only ON tenant_sms_pricing;
CREATE TRIGGER trg_tenant_sms_pricing_append_only BEFORE UPDATE OR DELETE ON tenant_sms_pricing FOR EACH ROW EXECUTE FUNCTION retention_history_append_only();
