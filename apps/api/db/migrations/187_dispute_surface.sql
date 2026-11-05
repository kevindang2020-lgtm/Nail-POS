-- 187_dispute_surface.sql — extends the existing webhook-populated `chargebacks` table into the full Super Admin
-- Chargebacks & Disputes surface (evidence, deadlines, outcomes, funds events, tenant notifications, merchant risk,
-- status history). Money is integer cents. Tenant-scoped throughout. Processor source data (chargeback_id, reason_code,
-- reason, amount_cents, due_by) is preserved as written by the webhook; the columns added here are the review/workflow
-- layer on top and never overwrite processor source fields.

-- Widen the status set to the full dispute lifecycle (keeping the original webhook values for back-compat).
ALTER TABLE chargebacks DROP CONSTRAINT IF EXISTS chargebacks_status_check;
ALTER TABLE chargebacks ADD CONSTRAINT chargebacks_status_check CHECK (status IN (
  'open','needs_evidence','evidence_collecting','submitted','under_review','won','lost','expired',
  'withdrawn','cancelled','reopened','escalated','closed','needs_response','refunded'));

ALTER TABLE chargebacks
  ADD COLUMN IF NOT EXISTS dispute_reference          TEXT,                         -- human-facing CHB-YYYY-###### id
  ADD COLUMN IF NOT EXISTS normalized_reason_category TEXT,                         -- internal category (raw code preserved)
  ADD COLUMN IF NOT EXISTS merchant_account_id        TEXT,                         -- processor merchant id (tenant_payment_config.merchant_id)
  ADD COLUMN IF NOT EXISTS transaction_ref            TEXT,                         -- processor-safe txn reference (never card data)
  ADD COLUMN IF NOT EXISTS evidence_status            TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (evidence_status IN ('not_requested','requested','collecting','ready_for_review','submitted','accepted','rejected','incomplete','expired')),
  ADD COLUMN IF NOT EXISTS processor_decision         TEXT NOT NULL DEFAULT 'none'
    CHECK (processor_decision IN ('none','under_review','won','lost','partially_won','reversed','expired','withdrawn','unknown')),
  ADD COLUMN IF NOT EXISTS funds_withdrawn_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS funds_recovered_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_level                 TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low','medium','high','critical','under_review')),
  ADD COLUMN IF NOT EXISTS notes                      TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decided_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at                  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chargebacks_dispute_ref ON chargebacks (dispute_reference) WHERE dispute_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_evidence_status ON chargebacks (evidence_status);
CREATE INDEX IF NOT EXISTS idx_chargebacks_processor_decision ON chargebacks (processor_decision);
CREATE INDEX IF NOT EXISTS idx_chargebacks_risk_level ON chargebacks (risk_level);
CREATE INDEX IF NOT EXISTS idx_chargebacks_reason_code ON chargebacks (reason_code);
CREATE INDEX IF NOT EXISTS idx_chargebacks_due_by ON chargebacks (due_by);

-- Immutable status-transition history (append-only).
CREATE TABLE IF NOT EXISTS dispute_status_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'super_admin',   -- super_admin | processor_webhook | job
  reason        TEXT,
  actor_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispute_status_events_cb ON dispute_status_events (chargeback_id, created_at DESC);

-- Evidence records. Files live in secure object storage; only a storage reference + hash + scan status is stored here.
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id    UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  evidence_type    TEXT NOT NULL,
  file_name        TEXT,
  storage_ref      TEXT,                 -- secure object-storage key (never a public URL)
  mime_type        TEXT,
  size_bytes       BIGINT,
  file_hash        TEXT,                 -- sha-256, used for duplicate detection
  scan_status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending','clean','infected','failed')),
  review_status    TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (review_status IN ('uploaded','accepted','rejected','incomplete')),
  included_in_submission BOOLEAN NOT NULL DEFAULT false,
  description      TEXT,
  source           TEXT,
  uploaded_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_evidence_hash ON dispute_evidence (chargeback_id, file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_cb ON dispute_evidence (chargeback_id);

-- Processor evidence submissions (idempotent; immutable manifest of what was sent).
CREATE TABLE IF NOT EXISTS dispute_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id     UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  idempotency_key   TEXT NOT NULL,
  processor_type    TEXT,
  processor_ref     TEXT,
  manifest_json     JSONB,               -- evidence ids + hashes included (immutable record)
  result            TEXT NOT NULL DEFAULT 'accepted'
    CHECK (result IN ('accepted','rejected','pending','error')),
  safe_error        TEXT,
  submitted_by      UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_submissions_idem ON dispute_submissions (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_cb ON dispute_submissions (chargeback_id, created_at DESC);

-- Outcomes preserve the authoritative processor result (append-only; original processor state is never mutated).
CREATE TABLE IF NOT EXISTS dispute_outcomes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id          UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id              UUID NOT NULL,
  result                 TEXT NOT NULL
    CHECK (result IN ('won','lost','partially_won','withdrawn','reversed','expired','cancelled','reopened')),
  amount_won_cents       BIGINT NOT NULL DEFAULT 0,
  amount_lost_cents      BIGINT NOT NULL DEFAULT 0,
  funds_recovered_cents  BIGINT NOT NULL DEFAULT 0,
  processor_fee_cents    BIGINT NOT NULL DEFAULT 0,
  decision_reason        TEXT,
  is_manual_override     BOOLEAN NOT NULL DEFAULT false,
  override_reason        TEXT,
  original_processor_decision TEXT,       -- snapshot of the processor's authoritative state at record time
  recorded_by            UUID,
  decided_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispute_outcomes_cb ON dispute_outcomes (chargeback_id, created_at DESC);

-- Funds movement (withdrawn / provisional credit / recovered), linkable to settlements & deposits.
CREATE TABLE IF NOT EXISTS dispute_funds_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id      UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL,
  kind               TEXT NOT NULL
    CHECK (kind IN ('withdrawn','provisional_credit','recovered','fee','reversal')),
  amount_cents       BIGINT NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  settlement_id      UUID,                -- optional link to payment_settlements
  effective_at       TIMESTAMPTZ,
  source             TEXT NOT NULL DEFAULT 'processor_webhook',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispute_funds_cb ON dispute_funds_events (chargeback_id, created_at DESC);

-- Recorded tenant notifications about a dispute (delivery result preserved; never contains card data).
CREATE TABLE IF NOT EXISTS dispute_tenant_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id    UUID NOT NULL REFERENCES chargebacks (id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  channel          TEXT NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app','email','sms')),
  recipient        TEXT,
  subject          TEXT,
  body             TEXT,
  delivery_status  TEXT NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('sent','delivered','failed','acknowledged')),
  idempotency_key  TEXT,
  sent_by          UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_notif_idem ON dispute_tenant_notifications (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispute_notif_cb ON dispute_tenant_notifications (chargeback_id, created_at DESC);

-- Merchant (tenant) risk reviews for the High-Risk Merchants module.
CREATE TABLE IF NOT EXISTS merchant_risk_reviews (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  merchant_account_id TEXT,
  risk_level         TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low','medium','high','critical','under_review')),
  risk_reason        TEXT,
  supporting_metrics JSONB,
  recommended_action TEXT,
  reviewer_user_id   UUID,
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_review_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchant_risk_tenant ON merchant_risk_reviews (tenant_id, reviewed_at DESC);
