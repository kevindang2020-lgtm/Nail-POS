-- 165_before_after_sets.sql — optional before/after portfolio sets for technicians (epic Req §7).
-- Two images (before + after) of one service, with service/notes/products/duration. `customer_consent` must be true to publish;
-- public display requires is_public AND approved moderation. No customer-identifying fields are stored here. Nullable metadata; no seed.
CREATE TABLE IF NOT EXISTS before_after_sets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  tenant_id              UUID,
  branch_id              UUID,
  uploaded_by_user_id    UUID,
  before_image_url       TEXT NOT NULL,
  before_thumbnail_url   TEXT,
  after_image_url        TEXT NOT NULL,
  after_thumbnail_url    TEXT,
  service_performed      TEXT,
  design_notes           TEXT,
  products_used          TEXT,
  duration_minutes       INTEGER,
  customer_consent       BOOLEAN NOT NULL DEFAULT false,
  is_public              BOOLEAN NOT NULL DEFAULT false,
  moderation_status      TEXT NOT NULL DEFAULT 'approved',
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_before_after_profile ON before_after_sets (global_tech_profile_id, is_public);
