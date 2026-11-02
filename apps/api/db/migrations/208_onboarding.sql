-- 172_onboarding.sql
-- Super-Admin "Onboarding & Approvals" subsystem. Adds the compliance/onboarding layer as new tables keyed to the
-- existing tenant_applications spine (extend, don't replace): a sales-approved tenant_application gains an
-- onboarding_records row, and the 14-stage workflow, approval ledger, documents, notes, and stage history hang off it.
-- The existing leads -> application -> tenant flow is untouched. All status vocabularies match apps/api/src/onboarding/
-- onboarding-core.ts exactly (the pure state machine), so KPI rollups, table badges, and reconciliation stay in lockstep.
-- Money is not modeled here; where amounts ever appear they remain integer cents elsewhere. No fabricated/demo rows.

-- One onboarding record per application. UNIQUE(application_id) enforces the 1:1 spine relationship.
CREATE TABLE IF NOT EXISTS onboarding_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id       UUID NOT NULL REFERENCES tenant_applications(id) ON DELETE CASCADE,
  application_type     TEXT NOT NULL DEFAULT 'new_tenant'
                         CHECK (application_type IN ('new_tenant','new_branch')),
  parent_tenant_id     UUID,                      -- set for new_branch applications
  tenant_id            UUID,                      -- set when activated/converted
  branch_count         INTEGER NOT NULL DEFAULT 0 CHECK (branch_count >= 0),
  current_stage        TEXT NOT NULL DEFAULT 'application_received'
                         CHECK (current_stage IN (
                           'application_received','business_info_submitted','identity_verification',
                           'legal_documents_submitted','subscription_selected','merchant_application_submitted',
                           'merchant_account_approved','bank_account_verified','hardware_assigned','data_imported',
                           'users_invited','training_completed','final_review','tenant_activated',
                           'returned_for_correction','rejected','cancelled','expired','paused','blocked')),
  resume_stage         TEXT,                      -- active stage a returned/paused/blocked record resumes to
  completion_pct       INTEGER NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  specialist_user_id   UUID,                      -- assigned onboarding specialist (NULL = unassigned)
  identity_status      TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (identity_status IN ('not_started','pending','in_progress','verified',
                           'additional_info_required','failed','expired','manually_reviewed','rejected')),
  merchant_status      TEXT NOT NULL DEFAULT 'not_submitted'
                         CHECK (merchant_status IN ('not_submitted','submitted','under_review',
                           'additional_info_required','approved','declined','expired')),
  bank_status          TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (bank_status IN ('not_started','pending','verified','failed','expired')),
  hardware_status      TEXT NOT NULL DEFAULT 'not_ordered'
                         CHECK (hardware_status IN ('not_ordered','pending','assigned','preparing','shipped',
                           'in_transit','delivered','delayed','cancelled')),
  data_import_status   TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (data_import_status IN ('not_started','uploaded','validating','in_progress',
                           'completed','completed_with_warnings','failed','returned_for_correction')),
  training_status      TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (training_status IN ('not_started','scheduled','in_progress','completed','overdue','waived')),
  users_invited        BOOLEAN NOT NULL DEFAULT false,
  missing_docs_count   INTEGER NOT NULL DEFAULT 0 CHECK (missing_docs_count >= 0),
  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  target_activation_date DATE,
  activated_at         TIMESTAMPTZ,
  activation_type      TEXT CHECK (activation_type IS NULL OR activation_type IN ('new','upgraded','reactivated')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_records_application_uq ON onboarding_records (application_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_stage     ON onboarding_records (current_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_specialist ON onboarding_records (specialist_user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_merchant  ON onboarding_records (merchant_status);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_hardware  ON onboarding_records (hardware_status);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_import    ON onboarding_records (data_import_status);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_training  ON onboarding_records (training_status);
CREATE INDEX IF NOT EXISTS idx_onboarding_records_parent    ON onboarding_records (parent_tenant_id);

-- Append-only transition log. Every stage change writes one row (with the skip set + reason + actor + audit linkage).
CREATE TABLE IF NOT EXISTS onboarding_stage_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
  from_state      TEXT,
  to_state        TEXT NOT NULL,
  skipped_stages  JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason          TEXT,
  actor_user_id   UUID,
  actor_role      TEXT,
  audit_event_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_history_record ON onboarding_stage_history (onboarding_id, created_at DESC);

-- Approval-queue + decision ledger. One row per pending/decided approval; reconciles to the Pending Approvals panel.
CREATE TABLE IF NOT EXISTS onboarding_approvals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id            UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
  approval_type            TEXT NOT NULL CHECK (approval_type IN (
                             'merchant_application','bank_verification','hardware_assignment','data_import',
                             'user_invitation','training_completion','final_review','identity_verification','step')),
  stage                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','returned','cancelled','expired')),
  decision                 TEXT,
  decided_by_user_id       UUID,
  decided_by_role          TEXT,
  decided_at               TIMESTAMPTZ,
  reason                   TEXT,
  previous_status          TEXT,
  new_status               TEXT,
  requires_second_approval BOOLEAN NOT NULL DEFAULT false,
  second_approver_user_id  UUID,
  second_approved_at       TIMESTAMPTZ,
  applicant_notified       BOOLEAN NOT NULL DEFAULT false,
  audit_event_id           UUID,
  -- A second approver must differ from the first (two-person rule), enforced at the DB level as a backstop.
  CONSTRAINT onboarding_approvals_two_person CHECK (
    second_approver_user_id IS NULL OR decided_by_user_id IS NULL OR second_approver_user_id <> decided_by_user_id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_approvals_queue  ON onboarding_approvals (status, approval_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_approvals_record ON onboarding_approvals (onboarding_id);

-- Document review records. Metadata only: storage_key is a PRIVATE object key, never a public URL. Short-lived signed
-- access is minted at read time by the service, never persisted here.
CREATE TABLE IF NOT EXISTS onboarding_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id        UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
  category             TEXT NOT NULL CHECK (category IN ('business_license','formation_document','tax_document',
                         'owner_identification','proof_of_address','bank_document','merchant_document','insurance',
                         'lease','operating_permit','other')),
  storage_key          TEXT,
  file_name            TEXT,
  content_type         TEXT,
  size_bytes           BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','under_review','approved','rejected','expired','replaced','missing')),
  reviewer_user_id     UUID,
  reviewed_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  issue_date           DATE,
  expiration_date      DATE,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  replaced_by_document_id UUID,
  virus_scan_status    TEXT NOT NULL DEFAULT 'pending'
                         CHECK (virus_scan_status IN ('pending','clean','infected','error')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_documents_record ON onboarding_documents (onboarding_id, category);
CREATE INDEX IF NOT EXISTS idx_onboarding_documents_status ON onboarding_documents (status);

-- Approval notes / review with visibility scoping. Internal/risk notes are NEVER applicant-visible unless explicitly
-- marked. The service filters by the reader's permission; the column is the source of truth for that filter.
CREATE TABLE IF NOT EXISTS onboarding_notes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id          UUID NOT NULL REFERENCES onboarding_records(id) ON DELETE CASCADE,
  author_user_id         UUID,
  author_name            TEXT,
  note_type              TEXT NOT NULL DEFAULT 'note'
                           CHECK (note_type IN ('note','request_info','rejection','return_for_correction','approval','risk')),
  body                   TEXT NOT NULL,
  stage                  TEXT,
  visibility             TEXT NOT NULL DEFAULT 'internal'
                           CHECK (visibility IN ('internal','applicant_visible','merchant_team','security_compliance')),
  attachment_document_id UUID,
  follow_up_date         DATE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_notes_record ON onboarding_notes (onboarding_id, created_at DESC);
