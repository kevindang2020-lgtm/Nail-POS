-- 364_customer_activation.sql — first-time Customer App activation (phone → OTP → link).
--
-- REUSES the existing `customer_phone_verifications` table rather than standing up a second OTP system.
-- That table was built for a POST-auth flow (an already-signed-in customer verifying their phone within one
-- salon), so it requires tenant_id + customer_id. Activation is PRE-auth: we know neither yet — and we must
-- still issue a code for an unknown number, or the endpoint becomes an account-enumeration oracle.
--
-- So: make the tenant/customer columns nullable, key the row on the normalized phone, and tag the purpose.
-- Existing rows are untouched and keep working (purpose defaults to the old behaviour).
ALTER TABLE customer_phone_verifications ALTER COLUMN tenant_id   DROP NOT NULL;
ALTER TABLE customer_phone_verifications ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE customer_phone_verifications
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'phone_verify'
    CHECK (purpose IN ('phone_verify', 'activation'));

-- The E.164 phone the code was sent to. For 'activation' this is the ONLY key we have before verification.
ALTER TABLE customer_phone_verifications
  ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

-- Rate-limit / audit context. The raw phone is already stored (we must send to it); IP + device let us throttle
-- a caller spraying codes at many numbers.
ALTER TABLE customer_phone_verifications ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE customer_phone_verifications ADD COLUMN IF NOT EXISTS device_id  TEXT;

-- Lookup path for pre-auth verification: newest live code for a phone.
CREATE INDEX IF NOT EXISTS ix_cpv_activation
  ON customer_phone_verifications (normalized_phone, created_at DESC)
  WHERE purpose = 'activation';

-- An activation row MUST carry the phone (it is the only key); a phone_verify row keeps its tenant+customer.
ALTER TABLE customer_phone_verifications
  ADD CONSTRAINT ck_cpv_keyed CHECK (
    (purpose = 'activation'   AND normalized_phone IS NOT NULL)
    OR
    (purpose = 'phone_verify' AND tenant_id IS NOT NULL AND customer_id IS NOT NULL)
  );

-- Directory lookup by phone across salons. `customers` is tenant-scoped, so one phone can legitimately appear in
-- several salons — this index makes that lookup cheap. It does NOT create a global identity: resolution of
-- multiple matches is an explicit customer choice, never a silent merge.
CREATE INDEX IF NOT EXISTS ix_customers_normalized_phone
  ON customers (normalized_phone) WHERE normalized_phone IS NOT NULL;
