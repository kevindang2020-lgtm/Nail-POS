-- 069_nail_showcase.sql — NailShowcase: customer nail-design social gallery (posts, photos, reactions, comments, reports).
-- Extends existing customer/tech/booking/ticket data; does not duplicate reviews, tech portfolio photos, or comments.
-- Verified posts link to a completed (paid) ticket + its service line; manual posts may require moderation.

CREATE TABLE IF NOT EXISTS nail_showcase_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,                       -- nullable: a manual platform post need not belong to a salon
  branch_id UUID,
  customer_id UUID NOT NULL,            -- the author (users.id of the customer)
  technician_id UUID,                  -- linked tech (technicians.id) when verified/attributed
  service_id UUID,
  appointment_id UUID,
  ticket_id UUID,
  ticket_service_line_id UUID,
  caption TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'salon_only'
    CHECK (visibility IN ('public_platform','salon_only','private')),
  post_type TEXT NOT NULL DEFAULT 'manual_upload'
    CHECK (post_type IN ('verified_service','manual_upload')),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('draft','pending_review','published','hidden','removed','reported')),
  is_verified_service BOOLEAN NOT NULL DEFAULT false,
  allow_comments BOOLEAN NOT NULL DEFAULT true,
  display_name TEXT,                    -- customer-selected display name (e.g. "Sophia N."); null => derive first name + last initial
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  like_count INTEGER NOT NULL DEFAULT 0,
  dislike_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ns_posts_feed ON nail_showcase_posts (tenant_id, status, visibility, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ns_posts_customer ON nail_showcase_posts (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ns_posts_technician ON nail_showcase_posts (technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ns_posts_service ON nail_showcase_posts (service_id) WHERE service_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS nail_showcase_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES nail_showcase_posts(id) ON DELETE CASCADE,
  tenant_id UUID,
  branch_id UUID,
  customer_id UUID NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ns_photos_post ON nail_showcase_photos (post_id, sort_order);

CREATE TABLE IF NOT EXISTS nail_showcase_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES nail_showcase_posts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('like','dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one reaction per (post, customer): switching like<->dislike updates the row; tapping the same removes it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ns_reaction_post_customer ON nail_showcase_reactions (post_id, customer_id);

CREATE TABLE IF NOT EXISTS nail_showcase_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES nail_showcase_posts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  parent_comment_id UUID REFERENCES nail_showcase_comments(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published','hidden','removed','reported')),
  like_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ns_comments_post ON nail_showcase_comments (post_id, status, created_at);

CREATE TABLE IF NOT EXISTS nail_showcase_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES nail_showcase_posts(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES nail_showcase_comments(id) ON DELETE CASCADE,
  tenant_id UUID,
  reported_by_customer_id UUID,
  reported_by_user_id UUID,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewed','dismissed','action_taken')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by_user_id UUID,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ns_reports_status ON nail_showcase_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ns_reports_post ON nail_showcase_reports (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ns_reports_comment ON nail_showcase_reports (comment_id) WHERE comment_id IS NOT NULL;
