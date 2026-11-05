-- 074_nail_showcase_blocks.sql — customer-to-customer block list for NailShowcase social. A block hides each party from
-- the other across profiles, follower/following lists, and the following feed, and removes any follow edge between them.
-- IDs are the customers' users.id (the same identity used by nail_showcase_posts.customer_id and customer_social_profiles).
CREATE TABLE IF NOT EXISTS customer_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id UUID NOT NULL,        -- users.id of the customer doing the blocking
  blocked_user_id UUID NOT NULL,        -- users.id of the blocked customer
  tenant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_blocks_no_self CHECK (blocker_user_id <> blocked_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_blocks ON customer_blocks (blocker_user_id, blocked_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_blocks_blocked ON customer_blocks (blocked_user_id);
