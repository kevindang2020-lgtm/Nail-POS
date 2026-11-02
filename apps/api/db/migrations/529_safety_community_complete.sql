-- 529_safety_community_complete.sql — BUILD_PLAN Phase 8 (tenant_safety_community → complete).
--
-- Migration 360 gave the Safety Community its core tables with no foreign keys, thin posts (title + body only), flat
-- comments, no moderation case flow, no settings beyond enable/approvals, and nothing for rules acknowledgment,
-- restrictions, redactions, related posts, similar experiences, post updates or evidence uploads. This adds them.
-- Design rules kept from 360: every cross-tenant row stores REDACTED content only; private incidents never join into a
-- post; visibility stays explicit; nothing here can identify a customer.
--   1. Settings: display name, how the salon appears (tenant name / display name / anonymous), branch visibility,
--      anonymous posting allowed, retention, region preferences, the risk-matching toggle (off), a version.
--   2. Rules acknowledgment per user and rules version.
--   3. Posts: incident date, scam method, channels, recommendation, tags, processor, amount range, an official
--      reference, author display mode, counters, last activity, resolution, comments lock, removal reason, full-text search.
--   4. Post updates (an author adds an update to a published advisory), threaded + versioned comments, comment
--      reports, post follows, similar experiences ("this happened to us too"), related / duplicate / merged links.
--   5. Moderation: cases carry the target tenant, kind, priority, assignee; actions carry their target; tenant / user
--      restrictions; a redaction log; evidence uploads (status, checksum, redacted copy) + an evidence access log.
--   6. Foreign keys between the community tables (NOT VALID: enforced for new rows, no scan).

-- ── 1. settings ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_community_settings
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS author_display TEXT NOT NULL DEFAULT 'display_name',      -- tenant_name | display_name | anonymous
  ADD COLUMN IF NOT EXISTS allow_anonymous BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS branch_visibility TEXT NOT NULL DEFAULT 'tenant',         -- tenant | own_branch (who in the salon sees drafts / incidents)
  ADD COLUMN IF NOT EXISTS retention_days INT NOT NULL DEFAULT 730,
  ADD COLUMN IF NOT EXISTS region_preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_matching_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE tenant_community_settings DROP CONSTRAINT IF EXISTS chk_tcs_author_display;
ALTER TABLE tenant_community_settings ADD CONSTRAINT chk_tcs_author_display CHECK (author_display IN ('tenant_name','display_name','anonymous')) NOT VALID;
ALTER TABLE tenant_community_settings DROP CONSTRAINT IF EXISTS chk_tcs_branch_visibility;
ALTER TABLE tenant_community_settings ADD CONSTRAINT chk_tcs_branch_visibility CHECK (branch_visibility IN ('tenant','own_branch')) NOT VALID;
ALTER TABLE tenant_community_settings DROP CONSTRAINT IF EXISTS chk_tcs_retention;
ALTER TABLE tenant_community_settings ADD CONSTRAINT chk_tcs_retention CHECK (retention_days BETWEEN 30 AND 3650) NOT VALID;

-- ── 2. rules acknowledgment ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_rules_acknowledgments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  rules_version   TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_rules_ack ON community_rules_acknowledgments (tenant_id, user_id, rules_version);

