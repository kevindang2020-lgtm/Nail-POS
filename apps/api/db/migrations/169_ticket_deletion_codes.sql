-- 169_ticket_deletion_codes.sql — per-ticket six-digit Deletion Authorization Code (encrypted at rest) + controlled
-- LOGICAL removal (epic Req §10). The code is stored only as ciphertext (code_enc); plaintext is never persisted and only
-- returned via the reveal-gated, audited endpoint. Removal is logical: removed_at/by/reason are stamped on the ticket but
-- NO financial/payment/payroll/tax/commission/audit rows are ever destroyed — the ticket stays in the DB and searchable.
CREATE TABLE IF NOT EXISTS ticket_deletion_codes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id            UUID NOT NULL UNIQUE,
  tenant_id            UUID,
  code_enc             TEXT NOT NULL,            -- AES-256-GCM, format v1:<iv>:<tag>:<ct>; never plaintext
  generated_by_user_id UUID,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at          TIMESTAMPTZ,
  revealed_by_user_id  UUID,
  reveal_count         INTEGER NOT NULL DEFAULT 0,
  used_at              TIMESTAMPTZ,              -- set when the code is consumed by a removal
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS removed_at         TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS removed_by_user_id UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS removal_reason     TEXT;
