-- 673_payroll_paychecks.sql — Weekly Technician Paycheck, Cash Payout & Owner Approval (Kevin's master mandate, Oct 21 2026).
--
-- "Earnings, approval, pay statement, payout plan, payout transaction and paid status are separate authoritative concepts."
--
-- This EXTENDS the one payroll system (no PayrollV2 — mandate §1):
--   * payroll_periods (115/589/610) stays THE pay period; payroll_lines stays THE calculated earnings per technician
--     (built from the compensation snapshot + adjustments ledger by the one build). The period gains the manager-submit /
--     owner-decision stamps and a payout status.
--   * payroll_statements (NEW) — the technician's pay statement: an immutable snapshot of the line's components at
--     submission, with a human number PAY-YYYY-NNNNNN, the amount already received, the approved payable, paid / unpaid.
--   * payroll_payout_plans + payroll_payout_instructions (NEW) — HOW the approved payable is paid (50% check / 50% cash by
--     default, or a permitted manual split). The sum of instructions equals the payable exactly.
--   * payroll_payouts (611) stays THE payout transaction. Each instruction materialises as one payout after owner
--     approval; it gains the check lifecycle (number, issue, delivery, clearance, void, replacement) and the cash lifecycle
--     (source, preparation, drawer movement, handoff, technician acknowledgment, dispute).
--   * payroll_schedules (NEW) — the salon's pay schedule and payout policy (weekly by default).
--   * cash_drawer_movements (084) gains a source link + idempotency key so a payroll cash payout is one traceable movement.
-- Money stays integer cents. Cash is a recorded payroll method — it appears on statements, reports and audit (mandate §1).

-- ── the salon's pay schedule and payout policy ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_schedules (
  tenant_id              UUID PRIMARY KEY REFERENCES tenants(id),
  frequency              TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  week_start_day         SMALLINT NOT NULL DEFAULT 1 CHECK (week_start_day BETWEEN 0 AND 6),     -- 0 = Sunday … 1 = Monday
  pay_day_offset_days    SMALLINT NOT NULL DEFAULT 5 CHECK (pay_day_offset_days BETWEEN 0 AND 31), -- days after the period ends
  timezone               TEXT,                                                                   -- null = the salon's own zone
  active                 BOOLEAN NOT NULL DEFAULT true,
  auto_prepare           BOOLEAN NOT NULL DEFAULT false,   -- the weekly worker opens + calculates the week; people still review and approve
  default_policy         TEXT NOT NULL DEFAULT 'split_check_cash' CHECK (default_policy IN ('split_check_cash', 'all_check', 'all_cash')),
  default_check_bp       INTEGER NOT NULL DEFAULT 5000 CHECK (default_check_bp BETWEEN 0 AND 10000),
  primary_method         TEXT NOT NULL DEFAULT 'check' CHECK (primary_method IN ('check', 'cash')),   -- receives the odd cent
  cash_enabled           BOOLEAN NOT NULL DEFAULT true,
  max_cash_bp            INTEGER NOT NULL DEFAULT 10000 CHECK (max_cash_bp BETWEEN 0 AND 10000),
  allowed_methods        TEXT[] NOT NULL DEFAULT ARRAY['check', 'cash']::text[],
  manual_split_allowed   BOOLEAN NOT NULL DEFAULT true,
  cash_tips_already_paid BOOLEAN NOT NULL DEFAULT false,   -- the salon hands cash tips over each day: not paid twice
  cash_paid_on           TEXT NOT NULL DEFAULT 'acknowledged' CHECK (cash_paid_on IN ('acknowledged', 'handed_off')),
  version                INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by             UUID
);

-- ── the pay period: manager submission and the owner's decision ─────────────────────────────────────────────────────
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS submitted_by       UUID,
  ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_decision     TEXT,
  ADD COLUMN IF NOT EXISTS owner_note         TEXT,
  ADD COLUMN IF NOT EXISTS owner_decided_by   UUID,
  ADD COLUMN IF NOT EXISTS owner_decided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_status      TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS schedule_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll_periods DROP CONSTRAINT IF EXISTS payroll_periods_owner_decision_check;
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_owner_decision_check CHECK (owner_decision IS NULL OR owner_decision IN ('approved', 'returned', 'rejected'));
ALTER TABLE payroll_periods DROP CONSTRAINT IF EXISTS payroll_periods_payout_status_check;
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_payout_status_check CHECK (payout_status IN ('none', 'unpaid', 'partially_paid', 'paid'));
-- one schedule-generated period per salon per week (the worker can run twice and open one)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_periods_schedule_week ON payroll_periods (tenant_id, period_start, period_end) WHERE schedule_generated AND branch_id IS NULL;