-- ── 3. posts ────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS incident_date DATE,
  ADD COLUMN IF NOT EXISTS scam_method TEXT,
  ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '[]'::jsonb,                -- phone | sms | email | in_person | online_booking | social | other
  ADD COLUMN IF NOT EXISTS recommendation TEXT,
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_processor TEXT,
  ADD COLUMN IF NOT EXISTS amount_range TEXT,                                           -- under_50 | 50_200 | 200_500 | 500_2000 | over_2000
  ADD COLUMN IF NOT EXISTS official_reference TEXT,                                     -- e.g. "police report filed" — redacted like the body
  ADD COLUMN IF NOT EXISTS author_display TEXT NOT NULL DEFAULT 'display_name',
  ADD COLUMN IF NOT EXISTS author_label TEXT,                                           -- the label readers see, frozen at publish
  ADD COLUMN IF NOT EXISTS comment_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS similar_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follower_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS comments_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS removed_reason TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS merged_into_post_id UUID,
  ADD COLUMN IF NOT EXISTS search_document TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(redacted_body, '') || ' ' || coalesce(scam_method, '') || ' ' || coalesce(category, ''))
  ) STORED;
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS chk_cp_author_display;
ALTER TABLE community_posts ADD CONSTRAINT chk_cp_author_display CHECK (author_display IN ('tenant_name','display_name','anonymous')) NOT VALID;
ALTER TABLE community_posts DROP CONSTRAINT IF EXISTS chk_cp_amount_range;
ALTER TABLE community_posts ADD CONSTRAINT chk_cp_amount_range CHECK (amount_range IS NULL OR amount_range IN ('under_50','50_200','200_500','500_2000','over_2000')) NOT VALID;
CREATE INDEX IF NOT EXISTS ix_cp_search ON community_posts USING GIN (search_document);
CREATE INDEX IF NOT EXISTS ix_cp_title_trgm ON community_posts USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_cp_activity ON community_posts (last_activity_at DESC) WHERE visibility = 'community_published';
CREATE INDEX IF NOT EXISTS ix_cp_origin_status ON community_posts (origin_tenant_id, status, updated_at DESC);

ALTER TABLE community_post_versions
  ADD COLUMN IF NOT EXISTS change_note TEXT,
  ADD COLUMN IF NOT EXISTS snapshot JSONB;

-- ── 4. updates, comments, follows, similar experiences, related posts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_post_updates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL,
  tenant_id          UUID NOT NULL,
  redacted_body      TEXT NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'community_published' CHECK (visibility IN ('community_published','removed')),
  created_by_user_id UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cpu_post ON community_post_updates (post_id, created_at);

ALTER TABLE community_comments
  ADD COLUMN IF NOT EXISTS parent_id UUID,
  ADD COLUMN IF NOT EXISTS depth INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_reason TEXT,
  ADD COLUMN IF NOT EXISTS removed_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS author_label TEXT,
  ADD COLUMN IF NOT EXISTS privacy_scan_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report_count INT NOT NULL DEFAULT 0;
ALTER TABLE community_comments DROP CONSTRAINT IF EXISTS chk_cc_depth;
ALTER TABLE community_comments ADD CONSTRAINT chk_cc_depth CHECK (depth BETWEEN 0 AND 3) NOT VALID;
CREATE INDEX IF NOT EXISTS ix_comment_parent ON community_comments (parent_id);

CREATE TABLE IF NOT EXISTS community_comment_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id        UUID NOT NULL,
  version           INT NOT NULL,
  redacted_body     TEXT NOT NULL,
  edited_by_user_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, version)
);

CREATE TABLE IF NOT EXISTS community_comment_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id         UUID NOT NULL,
  post_id            UUID NOT NULL,
  reporter_tenant_id UUID NOT NULL,
  reporter_user_id   UUID,
  reason             TEXT NOT NULL,
  detail             TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
  case_id            UUID,
  resolved_by_user_id UUID,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccr_once ON community_comment_reports (comment_id, reporter_tenant_id);
CREATE INDEX IF NOT EXISTS ix_ccr_status ON community_comment_reports (status, created_at);

CREATE TABLE IF NOT EXISTS community_post_follows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL,
  tenant_id  UUID NOT NULL,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpf ON community_post_follows (post_id, tenant_id, user_id);
CREATE INDEX IF NOT EXISTS ix_cpf_user ON community_post_follows (tenant_id, user_id);

ALTER TABLE community_follows
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS severity_min TEXT,
  ADD COLUMN IF NOT EXISTS channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb;   -- in_app | push | email | sms (sms: critical only)

