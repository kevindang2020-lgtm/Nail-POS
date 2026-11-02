-- 734_global_rewards_redemption_payouts.sql — Global Loyalty & Rewards: Final Completion guide (30 Oct 2026) §03–§10.
-- ADDITIVE on 733 (which was never deployed: no rows exist in any environment; the vocabulary change is recorded in
-- docs/loyalty/SPEC_CONFLICT_RESOLVED.md C-1 / C-2).
--
--   reward_redemptions        cross-salon point HOLDS on a ticket: CREATED → HELD → CONFIRMED_REDEEMED | RELEASED | EXPIRED;
--                             CONFIRMED_REDEEMED → REVERSED only through a compensating event (guide §05)
--   merchant_reimbursements   what the network OWES the redeeming salon: ACCRUED_OWED → PAYOUT_ELIGIBLE → PAYOUT_PENDING →
--                             PAID | PAYOUT_FAILED | ON_HOLD; ADJUSTED / OFFSET for approved reversals (history kept)
--   payout_attempts           one row per payout instruction; SETTLED needs authentic provider settlement proof
--   reimbursement_adjustments append-only reversals / post-payout recovery (offset) claims
--   rewards_recon_runs/_findings  the daily (and manual) books check: one run per key, PASS/WARNING/FAILED/UNKNOWN findings
--   loyalty_fraud_alerts      review-first signals (never confiscate points or erase liabilities)
--   global_rewards_accounts   + explicit opt-in consent (time, source, terms version) and withdrawal
--
-- DB-level guarantee (guide §05 highlighted rule): a reimbursement can be PAID only when it references a payout attempt
-- that is SETTLED with a provider settlement reference, verified signature, a non-sandbox provider and the SAME amount.
-- A queued instruction, an admin click, a simulated event or a manual note cannot satisfy it.

