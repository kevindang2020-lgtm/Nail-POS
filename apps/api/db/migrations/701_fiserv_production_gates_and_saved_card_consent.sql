-- 701_fiserv_production_gates_and_saved_card_consent.sql — Fiserv master build (Nov 4 2026) §5.4, §8D, §8E, §9.2.
--
-- EXPAND-ONLY and idempotent. Nothing is renamed, dropped or rewritten; every new column is nullable or has a constant
-- default (no table rewrite on PG >= 11). Rollback = leave the columns in place (unused) — no data depends on removal.
--
-- 1. payment_platform_validations — the platform's (AI PowerSalon as ISV) WRITTEN Fiserv integration-validation record.
--    A production merchant can only charge when the latest row for the provider + environment 'production' is
--    status 'approved' (PaymentGatewayResolver, payment-eligibility.ts). Rows are append-only: a status change is a NEW
--    row (the trigger refuses UPDATE / DELETE), so the approval history is immutable evidence.
-- 2. Merchant rows (tenant default + branch) gain the per-MID Fiserv facts the resolver now requires before a production
--    charge: boarding reference, credential verification, production enablement actor/time, surcharge enrollment.
--    DB status='active' alone no longer means "may charge live money".
-- 3. pos_payment_terminals gains the provisioned HSN and verification time (§5.4) — the terminal row must name the same
--    approved merchant + branch the charge resolves to.
-- 4. customer_payment_methods gains merchant binding, provider profile references and stored-credential consent (§8D):
--    a saved card is usable only at the merchant that verified it, and only with recorded consent.

CREATE TABLE IF NOT EXISTS payment_platform_validations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL CHECK (provider IN ('cardpointe', 'commercehub_ttp', 'clover')),
  scope_version     TEXT NOT NULL,                 -- e.g. 'bolt+iframe+surcharge v1' (what Fiserv validated)
  environment       TEXT NOT NULL CHECK (environment IN ('uat', 'production')),
  status            TEXT NOT NULL CHECK (status IN ('testing', 'submitted', 'changes_requested', 'approved', 'revoked')),
  fiserv_reference  TEXT,                          -- Fiserv's written approval / ticket reference
  evidence_ref      TEXT,                          -- where the redacted evidence pack lives (no secrets, no PAN)
  code_sha          TEXT,                          -- release commit the validation covered
  validated_at      TIMESTAMPTZ,
  approved_by       TEXT,                          -- the Fiserv contact who approved (name/email), not a platform user
  recorded_by       UUID,                          -- the Super Admin who recorded it
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_ppv_approved_has_reference CHECK (status <> 'approved' OR (fiserv_reference IS NOT NULL AND validated_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_ppv_latest ON payment_platform_validations (provider, environment, created_at DESC);

CREATE OR REPLACE FUNCTION payment_platform_validations_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_platform_validations is append-only: record a new row instead of changing or deleting one';
END $$;
DROP TRIGGER IF EXISTS trg_ppv_append_only ON payment_platform_validations;
CREATE TRIGGER trg_ppv_append_only BEFORE UPDATE OR DELETE ON payment_platform_validations
  FOR EACH ROW EXECUTE FUNCTION payment_platform_validations_append_only();

ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS fiserv_boarding_reference TEXT,
  ADD COLUMN IF NOT EXISTS credentials_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_enabled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_enabled_by     UUID,
  ADD COLUMN IF NOT EXISTS surcharge_enrolled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS surcharge_rate_bps        INT CHECK (surcharge_rate_bps IS NULL OR (surcharge_rate_bps BETWEEN 0 AND 300)),
  ADD COLUMN IF NOT EXISTS surcharge_reference       TEXT;

ALTER TABLE payment_merchant_accounts
  ADD COLUMN IF NOT EXISTS onboarding_status         TEXT NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'submitted', 'under_review', 'approved', 'declined')),
  ADD COLUMN IF NOT EXISTS fiserv_boarding_reference TEXT,
  ADD COLUMN IF NOT EXISTS credentials_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_enabled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_enabled_by     UUID,
  ADD COLUMN IF NOT EXISTS surcharge_enrolled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS surcharge_rate_bps        INT CHECK (surcharge_rate_bps IS NULL OR (surcharge_rate_bps BETWEEN 0 AND 300)),
  ADD COLUMN IF NOT EXISTS surcharge_reference       TEXT;

ALTER TABLE pos_payment_terminals
  ADD COLUMN IF NOT EXISTS provisioned_hsn  TEXT,          -- the HSN Bolt listTerminals returned (not the printed serial)
  ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ;   -- when listTerminals + connect + ping last proved this HSN

ALTER TABLE customer_payment_methods
  ADD COLUMN IF NOT EXISTS merchant_account_id  UUID,          -- branch merchant that verified the card (NULL = tenant default)
  ADD COLUMN IF NOT EXISTS merchant_id_hash     TEXT,          -- sha256 of the MID the card was verified at (binding, not the MID)
  ADD COLUMN IF NOT EXISTS provider_profile_id  TEXT,          -- CardPointe profileid (stored credential reference)
  ADD COLUMN IF NOT EXISTS provider_acct_id     TEXT,          -- CardPointe acctid
  ADD COLUMN IF NOT EXISTS token_source         TEXT,          -- 'hosted_iframe' only; legacy rows are NULL (not chargeable)
  ADD COLUMN IF NOT EXISTS verified_at          TIMESTAMPTZ,   -- when the provider accepted the token for this merchant
  ADD COLUMN IF NOT EXISTS consent_version      TEXT,
  ADD COLUMN IF NOT EXISTS consent_scope        TEXT,          -- 'cit_unscheduled' (customer-initiated, one-time)
  ADD COLUMN IF NOT EXISTS consent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at           TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cpm_tenant_customer_live ON customer_payment_methods (tenant_id, customer_id) WHERE revoked_at IS NULL;
