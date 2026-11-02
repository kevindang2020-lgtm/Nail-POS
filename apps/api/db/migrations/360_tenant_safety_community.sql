-- 360_tenant_safety_community.sql — the AI PowerSalon Safety Community data model. Design rules baked into the
-- schema so the safety guarantees hold at the storage layer, not just in code:
--   * EVERY shareable record has an EXPLICIT `visibility` column (never inferred). A private incident is
--     stored visibility='tenant_private'; it can only become community-visible by an authorized user creating
--     a SEPARATE advisory row (community_posts) — there is no column that flips a private incident public.
--   * Raw incident detail (which may reference a customer) lives ONLY in tenant_private_incidents, which is
--     tenant-scoped and never joined into community_posts. community_posts stores REDACTED content only.
--   * classification / visibility / status / severity are CHECK-constrained to the workflow's legal values.
--   * Money (if any) is integer cents. All rows are tenant-scoped; branch_id is nullable (tenant-wide).

-- ── Per-tenant settings: enable the community + role capability overrides (safety floor enforced in code) ──
CREATE TABLE IF NOT EXISTS tenant_community_settings (
  tenant_id                    UUID PRIMARY KEY,
  enabled                      BOOLEAN NOT NULL DEFAULT false,
  receptionist_approval_required BOOLEAN NOT NULL DEFAULT true,
  manager_approval_required    BOOLEAN NOT NULL DEFAULT true,
  role_grants                  JSONB NOT NULL DEFAULT '{}'::jsonb,   -- role -> [capability]; capped by the code-level floor
  role_removals                JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_categories            JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by_user_id           UUID,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Private incidents: tenant-scoped, NEVER cross-tenant. May contain the raw (customer-referencing) detail. ──
CREATE TABLE IF NOT EXISTS tenant_private_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  visibility       TEXT NOT NULL DEFAULT 'tenant_private' CHECK (visibility = 'tenant_private'),  -- immutable
  category         TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('informational','low','moderate','high','critical')),
  occurred_on      DATE,
  raw_detail       TEXT,                       -- private; may reference a customer. Never leaves the tenant.
  customer_ref     UUID,                       -- optional internal link; never exposed to the community
  advisory_post_id UUID,                       -- set if the tenant later published a SANITIZED advisory from this
  created_by_user_id UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_priv_incident_tenant ON tenant_private_incidents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_priv_incident_branch ON tenant_private_incidents (tenant_id, branch_id);

-- ── Community advisories: the ONLY cross-tenant surface. Stores redacted content + an explicit visibility. ──
CREATE TABLE IF NOT EXISTS community_posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_tenant_id   UUID NOT NULL,            -- author tenant (may be hidden from viewers per policy)
  origin_branch_id   UUID,
  classification     TEXT NOT NULL DEFAULT 'community_advisory' CHECK (classification = 'community_advisory'),
  visibility         TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft','community_published','removed')),
  status             TEXT NOT NULL DEFAULT 'incident_draft' CHECK (status IN (
                       'incident_draft','tenant_review','privacy_scan','manager_approval','moderation_review',
                       'published_unverified','published_evidence_reviewed','published_multiple_reports','published_official_report',
                       'returned_for_correction','sensitive_data_detected','insufficient_information','evidence_requested',
                       'rejected','disputed','corrected','resolved','removed','archived')),
  category           TEXT NOT NULL,
  severity           TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('informational','low','moderate','high','critical')),
  region             TEXT,                     -- coarse region for scoping; never a precise address
  title              TEXT NOT NULL,
  redacted_body      TEXT NOT NULL,            -- privacy-scanned, redacted content ONLY (no raw customer PII)
  privacy_scan_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  moderation_required BOOLEAN NOT NULL DEFAULT false,
  verification_label TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_label IN ('unverified','evidence_reviewed','multiple_reports','official_report')),
  version            INTEGER NOT NULL DEFAULT 1,
  published_at       TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL,
  approved_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_published_visibility CHECK (
    (status LIKE 'published_%' AND visibility = 'community_published')
    OR (status NOT LIKE 'published_%')
  )
);
CREATE INDEX IF NOT EXISTS ix_cp_visibility_status ON community_posts (visibility, status);
CREATE INDEX IF NOT EXISTS ix_cp_category ON community_posts (category, severity);
CREATE INDEX IF NOT EXISTS ix_cp_region ON community_posts (region);
CREATE INDEX IF NOT EXISTS ix_cp_origin ON community_posts (origin_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_cp_published ON community_posts (published_at DESC) WHERE visibility = 'community_published';

-- ── Version history (edits are tracked; published edits keep provenance) ──
CREATE TABLE IF NOT EXISTS community_post_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          UUID NOT NULL,
  version          INTEGER NOT NULL,
  title            TEXT,
  redacted_body    TEXT,
  status           TEXT,
  edited_by_user_id UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, version)
);

