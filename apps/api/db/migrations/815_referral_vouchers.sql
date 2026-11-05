-- 815_referral_vouchers.sql — Refer a Friend / Referral Rewards build (Nov 5 2026). ADDITIVE ONLY, on the canonical
-- referral tables of 751 (no parallel referral domain):
--   referral_program_settings  gains the two-sided SALON VOUCHER reward (reward_type 'salon_voucher'): the friend's first-visit
--                              discount and the referrer's thank-you, set separately (R014); voucher terms (minimum spend,
--                              expiry); and the campaign BUDGET — a hard total cap, an optional monthly cap, a per-referrer cap
--                              and a warning threshold (R020). Dollars, never tokens; never touches the global token wallet (R024).
--   referral_rewards           may carry a 'salon_voucher' reward (the referrer's) — amount_cents is its face value.
--   referral_vouchers (new)    the two vouchers a referral creates, with their own lifecycle and the budget they hold:
--                              friend AVAILABLE at activation; referrer PENDING until the friend's verified paid first visit,
--                              then AVAILABLE; REDEEMED when used at Checkout; VOID / EXPIRED / RELEASED free the budget.
--                              The money itself is a single-use, customer-bound wallet coupon on the deals engine (the ONE
--                              discount authority) — coupon_code_id points at it. UNIQUE (tenant, referral, role): one each.

ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS friend_reward_cents      bigint;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS referrer_reward_cents    bigint;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS voucher_min_spend_cents  bigint NOT NULL DEFAULT 0;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS voucher_expiry_days      integer NOT NULL DEFAULT 90;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS budget_total_cents       bigint;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS budget_monthly_cents     bigint;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS per_referrer_cap         integer;
ALTER TABLE referral_program_settings ADD COLUMN IF NOT EXISTS budget_warn_percent      integer NOT NULL DEFAULT 80;
ALTER TABLE referral_program_settings DROP CONSTRAINT IF EXISTS chk_rps_reward_type;
ALTER TABLE referral_program_settings ADD CONSTRAINT chk_rps_reward_type CHECK (reward_type IS NULL OR reward_type IN ('loyalty_points', 'cash_payout', 'salon_voucher'));
ALTER TABLE referral_program_settings DROP CONSTRAINT IF EXISTS chk_rps_value;
ALTER TABLE referral_program_settings ADD CONSTRAINT chk_rps_value CHECK (reward_type IS NULL
  OR (reward_type = 'loyalty_points' AND reward_points IS NOT NULL) OR (reward_type = 'cash_payout' AND reward_cents IS NOT NULL)
  OR (reward_type = 'salon_voucher' AND friend_reward_cents IS NOT NULL AND referrer_reward_cents IS NOT NULL AND budget_total_cents IS NOT NULL));
ALTER TABLE referral_program_settings ADD CONSTRAINT chk_rps_voucher_amounts CHECK ((friend_reward_cents IS NULL OR friend_reward_cents BETWEEN 100 AND 50000)
  AND (referrer_reward_cents IS NULL OR referrer_reward_cents BETWEEN 100 AND 50000));
ALTER TABLE referral_program_settings ADD CONSTRAINT chk_rps_voucher_terms CHECK (voucher_min_spend_cents >= 0 AND voucher_expiry_days BETWEEN 7 AND 365
  AND budget_warn_percent BETWEEN 1 AND 100 AND (per_referrer_cap IS NULL OR per_referrer_cap BETWEEN 1 AND 1000)
  AND (budget_total_cents IS NULL OR budget_total_cents BETWEEN 100 AND 100000000) AND (budget_monthly_cents IS NULL OR budget_monthly_cents BETWEEN 100 AND 100000000));

ALTER TABLE referral_rewards DROP CONSTRAINT IF EXISTS chk_rr_type;
ALTER TABLE referral_rewards ADD CONSTRAINT chk_rr_type CHECK (reward_type IN ('loyalty_points', 'cash_payout', 'salon_voucher'));
ALTER TABLE referral_rewards DROP CONSTRAINT IF EXISTS chk_rr_value;
ALTER TABLE referral_rewards ADD CONSTRAINT chk_rr_value CHECK ((reward_type = 'loyalty_points' AND points > 0) OR (reward_type IN ('cash_payout', 'salon_voucher') AND amount_cents > 0));

CREATE TABLE IF NOT EXISTS referral_vouchers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid,
  referral_id     uuid NOT NULL REFERENCES referral_redemptions(id),
  customer_id     uuid NOT NULL,
  role            text NOT NULL,
  face_cents      bigint NOT NULL,
  min_spend_cents bigint NOT NULL DEFAULT 0,
  state           text NOT NULL,
  policy_version  integer NOT NULL,
  coupon_code_id  uuid,
  code_hint       text,
  expires_at      timestamptz,
  available_at    timestamptz,
  redeemed_at     timestamptz,
  ticket_id       uuid,
  closed_reason   text,
  row_version     integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT chk_rv_role CHECK (role IN ('friend', 'referrer')),
  CONSTRAINT chk_rv_face CHECK (face_cents BETWEEN 100 AND 50000),
  CONSTRAINT chk_rv_state CHECK (state IN ('PENDING', 'AVAILABLE', 'REDEEMED', 'EXPIRED', 'VOID', 'RELEASED')),
  CONSTRAINT chk_rv_available CHECK (state NOT IN ('AVAILABLE', 'REDEEMED') OR coupon_code_id IS NOT NULL),
  CONSTRAINT uq_rv_one_per_role UNIQUE (tenant_id, referral_id, role)
);
CREATE INDEX IF NOT EXISTS ix_rv_tenant_state ON referral_vouchers (tenant_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_rv_tenant_customer ON referral_vouchers (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_rv_coupon ON referral_vouchers (coupon_code_id) WHERE coupon_code_id IS NOT NULL;
-- B-12: the referral this voucher belongs to must be in the SAME salon (enforced at the database, not only by the code)
CREATE TRIGGER trg_tc_referral_vouchers__referral_id BEFORE INSERT OR UPDATE OF tenant_id, referral_id ON referral_vouchers
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('referral_redemptions', 'referral_id');
