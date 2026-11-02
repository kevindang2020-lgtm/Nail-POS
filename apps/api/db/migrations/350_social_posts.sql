-- 324_social_posts.sql — social content planner. Lets a salon draft, schedule, and track social posts as a
-- content calendar. This is a PLANNING/TRACKING store only — it does NOT publish to any platform (that needs a
-- connected account, which isn't wired). Marking a post "posted" is a manual status the salon sets after they
-- publish it themselves. Money-free; timestamps in UTC.
CREATE TABLE IF NOT EXISTS social_posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  platform       TEXT NOT NULL,                     -- instagram | facebook | tiktok | other
  caption        TEXT NOT NULL,
  scheduled_at   TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'draft',      -- draft | scheduled | posted | archived
  posted_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_social_posts_tenant_status ON social_posts (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_social_posts_scheduled ON social_posts (tenant_id, scheduled_at);
