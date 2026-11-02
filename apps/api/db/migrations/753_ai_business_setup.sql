-- 753_ai_business_setup.sql — AI Business Setup Complete Build Guide (Oct 30 2026). ADDITIVE ONLY. Extends the existing
-- `ai_receptionist_faqs` table in place (no parallel FAQ store; hours / services / technicians stay in their canonical
-- tables and are only READ by the Business Setup center):
--   ai_receptionist_faqs.status            draft / pending_review / approved / needs_review / archived (AI_RECEPTIONIST_FAQ)
--   ai_receptionist_faqs.version           optimistic concurrency for every change
--   ai_receptionist_faqs.approved_revision_id / draft_revision_id
--                                          the LIVE approved text vs a pending edit (an edit never overwrites live text)
--   ai_receptionist_faq_revisions          append-only text history (question / answer / category per revision)
--   ai_receptionist_faq_events             append-only lifecycle / audit trail
--   ai_business_setup_preview_runs         Preview AI Knowledge history (question redacted of phones / e-mails)
-- Backfill (conservative — guide §14 "never silently auto-publish unknown content"): no code ever served these FAQs to the
-- voice agent before this release, so NOTHING is published by this migration. Each existing FAQ gets revision 1 with its
-- text; an active one becomes 'needs_review' (a manager approves it once to make it AI-servable), an inactive one becomes
-- 'archived' (restorable). is_active is kept equal to (status = 'approved') for any legacy reader.
-- Rollback: DROP the three new tables; the added columns can be ignored (only the Business Setup center reads them).

ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'draft';
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS version              integer NOT NULL DEFAULT 1;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS approved_revision_id uuid;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS draft_revision_id    uuid;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS approved_by_user_id  uuid;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS approved_at          timestamptz;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS submitted_at         timestamptz;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS archived_at          timestamptz;
ALTER TABLE ai_receptionist_faqs ADD COLUMN IF NOT EXISTS idempotency_key      text;
DO $$ BEGIN
  ALTER TABLE ai_receptionist_faqs ADD CONSTRAINT chk_air_faq_status CHECK (status IN ('draft', 'pending_review', 'approved', 'needs_review', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_air_faq_idem ON ai_receptionist_faqs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_air_faq_list ON ai_receptionist_faqs (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_air_faq_updated ON ai_receptionist_faqs (tenant_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_receptionist_faq_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  faq_id             uuid NOT NULL,
  revision_no        integer NOT NULL,
  question           text NOT NULL,
  answer             text NOT NULL,
  category           text,
  prior_revision_id  uuid,
  reason             text,
  source             text NOT NULL DEFAULT 'pos',
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_airr_source CHECK (source IN ('pos', 'legacy', 'backfill', 'assistant')),
  CONSTRAINT uq_airr_no UNIQUE (faq_id, revision_no)
);
CREATE INDEX IF NOT EXISTS ix_airr_faq ON ai_receptionist_faq_revisions (tenant_id, faq_id, revision_no DESC);

CREATE TABLE IF NOT EXISTS ai_receptionist_faq_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  branch_id       uuid,
  faq_id          uuid NOT NULL,
  action          text NOT NULL,
  from_status     text,
  to_status       text,
  revision_id     uuid,
  actor_user_id   uuid,
  reason          text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_aire_action CHECK (action IN ('created', 'edited', 'submitted', 'approved', 'rejected', 'archived', 'restored', 'legacy_backfill', 'legacy_deleted'))
);
CREATE INDEX IF NOT EXISTS ix_aire_faq ON ai_receptionist_faq_events (tenant_id, faq_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_aire_tenant ON ai_receptionist_faq_events (tenant_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aire_idem ON ai_receptionist_faq_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_business_setup_preview_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  branch_id       uuid,
  question        text NOT NULL,
  intent          text NOT NULL,
  answer          text NOT NULL,
  outcome         text NOT NULL,
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  tester_user_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_absp_outcome CHECK (outcome IN ('answered', 'not_configured', 'handoff', 'source_unavailable'))
);
CREATE INDEX IF NOT EXISTS ix_absp_tenant ON ai_business_setup_preview_runs (tenant_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION ai_business_setup_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_airr_append_only ON ai_receptionist_faq_revisions;
CREATE TRIGGER trg_airr_append_only BEFORE UPDATE OR DELETE ON ai_receptionist_faq_revisions FOR EACH ROW EXECUTE FUNCTION ai_business_setup_append_only();
DROP TRIGGER IF EXISTS trg_aire_append_only ON ai_receptionist_faq_events;
CREATE TRIGGER trg_aire_append_only BEFORE UPDATE OR DELETE ON ai_receptionist_faq_events FOR EACH ROW EXECUTE FUNCTION ai_business_setup_append_only();

-- backfill: revision 1 for every FAQ that has none (idempotent), then the conservative status
INSERT INTO ai_receptionist_faq_revisions (tenant_id, faq_id, revision_no, question, answer, category, reason, source, created_by_user_id, created_at)
SELECT f.tenant_id, f.id, 1, f.question, f.answer, f.category, 'Text as it was before the Business Setup release', 'backfill', f.created_by_user_id, f.created_at
FROM ai_receptionist_faqs f
WHERE NOT EXISTS (SELECT 1 FROM ai_receptionist_faq_revisions r WHERE r.faq_id = f.id);

UPDATE ai_receptionist_faqs f SET
  draft_revision_id = r.id,
  status = CASE WHEN f.is_active THEN 'needs_review' ELSE 'archived' END,
  archived_at = CASE WHEN f.is_active THEN NULL ELSE f.updated_at END,
  is_active = false
FROM ai_receptionist_faq_revisions r
WHERE r.faq_id = f.id AND r.revision_no = 1 AND f.approved_revision_id IS NULL AND f.draft_revision_id IS NULL;

INSERT INTO ai_receptionist_faq_events (tenant_id, branch_id, faq_id, action, from_status, to_status, revision_id, actor_user_id, reason, created_at)
SELECT f.tenant_id, f.branch_id, f.id, 'legacy_backfill', NULL, f.status, f.draft_revision_id, NULL,
       'Existing FAQ moved to the approval workflow; nothing was published automatically', now()
FROM ai_receptionist_faqs f
WHERE NOT EXISTS (SELECT 1 FROM ai_receptionist_faq_events e WHERE e.faq_id = f.id AND e.tenant_id = f.tenant_id);
