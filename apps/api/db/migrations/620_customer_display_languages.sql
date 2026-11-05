-- 620_customer_display_languages.sql — Dual-Screen mandate §118–§119 (Oct 12 2026): the languages a salon offers on its
-- customer display (check-in, checkout ticket, tip, payment status, receipt, thank-you). English and Vietnamese; the
-- FIRST is the salon's default — a guest may switch for their own visit, the next guest starts in the default again.
-- Kept with the salon's other customer-facing check-in / display options (tenant_checkin_settings, one row per salon).
-- Expand-only: a new column with a default every existing row satisfies, so the CHECK is valid at once (no backfill).
ALTER TABLE tenant_checkin_settings ADD COLUMN IF NOT EXISTS display_languages TEXT[] NOT NULL DEFAULT ARRAY['en']::text[];
DO $$ BEGIN
  ALTER TABLE tenant_checkin_settings ADD CONSTRAINT ck_tenant_checkin_display_languages
    CHECK (cardinality(display_languages) BETWEEN 1 AND 2 AND display_languages <@ ARRAY['en', 'vi']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