-- ── Comments (also privacy-scanned; tenant-attributed, never customer-identifying) ──
CREATE TABLE IF NOT EXISTS community_comments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          UUID NOT NULL,
  tenant_id        UUID NOT NULL,
  visibility       TEXT NOT NULL DEFAULT 'community_published' CHECK (visibility IN ('community_published','removed')),
  redacted_body    TEXT NOT NULL,
  created_by_user_id UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_comment_post ON community_comments (post_id, created_at);

-- ── Follows: a tenant follows categories/regions for alerts (via existing notifications) ──
CREATE TABLE IF NOT EXISTS community_follows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  category   TEXT,
  region     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category, region)
);

-- ── Abuse reports on a post (any tenant can report; feeds moderation) ──
CREATE TABLE IF NOT EXISTS community_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL,
  reporter_tenant_id UUID NOT NULL,
  reason             TEXT NOT NULL,
  detail             TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_post ON community_reports (post_id);
CREATE INDEX IF NOT EXISTS ix_report_status ON community_reports (status);

-- ── Disputes / appeals (a named subject or a tenant disputes a post) ──
CREATE TABLE IF NOT EXISTS community_disputes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID NOT NULL,
  raised_by_tenant_id UUID,
  raised_by_kind     TEXT NOT NULL DEFAULT 'tenant' CHECK (raised_by_kind IN ('tenant','subject','moderator')),
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','upheld','overturned','withdrawn')),
  resolution_note    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_dispute_post ON community_disputes (post_id, status);

-- ── Moderation cases + actions (Super-Admin). A case is the ONLY key under which a moderator may access a
--    private incident cross-tenant; every action is audited via the platform audit_logs table. ──
CREATE TABLE IF NOT EXISTS community_moderation_cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID,
  incident_id    UUID,                          -- set only when a moderator must review a private incident
  opened_by_user_id UUID NOT NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS community_moderation_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL,
  action      TEXT NOT NULL,                    -- publish|reject|remove|request_evidence|edit_wording|escalate
  actor_user_id UUID NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mod_action_case ON community_moderation_actions (case_id, created_at);

-- ── Evidence (metadata only; bytes live in blob storage; access is via short-lived signed URLs + scan) ──
CREATE TABLE IF NOT EXISTS community_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID,
  incident_id   UUID,
  tenant_id     UUID NOT NULL,
  storage_key   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  scan_status   TEXT NOT NULL DEFAULT 'unscanned' CHECK (scan_status IN ('unscanned','clean','infected','error')),
  redaction_status TEXT NOT NULL DEFAULT 'pending' CHECK (redaction_status IN ('pending','redacted','not_required')),
  uploaded_by_user_id UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evidence_post ON community_evidence (post_id);

-- ── Feature-flagged, DISABLED by default: privacy-safe risk fingerprints for "possible related reports".
--    Stores ONLY salted one-way fingerprints of coarse indicators — never a customer identity, name, phone,
--    email, or the reporting tenant. Surfacing requires >=2 reliable indicators (enforced in code). ──
CREATE TABLE IF NOT EXISTS community_risk_fingerprints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL,
  indicator_kind TEXT NOT NULL,                 -- e.g. behavior_pattern | coarse_region | method (never PII)
  fingerprint   TEXT NOT NULL,                  -- salted one-way hash; not reversible to any identity
  reliability   TEXT NOT NULL DEFAULT 'weak' CHECK (reliability IN ('weak','reliable')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fingerprint_lookup ON community_risk_fingerprints (indicator_kind, fingerprint);
