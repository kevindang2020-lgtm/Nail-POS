-- 417_application_intake.sql
-- "Apply for the Free AIPowerSalon POS Package" intake: extend the EXISTING tenant_applications table (no second
-- application system) with the public-form fields, consent evidence, duplicate-risk findings, review workflow fields,
-- and a public reference number. EIN is stored encrypted (AES-256-GCM via APP_DATA_ENCRYPTION_KEY) + last-4 for
-- masked display; the raw EIN is never persisted or logged. Status remains TEXT — the expanded lifecycle
-- (new/under_review/contact_attempted/contacted/info_requested/awaiting_applicant/qualified/not_qualified/approved/
-- rejected/converted_onboarding/converted_tenant/duplicate/spam/withdrawn/archived) is enforced in the service's
-- transition table, keeping compatibility with existing rows ('new' etc.) and the Onboarding & Approvals workflow.

ALTER TABLE tenant_applications
  ADD COLUMN IF NOT EXISTS reference_number        TEXT,
  ADD COLUMN IF NOT EXISTS owner_first_name        TEXT,
  ADD COLUMN IF NOT EXISTS owner_last_name         TEXT,
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS zip                     TEXT,
  ADD COLUMN IF NOT EXISTS locations_count         INT,
  ADD COLUMN IF NOT EXISTS ein_encrypted           TEXT,
  ADD COLUMN IF NOT EXISTS ein_last4               TEXT,
  ADD COLUMN IF NOT EXISTS referral_source         TEXT,
  ADD COLUMN IF NOT EXISTS card_volume_band        TEXT,
  ADD COLUMN IF NOT EXISTS best_contact_time       TEXT,
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT,
  ADD COLUMN IF NOT EXISTS applicant_message       TEXT,
  ADD COLUMN IF NOT EXISTS consent_given           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_text            TEXT,
  ADD COLUMN IF NOT EXISTS consent_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_address              TEXT,
  ADD COLUMN IF NOT EXISTS user_agent              TEXT,
  ADD COLUMN IF NOT EXISTS form_version            TEXT,
  ADD COLUMN IF NOT EXISTS utm                     JSONB,
  ADD COLUMN IF NOT EXISTS idempotency_key         TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_risk_score    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_reasons       JSONB,
  ADD COLUMN IF NOT EXISTS spam_score              INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority                TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to_user_id     UUID,
  ADD COLUMN IF NOT EXISTS follow_up_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_id           UUID,
  ADD COLUMN IF NOT EXISTS record_version          INT NOT NULL DEFAULT 1;

-- Public reference (shown to applicants) and client idempotency key (double-tap / refresh protection) are unique
-- when present. Older rows predate both, so partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_applications_reference
  ON tenant_applications (reference_number) WHERE reference_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_applications_idempotency
  ON tenant_applications (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Duplicate-signal lookups (normalized comparisons happen in the service; these support the candidate scans).
CREATE INDEX IF NOT EXISTS idx_tenant_applications_email     ON tenant_applications (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_applications_ein_last4 ON tenant_applications (ein_last4) WHERE ein_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_applications_followup  ON tenant_applications (follow_up_at) WHERE follow_up_at IS NOT NULL;
