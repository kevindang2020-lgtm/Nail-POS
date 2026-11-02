-- 681_expense_shared_cost_policy.sql — Remaining-work mandate §8 / NEXT_STEPS P2-3 (Oct 23 2026): how a SALON-WIDE expense
-- (branch_id NULL — rent, software, insurance) is shown on a single branch's report.
--   shared_cost_policy  'NONE'              (default — today's behaviour): a single-branch view shows the branch's own
--                                           expenses only; salon-wide costs appear in the whole-salon view.
--                       'MANUAL_PERCENTAGE' the owner's shares (shared_cost_shares, basis points, 100% = 10 000) split
--                                           every salon-wide expense across branches, to the cent (largest remainder).
--   shared_cost_shares  [{ "branchId": uuid, "basisPoints": int }] — must sum to exactly 10 000 when the policy is
--                       MANUAL_PERCENTAGE (checked by the service; the CHECK below only keeps the shape an array).
-- An expense that carries its OWN split (expense_allocations, §68) keeps it; the policy applies to the rest. The share is
-- COMPUTED at read time — no expense row is copied per branch, so nothing is ever counted twice.
-- EXPAND-ONLY, idempotent; existing salons get 'NONE' (no change to any report).
ALTER TABLE expense_settings
  ADD COLUMN IF NOT EXISTS shared_cost_policy TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS shared_cost_shares JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_settings_shared_cost_policy_chk') THEN
    ALTER TABLE expense_settings ADD CONSTRAINT expense_settings_shared_cost_policy_chk CHECK (shared_cost_policy IN ('NONE', 'MANUAL_PERCENTAGE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_settings_shared_cost_shares_chk') THEN
    ALTER TABLE expense_settings ADD CONSTRAINT expense_settings_shared_cost_shares_chk CHECK (jsonb_typeof(shared_cost_shares) = 'array');
  END IF;
END $$;
