-- 752_reviews_reputation_center.sql — Reviews & Reputation Complete Build Guide (Oct 30 2026). ADDITIVE ONLY; extends the
-- canonical `reviews` table in place (no parallel review store, no second rating service):
--   reviews.moderation_version     optimistic concurrency for Hide / Unhide (two managers, one decision)
--   reviews.last_moderated_at      the "Moderation Date" date basis and the "recently moderated" sort
--   review_moderation_events       the immutable moderation trail (guide §09 / §15): review, tenant / branch, actor, previous and
--                                  new visibility, reason code + text, evidence, idempotency key. A visibility change never
--                                  deletes or edits the review text; this table can only grow (UPDATE / DELETE refused).
-- Backfill (labelled, nothing rewritten): every review that is hidden TODAY gets one 'legacy_backfill' event carrying its stored
-- hidden_reason, so the overlay shows why it is hidden instead of an empty history. The actor is unknown and stays NULL — it
-- is never guessed. Reviews never moderated get no event.
-- Rollback: DROP TABLE review_moderation_events; the two columns can be ignored (nothing reads them outside the center).

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_version integer NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS last_moderated_at  timestamptz;

CREATE TABLE IF NOT EXISTS review_moderation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  branch_id       uuid,
  review_id       uuid NOT NULL,
  actor_user_id   uuid,
  action          text NOT NULL,
  previous_hidden boolean NOT NULL,
  new_hidden      boolean NOT NULL,
  reason_code     text,
  reason_text     text,
  evidence        text,
  source          text NOT NULL DEFAULT 'pos',
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_rme_action CHECK (action IN ('hide', 'unhide', 'legacy_backfill')),
  CONSTRAINT chk_rme_source CHECK (source IN ('pos', 'legacy', 'backfill'))
);
CREATE INDEX IF NOT EXISTS ix_rme_review ON review_moderation_events (tenant_id, review_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rme_idem ON review_moderation_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION review_moderation_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'review_moderation_events is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_review_moderation_events_append_only ON review_moderation_events;
CREATE TRIGGER trg_review_moderation_events_append_only BEFORE UPDATE OR DELETE ON review_moderation_events FOR EACH ROW EXECUTE FUNCTION review_moderation_events_append_only();

-- the feed's default order (submitted desc, id desc) and the moderation-date basis
CREATE INDEX IF NOT EXISTS ix_reviews_tenant_submitted ON reviews (tenant_id, (coalesce(review_date, created_at)) DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_tenant_moderated ON reviews (tenant_id, last_moderated_at DESC) WHERE last_moderated_at IS NOT NULL;

INSERT INTO review_moderation_events (tenant_id, branch_id, review_id, actor_user_id, action, previous_hidden, new_hidden, reason_code, reason_text, source, created_at)
SELECT r.tenant_id, r.branch_id, r.id, NULL, 'legacy_backfill', false, true, 'legacy', r.hidden_reason, 'backfill', coalesce(r.updated_at, r.created_at)
FROM reviews r
WHERE r.is_hidden_by_manager
  AND NOT EXISTS (SELECT 1 FROM review_moderation_events e WHERE e.review_id = r.id AND e.tenant_id = r.tenant_id);
