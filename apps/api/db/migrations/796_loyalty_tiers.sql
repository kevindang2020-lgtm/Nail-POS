-- 796_loyalty_tiers.sql — Loyalty guide (Nov 4 2026) "Manage Tiers": the salon's own tier list, with an optional
-- qualification threshold and benefits text, edited with validation and audit. Nothing is invented: no row is seeded,
-- and a member's tier stays the label on customer_loyalty_profiles.loyalty_tier (renaming a tier relabels its members
-- in the same transaction). min_points is shown as the configured threshold only — no automatic promotion formula is
-- introduced (guide: do not add a tier qualification formula). A tier is retired (active = false), never deleted.
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  rank        INTEGER NOT NULL DEFAULT 0 CHECK (rank >= 0),
  min_points  INTEGER CHECK (min_points IS NULL OR min_points >= 0),
  benefits    TEXT NOT NULL DEFAULT '' CHECK (length(benefits) <= 500),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_tiers_tenant_name ON loyalty_tiers (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS ix_loyalty_tiers_tenant_rank ON loyalty_tiers (tenant_id, rank, id);
