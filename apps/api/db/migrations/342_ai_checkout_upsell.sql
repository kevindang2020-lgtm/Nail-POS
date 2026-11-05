-- 321_ai_checkout_upsell.sql — settings + durable idempotency for the AI Checkout Upsell Assistant.
-- Additive; disabling the assistant never touches checkout/payments/inventory/membership/loyalty/gift-cards/booking.

-- Per-scope settings (§70): one row per (tenant, level, scope target). enabled is tri-state (NULL = inherit); FALSE at
-- any level disables the assistant for that scope. tunables (fatigue caps, category toggles, safety limits) as JSONB.
CREATE TABLE IF NOT EXISTS ai_checkout_upsell_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  level              TEXT NOT NULL CHECK (level IN ('tenant','branch','device','user')),
  branch_id          UUID,
  device_id          UUID,
  user_id            UUID,
  enabled            BOOLEAN,
  tunables           JSONB,
  updated_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_checkout_upsell_settings_scope
  ON ai_checkout_upsell_settings (tenant_id, level,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(user_id,   '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS ai_checkout_upsell_settings_tenant ON ai_checkout_upsell_settings (tenant_id);

-- Durable idempotency (§46/§47): the UNIQUE key is the uniqueness boundary. A charge-producing action reserves the key
-- (status 'pending'), then commits ('done', result) or releases on pre-commit failure (row deleted). A duplicate insert
-- collides on the unique index → the caller reads the existing row and returns the original result (or reports conflict
-- when the payload hash differs). This survives double-clicks, worker redelivery, and multi-instance retries.
CREATE TABLE IF NOT EXISTS ai_checkout_upsell_idempotency (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID NOT NULL,
  checkout_id    UUID NOT NULL,
  operation      TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  idem_key       TEXT NOT NULL,
  payload_hash   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  result         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_checkout_upsell_idem_key
  ON ai_checkout_upsell_idempotency (tenant_id, branch_id, checkout_id, operation, target_id, idem_key);

-- Recommendation records (§44) — advisory metadata, NEVER an authoritative financial record. Statuses track the lifecycle.
CREATE TABLE IF NOT EXISTS ai_checkout_upsell_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  checkout_id     UUID NOT NULL,
  customer_id     UUID,
  type            TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  price_cents     BIGINT,
  status          TEXT NOT NULL DEFAULT 'GENERATED'
    CHECK (status IN ('GENERATED','DISPLAYED','ACCEPTED','DISMISSED','EXPIRED','INELIGIBLE','OUT_OF_STOCK','APPLIED','FAILED')),
  context_fingerprint TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  accepted_by_user_id UUID,
  result_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_checkout_upsell_recs_checkout ON ai_checkout_upsell_recommendations (tenant_id, checkout_id, status);
CREATE INDEX IF NOT EXISTS ai_checkout_upsell_recs_type ON ai_checkout_upsell_recommendations (tenant_id, type, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_checkout_upsell_recs_dedupe ON ai_checkout_upsell_recommendations (tenant_id, checkout_id, target_id, context_fingerprint);

-- Dismissals (§52) — tenant/branch/user scoped; suppresses a target for the rest of the checkout.
CREATE TABLE IF NOT EXISTS ai_checkout_upsell_dismissals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL, branch_id UUID NOT NULL, checkout_id UUID NOT NULL,
  target_id    TEXT NOT NULL, reason TEXT, user_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_checkout_upsell_dismissals_uniq ON ai_checkout_upsell_dismissals (tenant_id, checkout_id, target_id);

-- Feedback (§53) — version-aware staff feedback; never rewrites production rules automatically.
CREATE TABLE IF NOT EXISTS ai_checkout_upsell_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL, branch_id UUID NOT NULL, checkout_id UUID NOT NULL,
  recommendation_id TEXT NOT NULL, rating TEXT NOT NULL, reason TEXT, user_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_checkout_upsell_feedback_tenant ON ai_checkout_upsell_feedback (tenant_id, created_at);
