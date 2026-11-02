-- 362_community_appeals.sql — the appeals trail. A tenant may appeal a decision that went against it
-- (post rejected/removed, comment removed, community access suspended, verification/severity changed).
--
-- Two spec rules are enforced in the schema:
--   * `original_decider_user_id` is recorded on the appeal, so the service can enforce "reviewed by a moderator
--     who did not make the original material decision where practical" — the separation is auditable, not just
--     a convention.
--   * An appeal is never self-resolving: `status` starts 'submitted' and only a moderator decision moves it to
--     upheld/overturned; `decided_by_user_id` and `decided_at` are only set with a decision.
CREATE TABLE IF NOT EXISTS community_appeals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                  UUID,
  comment_id               UUID,
  appellant_tenant_id      UUID NOT NULL,
  appellant_user_id        UUID NOT NULL,
  subject                  TEXT NOT NULL CHECK (subject IN (
                             'post_rejected','post_removed','comment_removed','community_suspended',
                             'verification_status','severity_change')),
  reason                   TEXT NOT NULL,
  original_decision        TEXT,                      -- what is being appealed (e.g. 'moderation.rejected')
  original_decider_user_id UUID,                      -- who made it — used to enforce reviewer separation
  status                   TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                             'submitted','under_review','upheld','overturned','withdrawn')),
  decided_by_user_id       UUID,
  decision_note            TEXT,
  moderation_case_id       UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at               TIMESTAMPTZ,
  -- a decided appeal must record who decided it
  CONSTRAINT ck_appeal_decided CHECK (
    (status IN ('upheld','overturned') AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status NOT IN ('upheld','overturned'))
  )
);
CREATE INDEX IF NOT EXISTS ix_appeal_status ON community_appeals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_appeal_post ON community_appeals (post_id);
CREATE INDEX IF NOT EXISTS ix_appeal_tenant ON community_appeals (appellant_tenant_id, created_at DESC);
