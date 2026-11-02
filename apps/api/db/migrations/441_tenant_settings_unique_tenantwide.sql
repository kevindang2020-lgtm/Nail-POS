-- 441_tenant_settings_unique_tenantwide.sql — fixes a latent bug in migration 016 that affects EVERY settings
-- category, not just AI.
--
-- 016 declares UNIQUE (tenant_id, branch_id, category). In Postgres, NULLs are DISTINCT in a unique
-- constraint, so two rows with branch_id IS NULL do not conflict — which means:
--   · every tenant-WIDE settings row can silently duplicate, and
--   · `ON CONFLICT (tenant_id, branch_id, category) DO UPDATE` never matches for a tenant-wide row, so an
--     upsert inserts a second row instead of updating the first.
-- A later read then returns whichever row it happens to find. Found while writing a PGlite round-trip test for
-- tenant AI settings: the second save produced two rows rather than updating one.
--
-- The branch-scoped case was always fine; only NULL branch_id was affected.

-- 1. Collapse any existing duplicates, keeping the most recently updated row per (tenant, category).
DELETE FROM tenant_settings t
USING tenant_settings keep
WHERE t.branch_id IS NULL AND keep.branch_id IS NULL
  AND t.tenant_id = keep.tenant_id AND t.category = keep.category
  AND (t.updated_at, t.id) < (keep.updated_at, keep.id);

-- 2. A partial unique index covers what the constraint cannot: one tenant-wide row per category.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_settings_tenantwide
  ON tenant_settings (tenant_id, category) WHERE branch_id IS NULL;