-- ── statement numbers: PAY-YYYY-NNNNNN per salon ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_statement_counters (
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  year         INTEGER NOT NULL,
  last_number  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

-- ── the pay statement: an immutable financial snapshot ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_statements (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id),
  period_id                 UUID NOT NULL REFERENCES payroll_periods(id),
  technician_id             UUID NOT NULL REFERENCES technicians(id),
  branch_id                 UUID REFERENCES branches(id),
  statement_number          TEXT NOT NULL,
  service_commission_cents  BIGINT NOT NULL DEFAULT 0,
  hourly_pay_cents          BIGINT NOT NULL DEFAULT 0,
  salary_pay_cents          BIGINT NOT NULL DEFAULT 0,
  tips_cents                BIGINT NOT NULL DEFAULT 0,
  card_tip_cents            BIGINT NOT NULL DEFAULT 0,
  cash_tip_cents            BIGINT NOT NULL DEFAULT 0,
  retail_commission_cents   BIGINT NOT NULL DEFAULT 0,
  bonus_cents               BIGINT NOT NULL DEFAULT 0,
  guarantee_topup_cents     BIGINT NOT NULL DEFAULT 0,
  positive_adjustments_cents BIGINT NOT NULL DEFAULT 0,
  deductions_cents          BIGINT NOT NULL DEFAULT 0,
  reversals_cents           BIGINT NOT NULL DEFAULT 0,
  gross_earnings_cents      BIGINT NOT NULL DEFAULT 0,
  line_payable_cents        BIGINT NOT NULL DEFAULT 0,      -- what the payroll line says is owed for the period
  already_paid_cents        BIGINT NOT NULL DEFAULT 0,      -- cash tips already handed over + payouts recorded before this statement
  approved_payable_cents    BIGINT NOT NULL DEFAULT 0,      -- line payable − already paid: what the payout plan must pay
  paid_cents                BIGINT NOT NULL DEFAULT 0,
  status                    TEXT NOT NULL DEFAULT 'draft',
  review_required           BOOLEAN NOT NULL DEFAULT false, -- a negative payable is never paid out (§4)
  line_hash                 TEXT,                           -- the payroll line it snapshots (a drift check before submit)
  branch_breakdown          JSONB NOT NULL DEFAULT '[]'::jsonb,
  manager_note              TEXT,                           -- private: never shown to the technician
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at              TIMESTAMPTZ,
  approved_at               TIMESTAMPTZ,
  approved_by               UUID,
  locked_at                 TIMESTAMPTZ,
  voided_at                 TIMESTAMPTZ,
  void_reason               TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                UUID,
  CONSTRAINT payroll_statements_status_check CHECK (status IN ('draft', 'ready_for_review', 'submitted', 'held', 'approved', 'locked', 'issued', 'partially_paid', 'paid', 'voided')),
  CONSTRAINT payroll_statements_money_check CHECK (approved_payable_cents >= 0 AND paid_cents >= 0 AND paid_cents <= approved_payable_cents AND already_paid_cents >= 0),
  CONSTRAINT payroll_statements_number_unique UNIQUE (tenant_id, statement_number)
);
-- ONE technician + ONE salon + ONE live statement per pay period (§14: multi-branch work never makes two paychecks)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_statements_live ON payroll_statements (tenant_id, period_id, technician_id) WHERE status <> 'voided';
CREATE INDEX IF NOT EXISTS idx_payroll_statements_tech ON payroll_statements (tenant_id, technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_statements_period ON payroll_statements (tenant_id, period_id, status);
CREATE TRIGGER trg_tc_payroll_statements__period_id BEFORE INSERT OR UPDATE OF tenant_id, period_id ON payroll_statements FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_periods', 'period_id');
CREATE TRIGGER trg_tc_payroll_statements__technician_id BEFORE INSERT OR UPDATE OF tenant_id, technician_id ON payroll_statements FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('technicians', 'technician_id');
CREATE TRIGGER trg_tc_payroll_statements__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON payroll_statements FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

-- an approved statement is a locked historical snapshot: its figures never change (corrections are adjustments)
CREATE OR REPLACE FUNCTION payroll_statements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'locked', 'issued', 'partially_paid', 'paid') AND (
       NEW.service_commission_cents IS DISTINCT FROM OLD.service_commission_cents OR NEW.hourly_pay_cents IS DISTINCT FROM OLD.hourly_pay_cents
    OR NEW.salary_pay_cents IS DISTINCT FROM OLD.salary_pay_cents OR NEW.tips_cents IS DISTINCT FROM OLD.tips_cents
    OR NEW.card_tip_cents IS DISTINCT FROM OLD.card_tip_cents OR NEW.cash_tip_cents IS DISTINCT FROM OLD.cash_tip_cents
    OR NEW.retail_commission_cents IS DISTINCT FROM OLD.retail_commission_cents OR NEW.bonus_cents IS DISTINCT FROM OLD.bonus_cents
    OR NEW.guarantee_topup_cents IS DISTINCT FROM OLD.guarantee_topup_cents OR NEW.positive_adjustments_cents IS DISTINCT FROM OLD.positive_adjustments_cents
    OR NEW.deductions_cents IS DISTINCT FROM OLD.deductions_cents OR NEW.reversals_cents IS DISTINCT FROM OLD.reversals_cents
    OR NEW.gross_earnings_cents IS DISTINCT FROM OLD.gross_earnings_cents OR NEW.line_payable_cents IS DISTINCT FROM OLD.line_payable_cents
    OR NEW.already_paid_cents IS DISTINCT FROM OLD.already_paid_cents OR NEW.approved_payable_cents IS DISTINCT FROM OLD.approved_payable_cents
    OR NEW.statement_number IS DISTINCT FROM OLD.statement_number OR NEW.technician_id IS DISTINCT FROM OLD.technician_id OR NEW.period_id IS DISTINCT FROM OLD.period_id) THEN
    RAISE EXCEPTION 'payroll statement % is approved and locked; correct it with an adjustment', OLD.statement_number USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payroll statements are never deleted (void them)' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payroll_statements_immutable ON payroll_statements;
