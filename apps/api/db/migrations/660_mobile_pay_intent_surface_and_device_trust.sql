-- 660_mobile_pay_intent_surface_and_device_trust.sql — Owner & Manager Payment App mandate (Oct 13 2026, wave 3 / TTP).
-- §12–§14 (device trust states + user binding), §65–§66 (PaymentIntent fields + payment surface), §82 (safe card
-- metadata only), §141 (last successful payment per device), §216 (same-tenant constraints), §221 (payment_surface is an
-- ANALYTICS DIMENSION on the ONE payments row — never a second transaction).
--
--   payments.payment_surface      — 'pos' | 'clover_compact' | 'cardpointe_terminal' | 'tap_to_pay_iphone' | 'customer_display'
--                                   | 'cash' | 'manual_external' | 'online'. NULL = recorded before this column (reports treat
--                                   NULL as 'pos'). A Tap to Pay sale is ONE payments row with surface 'tap_to_pay_iphone'.
--   payments.device_id            — the registered mobile_pay_devices.device_id (TEXT, the app's install id) that captured it.
--   payments.card_brand / card_last4 — §82: brand + last four only. NO PAN, NO CVV, NO track data, NO cryptogram — ever.
--   payment_attempts.*            — the PaymentIntent fields the mandate names (§65): provider, surface, device, merchant
--                                   account, currency, checkout_version (the ticket version the amount was computed from —
--                                   §55/§155 refuses a capture when it moved), processor_ref + safe card metadata once a
--                                   result is known, resolved_at already exists (549).
--   mobile_pay_devices            — trust states gain 'compromised' and 'disabled' (§13); bound_user_id (§14: USER + TENANT +
--                                   BRANCH + DEVICE — a token copied to another phone, or another user on this phone, is
--                                   refused); revoked_at / revoked_by / revoke_reason (§138–§140); last_payment_at (§145).
--
-- EXPAND-ONLY and idempotent (IF NOT EXISTS / DROP+ADD CONSTRAINT); every new column is nullable (no table rewrite on
-- PG ≥ 11). payments is large in production: the two indexes below should be built with CREATE INDEX CONCURRENTLY first
-- (this file then finds them present).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_surface TEXT,
  ADD COLUMN IF NOT EXISTS device_id       TEXT,
  ADD COLUMN IF NOT EXISTS card_brand      TEXT,
  ADD COLUMN IF NOT EXISTS card_last4      TEXT;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_payment_surface;
ALTER TABLE payments ADD CONSTRAINT chk_payments_payment_surface
  CHECK (payment_surface IS NULL OR payment_surface IN ('pos', 'clover_compact', 'cardpointe_terminal', 'tap_to_pay_iphone', 'customer_display', 'cash', 'manual_external', 'online'));
-- §80–§82: the database itself refuses anything that is not four digits in card_last4 (a PAN can never land here).
ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payments_card_last4;
ALTER TABLE payments ADD CONSTRAINT chk_payments_card_last4 CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
CREATE INDEX IF NOT EXISTS idx_payments_surface_device ON payments (tenant_id, payment_surface, device_id) WHERE payment_surface IS NOT NULL;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS provider            TEXT,          -- 'fiserv_commercehub' | … (the TapToPayProviderPort's name)
  ADD COLUMN IF NOT EXISTS payment_surface     TEXT,
  ADD COLUMN IF NOT EXISTS device_id           TEXT,
  ADD COLUMN IF NOT EXISTS merchant_account_id UUID,          -- payment_merchant_accounts.id when a branch merchant routed it; NULL = tenant default
  ADD COLUMN IF NOT EXISTS currency            TEXT,
  ADD COLUMN IF NOT EXISTS checkout_version    TEXT,          -- §55: the ticket version (ETag) the amount was computed from
  ADD COLUMN IF NOT EXISTS processor_ref       TEXT,          -- the provider's transaction reference once known (never card data)
  ADD COLUMN IF NOT EXISTS card_brand          TEXT,
  ADD COLUMN IF NOT EXISTS card_last4          TEXT,
  ADD COLUMN IF NOT EXISTS payment_id          UUID,          -- the payments row this attempt produced (set when recorded)
  ADD COLUMN IF NOT EXISTS last_error_code     TEXT,          -- §190 error taxonomy of the last failure (never provider payloads)
  ADD COLUMN IF NOT EXISTS expires_at          TIMESTAMPTZ;   -- §132: an unused created/ready intent expires
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS chk_payment_attempts_card_last4;
ALTER TABLE payment_attempts ADD CONSTRAINT chk_payment_attempts_card_last4 CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
CREATE INDEX IF NOT EXISTS idx_payment_attempts_mobile_unresolved ON payment_attempts (tenant_id, updated_at)
  WHERE method = 'tap_to_pay' AND status IN ('authorization_pending', 'authorized', 'confirmation_pending', 'timed_out', 'unknown', 'reconciliation_required');

ALTER TABLE mobile_pay_devices
  ADD COLUMN IF NOT EXISTS bound_user_id   UUID,
  ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by      UUID,
  ADD COLUMN IF NOT EXISTS revoke_reason   TEXT,
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS risk_flags      JSONB;            -- §137: {jailbreakSuspected, attestationFailed} — signals, not the only control
ALTER TABLE mobile_pay_devices DROP CONSTRAINT IF EXISTS mobile_pay_devices_status_check;
ALTER TABLE mobile_pay_devices ADD CONSTRAINT mobile_pay_devices_status_check
  CHECK (status IN ('pending', 'active', 'revoked', 'compromised', 'disabled'));
-- §14 binding backfill (idempotent): a device registered by exactly one user is bound to that user.
UPDATE mobile_pay_devices SET bound_user_id = registered_by WHERE bound_user_id IS NULL AND registered_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mobile_pay_devices_user ON mobile_pay_devices (tenant_id, bound_user_id) WHERE bound_user_id IS NOT NULL;

-- §216: a device row can only name a branch of its own tenant (same trigger helper the branch merchant table uses).
DROP TRIGGER IF EXISTS trg_tc_mobile_pay_device_branch ON mobile_pay_devices;
CREATE TRIGGER trg_tc_mobile_pay_device_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON mobile_pay_devices
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
