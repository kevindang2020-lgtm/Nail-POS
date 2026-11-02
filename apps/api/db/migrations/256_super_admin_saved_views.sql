-- 176_super_admin_saved_views.sql — persisted Super Admin saved views (§6). A saved view is a named snapshot of a
-- surface's filters (role/status/tenant/search/sort), personal to the Super Admin who created it (owner_user_id is
-- always server-derived, never client-supplied). Optional per-surface default view. Sharing across admins is not
-- modeled here (personal views only) — a future enhancement.
CREATE TABLE IF NOT EXISTS super_admin_saved_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  surface       TEXT NOT NULL,
  name          TEXT NOT NULL,
  filters_json  TEXT NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT super_admin_saved_views_unique UNIQUE (owner_user_id, surface, name)
);
CREATE INDEX IF NOT EXISTS idx_super_admin_saved_views_owner ON super_admin_saved_views (owner_user_id, surface);
