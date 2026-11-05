-- 073_nail_showcase_social.sql — NailShowcase Social Ranking: social customer profiles, a follow graph, and engagement
-- score snapshots layered on the EXISTING NailShowcase posts/reactions/comments (migration 069). The customer_id columns
-- are the customer's users.id — the same identity stored in nail_showcase_posts.customer_id — so a customer's score
-- aggregates across the posts they authored. Does NOT duplicate posts/reactions/comments/reports/notifications/media:
-- those already exist (069 + customer_notifications 043 + tech-profile media storage).

-- Per-customer social/public profile. Default PRIVATE (opt-in to public + rankings). One row per customer.
CREATE TABLE IF NOT EXISTS customer_social_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,                 -- users.id of the customer (matches nail_showcase_posts.customer_id)
  tenant_id UUID,
  public_display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  profile_visibility TEXT NOT NULL DEFAULT 'private' CHECK (profile_visibility IN ('public','private')),
  is_public_profile BOOLEAN NOT NULL DEFAULT false,
  show_rank_on_profile BOOLEAN NOT NULL DEFAULT true,
  show_posts_on_profile BOOLEAN NOT NULL DEFAULT true,
  allow_followers BOOLEAN NOT NULL DEFAULT true,
  is_suspended BOOLEAN NOT NULL DEFAULT false,   -- banned/suspended customers are excluded from rankings
  follower_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  nail_showcase_score INTEGER NOT NULL DEFAULT 0,
  nail_showcase_rank_all_time INTEGER,           -- last computed rank (for milestone/notification comparison); rank is also computed live
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_csp_customer ON customer_social_profiles (customer_id);
CREATE INDEX IF NOT EXISTS idx_csp_leaderboard ON customer_social_profiles (nail_showcase_score DESC) WHERE is_public_profile = true AND is_suspended = false;

-- Directed follow edges. follower/following are users.id. A customer cannot follow themselves (CHECK); duplicates blocked (unique).
CREATE TABLE IF NOT EXISTS customer_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_customer_id UUID NOT NULL,
  following_customer_id UUID NOT NULL,
  tenant_id UUID,
  branch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (follower_customer_id <> following_customer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cf_pair ON customer_follows (follower_customer_id, following_customer_id);
CREATE INDEX IF NOT EXISTS idx_cf_following ON customer_follows (following_customer_id);
CREATE INDEX IF NOT EXISTS idx_cf_follower ON customer_follows (follower_customer_id);

-- Score summary per customer × scope × period. Kept for performance/history; the live leaderboard ALSO computes rank
-- from a sorted query so ranks are never stale-locked.
CREATE TABLE IF NOT EXISTS nail_showcase_customer_score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  tenant_id UUID,
  scope TEXT NOT NULL DEFAULT 'platform',    -- platform | salon | branch | nearby
  period TEXT NOT NULL DEFAULT 'all_time',   -- all_time | weekly | monthly
  score INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nscss_scope ON nail_showcase_customer_score_snapshots (customer_id, scope, period);
CREATE INDEX IF NOT EXISTS idx_nscss_board ON nail_showcase_customer_score_snapshots (scope, period, score DESC);

-- Profile reports reuse the existing moderation table (069) — add the reported-customer target alongside post/comment.
ALTER TABLE nail_showcase_reports ADD COLUMN IF NOT EXISTS reported_customer_id UUID;
CREATE INDEX IF NOT EXISTS idx_ns_reports_customer ON nail_showcase_reports (reported_customer_id) WHERE reported_customer_id IS NOT NULL;
