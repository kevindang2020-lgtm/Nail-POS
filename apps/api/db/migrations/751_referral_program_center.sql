-- 751_referral_program_center.sql — Referral Program Complete Build Guide (Oct 30 2026). ADDITIVE ONLY; extends the canonical
-- tables in place (no parallel referral or reward ledger):
--   customer_referrals (046)      the ONE code per customer (Customer App issues it) — gains a status (active / disabled), an
--                                 optional expiry and a row_version. The existing codes stay exactly as they are (T01).
--   referral_redemptions (349)    the ONE referral record per referred customer (UNIQUE (tenant, referred) already) — gains the
--                                 guide's canonical STATE (RECORDED … REWARD_ISSUED / REJECTED / EXPIRED / CANCELLED / REVERSED /
--                                 UNDER_REVIEW), the qualifying ticket, policy version, recorder, fraud flags and a row_version.
--                                 The legacy `status` / `reward_cents` (pending / rewarded / void) are kept untouched as history.
--   referral_program_settings     the salon's reward policy. Reward type / value are NULL until the owner sets them: nothing is
--                                 invented, and with no policy a qualified referral simply waits (PENDING_OWNER_APPROVAL).
--   referral_rewards              the reward OBLIGATION + its issuance: ONE per referral (UNIQUE (tenant, referral_id)),
--                                 APPROVED ≠ ISSUED ≠ paid cash. Loyalty points post through the existing tenant loyalty ledger
--                                 (applyLoyaltyEntry, source ('referral_rewards', id) — at most once per entry type).
--   referral_events               the append-only transition / audit trail (actor, reason, source event, idempotency key).
-- Backfill (no re-issue, nothing deleted): legacy pending → PENDING_QUALIFICATION; legacy void → CANCELLED; legacy "rewarded"
-- (a hand-typed dollar amount with no issuance record) → UNDER_REVIEW with the typed amount kept in legacy_marked_reward_cents
-- — it is NOT counted as an issued reward or a paid payout.
-- Rollback: the new tables can be dropped and the new columns ignored; nothing existing was rewritten except the backfilled state.

-- ── codes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'active';
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS expires_at      timestamptz;
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS disabled_at     timestamptz;
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS disabled_reason text;
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS row_version     integer NOT NULL DEFAULT 1;
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS updated_at      timestamptz;
ALTER TABLE customer_referrals ADD COLUMN IF NOT EXISTS updated_by      uuid;
ALTER TABLE customer_referrals DROP CONSTRAINT IF EXISTS chk_customer_referrals_status;
ALTER TABLE customer_referrals ADD CONSTRAINT chk_customer_referrals_status CHECK (status IN ('active', 'disabled'));
CREATE INDEX IF NOT EXISTS ix_customer_referrals_tenant_created ON customer_referrals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_customer_referrals_tenant_code_lower ON customer_referrals (tenant_id, lower(code));

-- ── referrals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS state                     text;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS branch_id                 uuid;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS code_id                   uuid;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS policy_version            integer;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS recorded_by               uuid;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS qualifying_ticket_id      uuid;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS qualified_at              timestamptz;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS decided_at                timestamptz;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS review_reason             text;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS fraud_flags               jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS legacy_marked_reward_cents bigint;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS row_version               integer NOT NULL DEFAULT 1;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS updated_at                timestamptz;
ALTER TABLE referral_redemptions ADD COLUMN IF NOT EXISTS updated_by                uuid;

UPDATE referral_redemptions rr SET
  state = CASE rr.status WHEN 'rewarded' THEN 'UNDER_REVIEW' WHEN 'void' THEN 'CANCELLED' ELSE 'PENDING_QUALIFICATION' END,
  legacy_marked_reward_cents = CASE WHEN rr.status = 'rewarded' THEN rr.reward_cents END,
  review_reason = CASE WHEN rr.status = 'rewarded' THEN 'Legacy: marked rewarded by hand with no issuance record — review before any reward is issued.' END
WHERE rr.state IS NULL;
UPDATE referral_redemptions rr SET code_id = cr.id FROM customer_referrals cr
 WHERE rr.code_id IS NULL AND cr.tenant_id = rr.tenant_id AND lower(cr.code) = lower(rr.code);

