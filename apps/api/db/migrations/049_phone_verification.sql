-- 049_phone_verification.sql — signup phone verification (soft confirm). The account is active immediately; verifying
-- the phone just stamps customers.phone_verified_at. Codes are scrypt-hashed (same util as passwords), single-use, and
-- expire. SMS delivery depends on the salon's configured provider (TWILIO_* env) — the mechanism here is provider-agnostic.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_phone_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  customer_id  UUID NOT NULL,
  destination  TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_verif_customer ON customer_phone_verifications (tenant_id, customer_id, created_at);
