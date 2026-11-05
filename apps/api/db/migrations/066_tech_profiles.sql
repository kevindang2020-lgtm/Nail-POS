-- 066_tech_profiles.sql — portable technician identity + portfolio + ratings + memberships (tech-profile spec set).
-- Layered model: global profile follows the tech; memberships connect it to tenants; salon business data never moves.

CREATE TABLE IF NOT EXISTS global_tech_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  public_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  title TEXT,
  avatar_url TEXT,
  bio TEXT,
  years_experience INTEGER,
  specialties JSONB NOT NULL DEFAULT '[]',
  languages JSONB NOT NULL DEFAULT '[]',
  profile_links JSONB NOT NULL DEFAULT '{}',
  is_public BOOLEAN NOT NULL DEFAULT false,
  is_bookable BOOLEAN NOT NULL DEFAULT true,
  marketplace_discovery_enabled BOOLEAN NOT NULL DEFAULT false,
  overall_rating NUMERIC(3,2),
  rating_count INTEGER NOT NULL DEFAULT 0,
  portfolio_photo_count INTEGER NOT NULL DEFAULT 0,
  verified_completed_services_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gtp_user ON global_tech_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_gtp_public ON global_tech_profiles (is_public, marketplace_discovery_enabled);

-- One row per (profile, tenant, branch). pending row IS the join/transfer request; approval flips to active.
CREATE TABLE IF NOT EXISTS tech_salon_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  branch_id UUID,
  technician_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive','rejected','cancelled')),
  message TEXT,
  requested_by_user_id UUID,
  approved_by_user_id UUID,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (global_tech_profile_id, tenant_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_tsm_tenant_status ON tech_salon_memberships (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tsm_profile ON tech_salon_memberships (global_tech_profile_id, status);

CREATE TABLE IF NOT EXISTS tech_portfolio_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_tech_profile_id UUID NOT NULL,
  tenant_id UUID,
  branch_id UUID,
  uploaded_by_user_id UUID,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  service_category TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending','approved','hidden','rejected')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tpp_profile ON tech_portfolio_photos (global_tech_profile_id, moderation_status, is_public, sort_order);

-- Ratings: EXTEND the existing reviews table (Owner Staff Performance already reads it) — one rating system.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS technician_id UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS global_tech_profile_id UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ticket_service_line_id UUID;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_hidden_by_manager BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_technician ON reviews (technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_gtp ON reviews (global_tech_profile_id, is_public, is_hidden_by_manager);
-- one rating per customer per technician per ticket (partial: only tech-keyed rows)
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_tech_once ON reviews (tenant_id, ticket_id, technician_id, customer_id) WHERE technician_id IS NOT NULL;

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS global_tech_profile_id UUID;
CREATE INDEX IF NOT EXISTS idx_technicians_gtp ON technicians (global_tech_profile_id);