CREATE TABLE IF NOT EXISTS community_similar_experiences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL,
  tenant_id          UUID NOT NULL,
  user_id            UUID NOT NULL,
  redacted_note      TEXT,
  occurred_on        DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cse_once ON community_similar_experiences (post_id, tenant_id);

CREATE TABLE IF NOT EXISTS community_related_posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL,
  related_post_id    UUID NOT NULL,
  relation           TEXT NOT NULL CHECK (relation IN ('related','possible_duplicate','merged_into')),
  score              NUMERIC(4,3),
  source             TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system','moderator')),
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_crp_not_self CHECK (post_id <> related_post_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crp_pair ON community_related_posts (post_id, related_post_id, relation);

-- ── 5. moderation ───────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE community_moderation_cases
  ADD COLUMN IF NOT EXISTS target_tenant_id UUID,
  ADD COLUMN IF NOT EXISTS comment_id UUID,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'post_review',   -- post_review | report | dispute | appeal | sensitive_data | evidence | comment | tenant_conduct | incident_access
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE community_moderation_cases DROP CONSTRAINT IF EXISTS chk_cmc_kind;
ALTER TABLE community_moderation_cases ADD CONSTRAINT chk_cmc_kind CHECK (kind IN ('post_review','report','dispute','appeal','sensitive_data','evidence','comment','tenant_conduct','incident_access')) NOT VALID;
ALTER TABLE community_moderation_cases DROP CONSTRAINT IF EXISTS chk_cmc_priority;
ALTER TABLE community_moderation_cases ADD CONSTRAINT chk_cmc_priority CHECK (priority IN ('low','normal','high','urgent')) NOT VALID;
CREATE INDEX IF NOT EXISTS ix_cmc_status ON community_moderation_cases (status, priority, created_at);
CREATE INDEX IF NOT EXISTS ix_cmc_post ON community_moderation_cases (post_id);
-- one OPEN case per post per kind
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmc_open_post_kind ON community_moderation_cases (post_id, kind) WHERE status IN ('open','investigating') AND post_id IS NOT NULL;

ALTER TABLE community_moderation_actions
  ADD COLUMN IF NOT EXISTS post_id UUID,
  ADD COLUMN IF NOT EXISTS comment_id UUID,
  ADD COLUMN IF NOT EXISTS target_tenant_id UUID,
  ADD COLUMN IF NOT EXISTS reason TEXT;
CREATE INDEX IF NOT EXISTS ix_cma_post ON community_moderation_actions (post_id, created_at);

CREATE TABLE IF NOT EXISTS community_restrictions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  user_id            UUID,                                   -- NULL = the whole salon
  kind               TEXT NOT NULL CHECK (kind IN ('suspended','posting_restricted','commenting_restricted')),
  reason             TEXT NOT NULL,
  case_id            UUID,
  created_by_user_id UUID NOT NULL,
  expires_at         TIMESTAMPTZ,
  lifted_at          TIMESTAMPTZ,
  lifted_by_user_id  UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cr_active ON community_restrictions (tenant_id, user_id) WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS community_redactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID,
  comment_id         UUID,
  evidence_id        UUID,
  field              TEXT NOT NULL,                          -- title | body | update | comment | evidence
  reason             TEXT NOT NULL,
  case_id            UUID,
  redacted_by_user_id UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_credact_post ON community_redactions (post_id);

ALTER TABLE community_reports
  ADD COLUMN IF NOT EXISTS reporter_user_id UUID,
  ADD COLUMN IF NOT EXISTS case_id UUID,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cr_once ON community_reports (post_id, reporter_tenant_id) WHERE status IN ('open','reviewing');

ALTER TABLE community_disputes
  ADD COLUMN IF NOT EXISTS raised_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS case_id UUID,
  ADD COLUMN IF NOT EXISTS decided_by_user_id UUID;

ALTER TABLE community_evidence
  ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'pending_upload',     -- pending_upload | uploaded | failed
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS redacted_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scan_detail TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE community_evidence DROP CONSTRAINT IF EXISTS chk_ce_upload_status;
ALTER TABLE community_evidence ADD CONSTRAINT chk_ce_upload_status CHECK (upload_status IN ('pending_upload','uploaded','failed')) NOT VALID;
ALTER TABLE community_evidence DROP CONSTRAINT IF EXISTS chk_ce_size;
ALTER TABLE community_evidence ADD CONSTRAINT chk_ce_size CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 15728640) NOT VALID;

