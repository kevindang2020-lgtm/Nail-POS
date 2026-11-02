-- 131_video_tutorials.sql
-- Help Center video library (spec §17–18, §36). Videos are PLATFORM-GLOBAL learning content gated by the same
-- role applicability as articles; they reuse the help_categories taxonomy. Per-viewer resume position is
-- tenant/user scoped (spec §18: resume watching) and never crosses tenants. No rows are seeded: the Video
-- Tutorials grid shows an honest empty state until videos are published, rather than fake thumbnails.

CREATE TABLE IF NOT EXISTS video_tutorials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      UUID REFERENCES help_categories(id),
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  description      TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  thumbnail_url    TEXT,
  video_url        TEXT,
  captions_url     TEXT,
  transcript       TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','in_review','published','scheduled','archived')),
  roles            TEXT[] NOT NULL DEFAULT '{}',   -- empty = visible to all roles
  view_count       BIGINT  NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_tutorials_status_views ON video_tutorials (status, view_count DESC);
CREATE INDEX IF NOT EXISTS idx_video_tutorials_category ON video_tutorials (category_id);

-- Resume-watching position, one row per (video, tenant, user); a re-watch upserts.
CREATE TABLE IF NOT EXISTS video_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id         UUID NOT NULL REFERENCES video_tutorials(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  user_id          UUID NOT NULL,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  completed        BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, tenant_id, user_id)
);
