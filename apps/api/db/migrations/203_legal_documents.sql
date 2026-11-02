-- 174_legal_documents.sql
-- Versioned legal documents (Terms, Privacy, Cookie, etc.) + acceptance records for General Settings.
-- Published versions are immutable (editing creates a new draft); acceptance records are tied to the EXACT version
-- accepted and are never rewritten when a new version publishes.

CREATE TABLE IF NOT EXISTS legal_document_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type            text NOT NULL,          -- terms_of_service|privacy_policy|cookie_policy|acceptable_use|data_processing_addendum|merchant_terms|ai_disclosure
  version             text NOT NULL,          -- e.g. v2.3.0
  title               text NOT NULL,
  content             text NOT NULL DEFAULT '',
  summary             text,
  status              text NOT NULL DEFAULT 'draft',  -- draft|under_review|approved|scheduled|published|superseded|retired|archived
  required_acceptance boolean NOT NULL DEFAULT true,
  effective_date      timestamptz,
  published_at        timestamptz,
  published_by        text,
  created_by          text,
  superseded_by       uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ldv_type ON legal_document_versions (doc_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ldv_status ON legal_document_versions (doc_type, status);
-- At most one published version per document type (the current authoritative one).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ldv_published ON legal_document_versions (doc_type) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ldv_type_version ON legal_document_versions (doc_type, version);

CREATE TABLE IF NOT EXISTS legal_document_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type     text NOT NULL,
  version_id   uuid NOT NULL,
  version      text NOT NULL,
  subject_type text NOT NULL DEFAULT 'tenant',  -- tenant|user
  subject_id   text NOT NULL,
  decision     text NOT NULL DEFAULT 'accepted', -- accepted|declined
  accepted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lda_version ON legal_document_acceptances (version_id);
CREATE INDEX IF NOT EXISTS idx_lda_type_subject ON legal_document_acceptances (doc_type, subject_id);