CREATE TABLE IF NOT EXISTS community_evidence_access_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL,
  tenant_id   UUID,                                         -- the viewer's salon (NULL for a moderator)
  user_id     UUID NOT NULL,
  case_id     UUID,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ceal_evidence ON community_evidence_access_log (evidence_id, created_at);

-- ── 6. foreign keys between the community tables (NOT VALID: new rows only) ─────────────────────────────────────────
ALTER TABLE community_post_versions DROP CONSTRAINT IF EXISTS fk_cpv_post;
ALTER TABLE community_post_versions ADD CONSTRAINT fk_cpv_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_post_updates DROP CONSTRAINT IF EXISTS fk_cpu_post;
ALTER TABLE community_post_updates ADD CONSTRAINT fk_cpu_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_comments DROP CONSTRAINT IF EXISTS fk_cc_post;
ALTER TABLE community_comments ADD CONSTRAINT fk_cc_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_comments DROP CONSTRAINT IF EXISTS fk_cc_parent;
ALTER TABLE community_comments ADD CONSTRAINT fk_cc_parent FOREIGN KEY (parent_id) REFERENCES community_comments(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_comment_versions DROP CONSTRAINT IF EXISTS fk_ccv_comment;
ALTER TABLE community_comment_versions ADD CONSTRAINT fk_ccv_comment FOREIGN KEY (comment_id) REFERENCES community_comments(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_comment_reports DROP CONSTRAINT IF EXISTS fk_ccr_comment;
ALTER TABLE community_comment_reports ADD CONSTRAINT fk_ccr_comment FOREIGN KEY (comment_id) REFERENCES community_comments(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_post_follows DROP CONSTRAINT IF EXISTS fk_cpf_post;
ALTER TABLE community_post_follows ADD CONSTRAINT fk_cpf_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_similar_experiences DROP CONSTRAINT IF EXISTS fk_cse_post;
ALTER TABLE community_similar_experiences ADD CONSTRAINT fk_cse_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_related_posts DROP CONSTRAINT IF EXISTS fk_crp_post;
ALTER TABLE community_related_posts ADD CONSTRAINT fk_crp_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_related_posts DROP CONSTRAINT IF EXISTS fk_crp_related;
ALTER TABLE community_related_posts ADD CONSTRAINT fk_crp_related FOREIGN KEY (related_post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_reports DROP CONSTRAINT IF EXISTS fk_crep_post;
ALTER TABLE community_reports ADD CONSTRAINT fk_crep_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_disputes DROP CONSTRAINT IF EXISTS fk_cdisp_post;
ALTER TABLE community_disputes ADD CONSTRAINT fk_cdisp_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_evidence DROP CONSTRAINT IF EXISTS fk_cev_post;
ALTER TABLE community_evidence ADD CONSTRAINT fk_cev_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_evidence_access_log DROP CONSTRAINT IF EXISTS fk_ceal_evidence;
ALTER TABLE community_evidence_access_log ADD CONSTRAINT fk_ceal_evidence FOREIGN KEY (evidence_id) REFERENCES community_evidence(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_moderation_actions DROP CONSTRAINT IF EXISTS fk_cma_case;
ALTER TABLE community_moderation_actions ADD CONSTRAINT fk_cma_case FOREIGN KEY (case_id) REFERENCES community_moderation_cases(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE community_appeals DROP CONSTRAINT IF EXISTS fk_cappeal_case;
ALTER TABLE community_appeals ADD CONSTRAINT fk_cappeal_case FOREIGN KEY (moderation_case_id) REFERENCES community_moderation_cases(id) ON DELETE SET NULL NOT VALID;
