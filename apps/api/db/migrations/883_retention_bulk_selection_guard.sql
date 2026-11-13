-- 883_retention_bulk_selection_guard.sql — Customer Retention Win-Back 15 (extras round 9): Bulk Selection Guardrails.
--
-- The salon sets how many customers one bulk selection may hold before the POS warns and the send path asks for the exact
-- count to be confirmed (NULL = the platform default, 200). It is a warning threshold, not a cap: the existing hard limit
-- (MAX_SELECTION 5000 per campaign) is unchanged. Versioned and audited with the other retention settings (PUT
-- /pos/retention/settings). Expand-only: one nullable column, no data change.
ALTER TABLE tenant_retention_settings ADD COLUMN IF NOT EXISTS bulk_selection_warn_at INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_retention_settings_bulk_warn_chk') THEN
    ALTER TABLE tenant_retention_settings ADD CONSTRAINT tenant_retention_settings_bulk_warn_chk CHECK (bulk_selection_warn_at IS NULL OR bulk_selection_warn_at BETWEEN 10 AND 5000);
  END IF;
END $$;