CREATE TRIGGER trg_payroll_statements_immutable BEFORE UPDATE OR DELETE ON payroll_statements FOR EACH ROW EXECUTE FUNCTION payroll_statements_immutable();

-- ── the payout plan: how the approved payable is paid ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_payout_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  statement_id          UUID NOT NULL REFERENCES payroll_statements(id),
  policy_type           TEXT NOT NULL CHECK (policy_type IN ('split_check_cash', 'all_check', 'all_cash', 'manual_percent', 'manual_amount')),
  payable_cents         BIGINT NOT NULL CHECK (payable_cents >= 0),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'superseded')),
  differs_from_default  BOOLEAN NOT NULL DEFAULT false,
  override_reason       TEXT,
  created_by            UUID,
  submitted_by          UUID,
  approved_by           UUID,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_payout_plans_live ON payroll_payout_plans (tenant_id, statement_id) WHERE status <> 'superseded';
CREATE TRIGGER trg_tc_payroll_payout_plans__statement_id BEFORE INSERT OR UPDATE OF tenant_id, statement_id ON payroll_payout_plans FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_statements', 'statement_id');

CREATE TABLE IF NOT EXISTS payroll_payout_instructions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  plan_id         UUID NOT NULL REFERENCES payroll_payout_plans(id),
  statement_id    UUID NOT NULL REFERENCES payroll_statements(id),
  method          TEXT NOT NULL CHECK (method IN ('check', 'cash', 'ach', 'direct_deposit', 'external_transfer', 'payroll_provider')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  basis_points    INTEGER CHECK (basis_points IS NULL OR basis_points BETWEEN 0 AND 10000),
  sequence        SMALLINT NOT NULL CHECK (sequence >= 1),
  status          TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'materialized', 'canceled')),
  payout_id       UUID REFERENCES payroll_payouts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_payout_instructions_seq UNIQUE (tenant_id, plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_payroll_payout_instr_statement ON payroll_payout_instructions (tenant_id, statement_id);
CREATE TRIGGER trg_tc_payroll_payout_instructions__plan_id BEFORE INSERT OR UPDATE OF tenant_id, plan_id ON payroll_payout_instructions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_payout_plans', 'plan_id');
CREATE TRIGGER trg_tc_payroll_payout_instructions__statement_id BEFORE INSERT OR UPDATE OF tenant_id, statement_id ON payroll_payout_instructions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_statements', 'statement_id');
CREATE TRIGGER trg_tc_payroll_payout_instructions__payout_id BEFORE INSERT OR UPDATE OF tenant_id, payout_id ON payroll_payout_instructions FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_payouts', 'payout_id');

-- ── the payout transaction: check and cash lifecycles ───────────────────────────────────────────────────────────────
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_method_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_method_check CHECK (method IN ('cash', 'check', 'direct_deposit', 'external_provider', 'other', 'ach', 'external_transfer', 'payroll_provider'));
ALTER TABLE payroll_payouts
  ADD COLUMN IF NOT EXISTS statement_id          UUID REFERENCES payroll_statements(id),
  ADD COLUMN IF NOT EXISTS instruction_id        UUID REFERENCES payroll_payout_instructions(id),
  ADD COLUMN IF NOT EXISTS check_number          TEXT,
  ADD COLUMN IF NOT EXISTS check_status          TEXT,
  ADD COLUMN IF NOT EXISTS check_issued_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_issued_by       UUID,
  ADD COLUMN IF NOT EXISTS check_delivered_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_cleared_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_voided_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_void_reason     TEXT,
  ADD COLUMN IF NOT EXISTS replaces_payout_id    UUID REFERENCES payroll_payouts(id),
  ADD COLUMN IF NOT EXISTS cash_source           TEXT,
  ADD COLUMN IF NOT EXISTS cash_status           TEXT,
  ADD COLUMN IF NOT EXISTS cash_register_id      TEXT,
  ADD COLUMN IF NOT EXISTS cash_prepared_by      UUID,
  ADD COLUMN IF NOT EXISTS cash_prepared_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_handed_off_by    UUID,
  ADD COLUMN IF NOT EXISTS cash_handed_off_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_acknowledged_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_ack_method       TEXT,
  ADD COLUMN IF NOT EXISTS cash_dispute_reason   TEXT,
  ADD COLUMN IF NOT EXISTS drawer_movement_id    UUID,
  ADD COLUMN IF NOT EXISTS device_id             TEXT,
  ADD COLUMN IF NOT EXISTS version               INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_check_status_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_check_status_check CHECK (check_status IS NULL OR check_status IN ('planned', 'issued', 'delivered', 'cleared', 'voided', 'returned'));
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_cash_status_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_cash_status_check CHECK (cash_status IS NULL OR cash_status IN ('planned', 'ready_for_handoff', 'handed_off', 'acknowledged', 'disputed', 'canceled'));
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_cash_source_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_cash_source_check CHECK (cash_source IS NULL OR cash_source IN ('register_drawer', 'safe', 'bank_withdrawal', 'other_recorded_source'));
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_cash_ack_method_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_cash_ack_method_check CHECK (cash_ack_method IS NULL OR cash_ack_method IN ('technician_app', 'technician_pin', 'manager_dual'));
ALTER TABLE payroll_payouts DROP CONSTRAINT IF EXISTS payroll_payouts_lifecycle_shape_check;
ALTER TABLE payroll_payouts ADD CONSTRAINT payroll_payouts_lifecycle_shape_check CHECK ((check_status IS NULL OR method = 'check') AND (cash_status IS NULL OR method = 'cash'));
-- no two live checks with the same number in a salon (a voided / returned check keeps its number in history)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_payouts_check_number ON payroll_payouts (tenant_id, check_number) WHERE check_number IS NOT NULL AND check_status NOT IN ('voided', 'returned');
CREATE INDEX IF NOT EXISTS idx_payroll_payouts_statement ON payroll_payouts (tenant_id, statement_id);
CREATE TRIGGER trg_tc_payroll_payouts__statement_id BEFORE INSERT OR UPDATE OF tenant_id, statement_id ON payroll_payouts FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_statements', 'statement_id');
CREATE TRIGGER trg_tc_payroll_payouts__instruction_id BEFORE INSERT OR UPDATE OF tenant_id, instruction_id ON payroll_payouts FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_payout_instructions', 'instruction_id');
CREATE TRIGGER trg_tc_payroll_payouts__replaces_payout_id BEFORE INSERT OR UPDATE OF tenant_id, replaces_payout_id ON payroll_payouts FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('payroll_payouts', 'replaces_payout_id');

-- ── the cash drawer: a payroll cash payout is ONE traceable, idempotent movement ────────────────────────────────────
ALTER TABLE cash_drawer_movements
  ADD COLUMN IF NOT EXISTS source_type      TEXT,
  ADD COLUMN IF NOT EXISTS source_id        UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key  TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_drawer_movements_idem ON cash_drawer_movements (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_drawer_movements_source ON cash_drawer_movements (tenant_id, source_type, source_id) WHERE source_id IS NOT NULL;

-- ── tenant isolation policy (inert until DB_TENANT_RLS=1 sets app.tenant_id) ────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_schedules', 'payroll_statement_counters', 'payroll_statements', 'payroll_payout_plans', 'payroll_payout_instructions']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_session_unrestricted() OR tenant_id = app_session_tenant()) '
                   'WITH CHECK (app_session_unrestricted() OR tenant_id = app_session_tenant())', t);
  END LOOP;
END $$;
