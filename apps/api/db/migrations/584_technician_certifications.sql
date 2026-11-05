-- 584_technician_certifications.sql — technician certifications: tenant-visible AND portable (Technician Profile
-- package, their 467; mandate §41–§42, §117–§119). global_tech_profiles.certifications (390, JSONB) stays as the
-- technician-entered display list; THIS table is the verifiable record (issuer, dates, private document, status).
--
-- A certification belongs to the HUMAN (global_tech_profile_id) so it follows her between salons; the tenant that
-- verified it is recorded (tenant_id / verified_by_user_id) so a salon can trust its own verification and see the
-- document a sibling salon verified. A service may name a required certification (services.required_certification,
-- migration 583): eligibility is DENIED while the matching certification is expired or revoked.
--
-- verification_status: UNVERIFIED (technician-entered) | VERIFIED (a manager checked the document) |
--                      EXPIRED (expires_at passed — set by the reminder sweep / read-time derivation) | REVOKED.
CREATE TABLE IF NOT EXISTS technician_certifications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID,                       -- the salon it was entered/verified at (NULL = entered portably)
  global_tech_profile_id UUID,                       -- portable owner; NULL only for roster rows without a profile
  technician_id          UUID,                       -- the roster row it was entered against (convenience join)
  name                   TEXT NOT NULL,
  issuer                 TEXT,
  issued_at              DATE,
  expires_at             DATE,
  document_key           TEXT,                       -- private media key (skilldoc/… namespace) — never public
  verification_status    TEXT NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id    UUID,
  verified_at            TIMESTAMPTZ,
  revoked_reason         TEXT,
  created_by_user_id     UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tech_cert_status CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'EXPIRED', 'REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_tech_cert_profile   ON technician_certifications (global_tech_profile_id);
CREATE INDEX IF NOT EXISTS idx_tech_cert_tenant    ON technician_certifications (tenant_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_tech_cert_expires   ON technician_certifications (expires_at) WHERE expires_at IS NOT NULL;

-- Expiry reminders (30/14/7 days) — one row per (certification, days-before) so the sweep is idempotent.
CREATE TABLE IF NOT EXISTS technician_certification_reminders (
  certification_id UUID NOT NULL REFERENCES technician_certifications(id) ON DELETE CASCADE,
  days_before      INTEGER NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (certification_id, days_before)
);