-- ── point holds (reservation lifecycle) ────────────────────────────────────────────────────────────────────────
ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS reward_redemptions_status_check;
ALTER TABLE reward_redemptions ALTER COLUMN status SET DEFAULT 'HELD';
ALTER TABLE reward_redemptions ADD CONSTRAINT reward_redemptions_status_check
  CHECK (status IN ('CREATED', 'HELD', 'CONFIRMED_REDEEMED', 'RELEASED', 'EXPIRED', 'REVERSED'));
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS customer_id       UUID;          -- the redeeming salon's own customer row
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS payment_id        UUID;          -- the 'global_reward' tender row on the ticket
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS row_version       INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS confirmed_at      TIMESTAMPTZ;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS reversed_tenths   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS reversed_cents    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS currency          TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD');
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS correlation_id    TEXT;
ALTER TABLE reward_redemptions DROP CONSTRAINT IF EXISTS ck_rr_reversal_bounds;
ALTER TABLE reward_redemptions ADD CONSTRAINT ck_rr_reversal_bounds CHECK (reversed_tenths <= point_tenths AND reversed_cents <= value_cents);
DROP INDEX IF EXISTS uq_rr_ticket_live;
-- one live (held or confirmed) reward per ticket at the redeeming salon
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_ticket_live ON reward_redemptions (tenant_id, ticket_id) WHERE status IN ('CREATED', 'HELD', 'CONFIRMED_REDEEMED');
DROP INDEX IF EXISTS ix_rr_expiry;
CREATE INDEX IF NOT EXISTS ix_rr_expiry ON reward_redemptions (expires_at) WHERE status = 'HELD';
CREATE INDEX IF NOT EXISTS ix_rr_identity ON reward_redemptions (identity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_payment ON reward_redemptions (tenant_id, payment_id) WHERE payment_id IS NOT NULL;

-- ── reimbursement payables ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE merchant_reimbursements DROP CONSTRAINT IF EXISTS merchant_reimbursements_status_check;
ALTER TABLE merchant_reimbursements DROP CONSTRAINT IF EXISTS ck_mr_paid_needs_provider;
ALTER TABLE merchant_reimbursements ALTER COLUMN status SET DEFAULT 'ACCRUED_OWED';
ALTER TABLE merchant_reimbursements ADD CONSTRAINT merchant_reimbursements_status_check
  CHECK (status IN ('ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'));
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS branch_id          UUID;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS ticket_id          UUID;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD');
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS adjusted_cents     BIGINT NOT NULL DEFAULT 0 CHECK (adjusted_cents >= 0);
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS reason             TEXT;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS hold_reason        TEXT;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS eligible_at        TIMESTAMPTZ;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS payout_attempt_id  UUID;
ALTER TABLE merchant_reimbursements ADD COLUMN IF NOT EXISTS version            INTEGER NOT NULL DEFAULT 1;
ALTER TABLE merchant_reimbursements DROP CONSTRAINT IF EXISTS ck_mr_adjusted_bounds;
ALTER TABLE merchant_reimbursements ADD CONSTRAINT ck_mr_adjusted_bounds CHECK (adjusted_cents <= amount_cents);
ALTER TABLE merchant_reimbursements ADD CONSTRAINT ck_mr_paid_needs_provider
  CHECK (status <> 'PAID' OR (provider_ref IS NOT NULL AND paid_at IS NOT NULL AND payout_attempt_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS ix_mr_status_age ON merchant_reimbursements (status, created_at);

CREATE TABLE IF NOT EXISTS payout_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,                  -- the salon being paid
  reimbursement_id      UUID NOT NULL REFERENCES merchant_reimbursements (id),
  provider              TEXT NOT NULL,
  idempotency_key       TEXT NOT NULL,
  amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
  currency              TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status                TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'SUBMITTED', 'SETTLED', 'FAILED', 'UNKNOWN')),
  provider_payout_id    TEXT,
  settlement_ref        TEXT,
  settled_amount_cents  BIGINT,
  signature_verified    BOOLEAN NOT NULL DEFAULT false,
  provider_event_id     TEXT,
  failure_code          TEXT,
  settled_at            TIMESTAMPTZ,
  requested_by          UUID,
  updated_by            UUID,                          -- NULL: only the provider's verified callback moves an attempt
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT ck_pa_settled_proof CHECK (status <> 'SETTLED' OR (settlement_ref IS NOT NULL AND provider_payout_id IS NOT NULL AND settled_amount_cents = amount_cents
    AND signature_verified AND settled_at IS NOT NULL AND provider <> 'sandbox'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_provider_payout ON payout_attempts (provider, provider_payout_id) WHERE provider_payout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_provider_event ON payout_attempts (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
-- at most one live attempt per payable
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_one_live ON payout_attempts (reimbursement_id) WHERE status IN ('REQUESTED', 'SUBMITTED', 'UNKNOWN', 'SETTLED');
CREATE INDEX IF NOT EXISTS ix_pa_tenant ON payout_attempts (tenant_id, created_at DESC);

-- PAID is reachable only from a SETTLED attempt for this payable with the same amount (the CHECK above proves the proof)
CREATE OR REPLACE FUNCTION merchant_reimbursement_paid_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD;
BEGIN
  IF NEW.status = 'PAID' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PAID') THEN
    SELECT pa.status, pa.reimbursement_id, pa.settled_amount_cents INTO a FROM payout_attempts pa WHERE pa.id = NEW.payout_attempt_id;
    IF a IS NULL OR a.status <> 'SETTLED' OR a.reimbursement_id <> NEW.id OR a.settled_amount_cents <> NEW.amount_cents - NEW.adjusted_cents THEN
      RAISE EXCEPTION 'merchant_reimbursements: PAID requires a SETTLED payout attempt for this payable with the matching amount' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'PAID' AND NEW.status NOT IN ('PAID', 'OFFSET') THEN
    RAISE EXCEPTION 'merchant_reimbursements: a PAID payable is history; record an offset claim instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_mr_paid_guard ON merchant_reimbursements;
CREATE TRIGGER trg_mr_paid_guard BEFORE INSERT OR UPDATE ON merchant_reimbursements FOR EACH ROW EXECUTE FUNCTION merchant_reimbursement_paid_guard();

CREATE TABLE IF NOT EXISTS reimbursement_adjustments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  reimbursement_id  UUID NOT NULL REFERENCES merchant_reimbursements (id),
  kind              TEXT NOT NULL CHECK (kind IN ('ADJUSTMENT', 'OFFSET_CLAIM')),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  source_table      TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  reason            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_table, source_id, kind)
);
CREATE OR REPLACE FUNCTION reimbursement_adjustments_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'reimbursement_adjustments is append-only' USING ERRCODE = 'check_violation'; END $$;
DROP TRIGGER IF EXISTS trg_ra_append_only ON reimbursement_adjustments;
CREATE TRIGGER trg_ra_append_only BEFORE UPDATE OR DELETE ON reimbursement_adjustments FOR EACH ROW EXECUTE FUNCTION reimbursement_adjustments_append_only();

-- ── journal: post-payout recovery + payout settlement ──────────────────────────────────────────────────────────
ALTER TABLE rewards_journal_entries DROP CONSTRAINT IF EXISTS rewards_journal_entries_entry_type_check;
ALTER TABLE rewards_journal_entries ADD CONSTRAINT rewards_journal_entries_entry_type_check CHECK (entry_type IN ('token_purchase_funded', 'earn_allocation',
  'earn_reversal', 'redemption_committed', 'redemption_reversed', 'reimbursement_paid', 'purchase_reversed', 'reimbursement_offset'));
ALTER TABLE rewards_journal_lines DROP CONSTRAINT IF EXISTS rewards_journal_lines_account_check;
ALTER TABLE rewards_journal_lines ADD CONSTRAINT rewards_journal_lines_account_check CHECK (account IN ('settlement_cash', 'merchant_prepaid_liability',
  'rewards_liability', 'reimbursement_payable', 'funding_deficit_receivable', 'merchant_recovery_receivable'));

-- ── customer opt-in consent (guide §10) ────────────────────────────────────────────────────────────────────────
ALTER TABLE global_rewards_accounts ADD COLUMN IF NOT EXISTS opted_in_at     TIMESTAMPTZ;
ALTER TABLE global_rewards_accounts ADD COLUMN IF NOT EXISTS consent_source  TEXT;
ALTER TABLE global_rewards_accounts ADD COLUMN IF NOT EXISTS withdrawn_at    TIMESTAMPTZ;
ALTER TABLE global_rewards_accounts ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;
UPDATE global_rewards_accounts SET opted_in_at = enrolled_at, consent_source = enrolled_via WHERE opted_in_at IS NULL;

-- ── books check (guide §07) ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rewards_recon_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key         TEXT NOT NULL UNIQUE,                 -- 'daily:2026-10-30' (America/New_York cutoff) or 'manual:<uuid>'
  trigger         TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  cutoff_at       TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'PASS', 'WARNING', 'FAILED', 'UNKNOWN', 'ERROR')),
  checks_total    INTEGER NOT NULL DEFAULT 0,
  checks_failed   INTEGER NOT NULL DEFAULT 0,
  checks_warning  INTEGER NOT NULL DEFAULT 0,
  attempts        INTEGER NOT NULL DEFAULT 1,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER,
  requested_by    UUID
);
CREATE INDEX IF NOT EXISTS ix_rrr_started ON rewards_recon_runs (started_at DESC);
CREATE TABLE IF NOT EXISTS rewards_recon_findings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES rewards_recon_runs (id),
  check_type      TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('PASS', 'WARNING', 'FAILED', 'UNKNOWN')),
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  tenant_id       UUID,                                 -- NULL: platform-wide
  expected_cents  BIGINT,
  actual_cents    BIGINT,
  delta_cents     BIGINT,
  affected_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail          TEXT NOT NULL,
  recommended_action TEXT,
  review_status   TEXT NOT NULL DEFAULT 'OPEN' CHECK (review_status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED')),
  assigned_to     UUID,
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  updated_by      UUID,                                 -- NULL: written by the books-check job (no person)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rrf_run ON rewards_recon_findings (run_id);
CREATE INDEX IF NOT EXISTS ix_rrf_open ON rewards_recon_findings (review_status, severity, created_at DESC) WHERE outcome <> 'PASS';

-- ── fraud signals (guide §09) ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_fraud_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal          TEXT NOT NULL CHECK (signal IN ('concurrent_cross_salon', 'hold_churn', 'refund_cycle', 'duplicate_callback', 'payout_anomaly', 'unusual_spend')),
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  confidence      NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  dedupe_key      TEXT NOT NULL UNIQUE,
  identity_id     UUID,
  tenant_id       UUID,
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'DISMISSED', 'CONFIRMED')),
  reviewed_by     UUID,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  updated_by      UUID,                                 -- NULL: raised by a detector (no person)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lfa_open ON loyalty_fraud_alerts (status, severity, created_at DESC);
-- (tables created above on a first run; on a re-run these keep the actor stamp in place)
ALTER TABLE rewards_recon_findings ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE loyalty_fraud_alerts ADD COLUMN IF NOT EXISTS updated_by UUID;
