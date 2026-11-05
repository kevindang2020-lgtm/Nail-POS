-- 132_help_article_engagement.sql
-- Article engagement writes (spec §16 feedback, §41 duplicate protection). A "view" is deduped per
-- (article, tenant, user, day) so a refresh or re-open the same day never re-increments view_count — the
-- dedupe table is the idempotency key. "Was this helpful" is one vote per (article, tenant, user); a re-vote
-- upserts in place rather than stacking duplicates. Both are tenant/user scoped and never cross tenants.

CREATE TABLE IF NOT EXISTS help_article_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES help_articles(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  viewed_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, tenant_id, user_id, viewed_on)
);
CREATE INDEX IF NOT EXISTS idx_help_article_views_article ON help_article_views (article_id);

-- One helpful/not-helpful vote per reader; added now that the feedback write path exists (enables upsert).
CREATE UNIQUE INDEX IF NOT EXISTS uq_help_feedback_voter ON help_article_feedback (article_id, tenant_id, user_id);
