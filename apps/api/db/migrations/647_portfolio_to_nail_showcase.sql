-- 647_portfolio_to_nail_showcase.sql — Technician Profile mandate §46/§47 (Oct 13 2026, wave 3 TECH)
--   "Portfolio items may optionally publish into Nail Showcase if approved."
--
-- A technician shares ONE of her approved, public, consent-cleared portfolio photos into the Nail Showcase as a post she
-- authors (post_type 'technician_portfolio'). nail_showcase_posts.customer_id is the AUTHOR's users.id (069) — for her
-- that is her salon login, so reactions / comments / isMine / moderation keep working unchanged. The salon's showcase
-- review policy (576 nail_showcase_tenant_policy) decides whether it is live at once or waits for a manager ("if approved").
--
-- Additive + idempotent; safe on a running salon: the CHECK is re-added NOT VALID (no full-table scan under lock) and
-- validated afterwards (SHARE UPDATE EXCLUSIVE only); the new column is nullable; the index is partial on a small set.
-- Production note: CREATE INDEX here may be run CONCURRENTLY outside the migration transaction on a large feed.
ALTER TABLE nail_showcase_posts DROP CONSTRAINT IF EXISTS nail_showcase_posts_post_type_check;
ALTER TABLE nail_showcase_posts ADD CONSTRAINT nail_showcase_posts_post_type_check
  CHECK (post_type IN ('verified_service', 'manual_upload', 'technician_portfolio')) NOT VALID;
ALTER TABLE nail_showcase_posts VALIDATE CONSTRAINT nail_showcase_posts_post_type_check;

ALTER TABLE nail_showcase_posts ADD COLUMN IF NOT EXISTS portfolio_photo_id UUID;
-- one LIVE (not removed) showcase post per portfolio photo — a second share is refused, a removed one may be re-shared
CREATE UNIQUE INDEX IF NOT EXISTS uq_ns_posts_portfolio_photo_live ON nail_showcase_posts (portfolio_photo_id)
  WHERE portfolio_photo_id IS NOT NULL AND deleted_at IS NULL AND status <> 'removed';
