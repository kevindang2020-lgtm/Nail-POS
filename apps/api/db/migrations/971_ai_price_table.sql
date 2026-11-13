-- 971_ai_price_table.sql — AI Usage Limits 07 (extras round 11): the Super Admin AI PRICE TABLE, as a mechanism only.
-- The table starts EMPTY: until a Super Admin publishes a version, every salon's AI Usage screen says "no price set" and
-- nothing about today's billing changes (the package catalog and the salon's stored subscription price stay the price
-- source). No price is seeded here.
--
--   platform_ai_price_versions      one row per PUBLISHED version: number, effective_from, and the per-version choice
--                                   existing_salons_keep_previous — NOT NULL with NO default, so publishing must state it
--   platform_ai_price_version_rows  the version's prices: feature (AI package code) × unit (month / year / overage_unit) →
--                                   integer cents
--   tenant_ai_price_overrides       an optional per-salon price for one feature × unit, append-only: the newest row in
--                                   effect wins; a row with price_cents NULL removes the override
--
-- All three are immutable (append-only): a published price or an override is never edited or deleted — a change is a new
-- version / a new override row, so the history of what a salon was shown can always be read back. PG16, no pgcrypto.
-- Rollback: DROP TABLE tenant_ai_price_overrides, platform_ai_price_version_rows, platform_ai_price_versions;
--           DROP FUNCTION ai_price_table_immutable();
CREATE TABLE IF NOT EXISTS platform_ai_price_versions (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no                     INTEGER NOT NULL UNIQUE CHECK (version_no >= 1),
  effective_from                 TIMESTAMPTZ NOT NULL,
  existing_salons_keep_previous  BOOLEAN NOT NULL,
  note                           TEXT CHECK (note IS NULL OR length(note) <= 500),
  published_by                   UUID,
  published_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_platform_ai_price_versions_effective ON platform_ai_price_versions (effective_from, version_no);

CREATE TABLE IF NOT EXISTS platform_ai_price_version_rows (
  version_id   UUID NOT NULL REFERENCES platform_ai_price_versions (id),
  feature      TEXT NOT NULL CHECK (feature ~ '^[a-z0-9_]{1,60}$'),
  unit         TEXT NOT NULL CHECK (unit IN ('month', 'year', 'overage_unit')),
  price_cents  INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 1000000),
  PRIMARY KEY (version_id, feature, unit)
);

CREATE TABLE IF NOT EXISTS tenant_ai_price_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants (id),
  feature         TEXT NOT NULL CHECK (feature ~ '^[a-z0-9_]{1,60}$'),
  unit            TEXT NOT NULL CHECK (unit IN ('month', 'year', 'overage_unit')),
  price_cents     INTEGER CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000),
  effective_from  TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  set_by          UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tenant_ai_price_overrides_lookup ON tenant_ai_price_overrides (tenant_id, feature, unit, effective_from DESC, created_at DESC);

CREATE OR REPLACE FUNCTION ai_price_table_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: a published AI price or override cannot be changed or removed', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_platform_ai_price_versions_immutable ON platform_ai_price_versions;
CREATE TRIGGER trg_platform_ai_price_versions_immutable BEFORE UPDATE OR DELETE ON platform_ai_price_versions FOR EACH ROW EXECUTE FUNCTION ai_price_table_immutable();
DROP TRIGGER IF EXISTS trg_platform_ai_price_version_rows_immutable ON platform_ai_price_version_rows;
CREATE TRIGGER trg_platform_ai_price_version_rows_immutable BEFORE UPDATE OR DELETE ON platform_ai_price_version_rows FOR EACH ROW EXECUTE FUNCTION ai_price_table_immutable();
DROP TRIGGER IF EXISTS trg_tenant_ai_price_overrides_immutable ON tenant_ai_price_overrides;
CREATE TRIGGER trg_tenant_ai_price_overrides_immutable BEFORE UPDATE OR DELETE ON tenant_ai_price_overrides FOR EACH ROW EXECUTE FUNCTION ai_price_table_immutable();