ALTER TABLE referral_redemptions ALTER COLUMN state SET DEFAULT 'PENDING_QUALIFICATION';
ALTER TABLE referral_redemptions ALTER COLUMN state SET NOT NULL;
ALTER TABLE referral_redemptions DROP CONSTRAINT IF EXISTS chk_referral_redemptions_state;
ALTER TABLE referral_redemptions ADD CONSTRAINT chk_referral_redemptions_state CHECK (state IN ('RECORDED', 'PENDING_QUALIFICATION', 'QUALIFIED',
  'REWARD_PENDING_APPROVAL', 'APPROVED', 'REWARD_ISSUED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'UNDER_REVIEW'));
CREATE INDEX IF NOT EXISTS ix_referral_redemptions_tenant_created ON referral_redemptions (tenant_id, redeemed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_referral_redemptions_tenant_state ON referral_redemptions (tenant_id, state, redeemed_at);
CREATE INDEX IF NOT EXISTS ix_referral_redemptions_tenant_ticket ON referral_redemptions (tenant_id, qualifying_ticket_id) WHERE qualifying_ticket_id IS NOT NULL;

-- ── policy ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_program_settings (
  tenant_id                  uuid PRIMARY KEY,
  enabled                    boolean NOT NULL DEFAULT true,
  reward_type                text,
  reward_points              integer,
  reward_cents               bigint,
  requires_approval          boolean NOT NULL DEFAULT true,
  separation_of_duties       boolean NOT NULL DEFAULT false,
  min_qualifying_spend_cents bigint NOT NULL DEFAULT 0,
  qualification_window_days  integer,
  record_grace_hours         integer NOT NULL DEFAULT 24,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid,
  CONSTRAINT chk_rps_reward_type CHECK (reward_type IS NULL OR reward_type IN ('loyalty_points', 'cash_payout')),
  CONSTRAINT chk_rps_points CHECK (reward_points IS NULL OR reward_points > 0),
  CONSTRAINT chk_rps_cents CHECK (reward_cents IS NULL OR reward_cents > 0),
  CONSTRAINT chk_rps_value CHECK (reward_type IS NULL OR (reward_type = 'loyalty_points' AND reward_points IS NOT NULL) OR (reward_type = 'cash_payout' AND reward_cents IS NOT NULL)),
  CONSTRAINT chk_rps_spend CHECK (min_qualifying_spend_cents >= 0),
  CONSTRAINT chk_rps_window CHECK (qualification_window_days IS NULL OR qualification_window_days BETWEEN 1 AND 730),
  CONSTRAINT chk_rps_grace CHECK (record_grace_hours BETWEEN 0 AND 168)
);

-- ── rewards (obligation + issuance) ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_rewards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  referral_id           uuid NOT NULL,
  recipient_customer_id uuid NOT NULL,
  reward_type           text NOT NULL,
  points                integer,
  amount_cents          bigint,
  policy_version        integer NOT NULL,
  state                 text NOT NULL DEFAULT 'PENDING_APPROVAL',
  requested_at          timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  decided_by            uuid,
  decision_reason       text,
  issued_at             timestamptz,
  issued_by             uuid,
  issuance_key          text,
  ledger_entry_id       uuid,
  issue_error           text,
  reversed_at           timestamptz,
  reversed_by           uuid,
  reversal_reason       text,
  reversal_ledger_id    uuid,
  reversal_shortfall    integer,
  row_version           integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  CONSTRAINT chk_rr_type CHECK (reward_type IN ('loyalty_points', 'cash_payout')),
  CONSTRAINT chk_rr_state CHECK (state IN ('PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'REJECTED', 'REVERSED', 'BLOCKED_EXTERNAL', 'FAILED')),
  CONSTRAINT chk_rr_value CHECK ((reward_type = 'loyalty_points' AND points > 0) OR (reward_type = 'cash_payout' AND amount_cents > 0)),
  CONSTRAINT chk_rr_issued CHECK (state <> 'ISSUED' OR (issued_at IS NOT NULL AND (reward_type <> 'loyalty_points' OR ledger_entry_id IS NOT NULL)))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_rewards_referral ON referral_rewards (tenant_id, referral_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_rewards_issuance ON referral_rewards (tenant_id, issuance_key) WHERE issuance_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_referral_rewards_tenant_state ON referral_rewards (tenant_id, state, requested_at);

-- ── events (append-only) ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  referral_id     uuid NOT NULL,
  reward_id       uuid,
  event_type      text NOT NULL,
  from_state      text,
  to_state        text,
  actor_user_id   uuid,
  reason          text,
  source_ref      text,
  idempotency_key text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_referral_events_referral ON referral_events (tenant_id, referral_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_events_idem ON referral_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION referral_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'referral_events is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_referral_events_append_only ON referral_events;
CREATE TRIGGER trg_referral_events_append_only BEFORE UPDATE OR DELETE ON referral_events FOR EACH ROW EXECUTE FUNCTION referral_events_append_only();
