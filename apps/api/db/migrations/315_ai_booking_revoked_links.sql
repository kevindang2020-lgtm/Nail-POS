-- 315_ai_booking_revoked_links.sql — targeted revocation for signed online/partner booking links (§32 "Revocable").
-- A minted link carries a unique jti in its signed payload; revoking inserts that jti here, and the public verify path
-- rejects it thereafter — without rotating the shared secret (which would invalidate every outstanding link). Tenant-
-- scoped; a link is identified by (tenant_id, jti).
CREATE TABLE IF NOT EXISTS ai_booking_revoked_links (
  tenant_id   UUID NOT NULL,
  jti         TEXT NOT NULL,
  reason      TEXT,
  revoked_by  TEXT,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, jti)
);
