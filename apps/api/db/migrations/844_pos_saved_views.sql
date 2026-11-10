-- 844_pos_saved_views.sql — POS saved views (Kevin, Nov 9 2026: "build all of it" — the SUNMI guides' optional "Saved Views",
-- "Smart Filter Presets", "Saved Filters", "Protected Saved Filters" recommendations).
--
-- A saved view is a named snapshot of ONE screen's filters (search, status, date preset, From–To, branch, sort, page size),
-- personal to the staff member who saved it, inside one salon. It stores filter VALUES only: opening a view re-runs the
-- screen's own query under the user's CURRENT permissions, so a view never widens what anyone may see (a branch or status
-- the user can no longer read is answered by the screen as before). Not shared across users or salons.
-- The Super Admin console keeps its own table (256_super_admin_saved_views); this one is the tenant POS's.
CREATE TABLE IF NOT EXISTS pos_saved_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  owner_user_id  UUID NOT NULL,
  surface        TEXT NOT NULL CHECK (surface ~ '^[a-z0-9][a-z0-9.-]{1,60}$'),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  filters_json   JSONB NOT NULL CHECK (jsonb_typeof(filters_json) = 'object' AND length(filters_json::text) <= 4096),
  is_default     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_saved_views_name ON pos_saved_views (tenant_id, owner_user_id, surface, lower(btrim(name)));
-- at most one default view per person per screen
CREATE UNIQUE INDEX IF NOT EXISTS ux_pos_saved_views_default ON pos_saved_views (tenant_id, owner_user_id, surface) WHERE is_default;
CREATE INDEX IF NOT EXISTS ix_pos_saved_views_owner ON pos_saved_views (tenant_id, owner_user_id, surface, updated_at DESC);
