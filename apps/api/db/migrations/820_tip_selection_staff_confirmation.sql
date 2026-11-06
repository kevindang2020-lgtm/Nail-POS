-- 820_tip_selection_staff_confirmation.sql — G4 Split Tips follow-up (Nov 5 2026, guide §34 "no fabricated customer
-- confirmation"). The front desk may confirm a customer's per-technician tip split ON THEIR BEHALF only as an explicit,
-- attributed act: the history row names who did it (actor_user_id) and why (detail.reason), and the selection + its tip
-- rows say source 'staff' (both vocabularies already allow it, migration 817). The events table stays append-only.
ALTER TABLE checkout_tip_selection_events ADD COLUMN IF NOT EXISTS actor_user_id uuid;
ALTER TABLE checkout_tip_selection_events DROP CONSTRAINT IF EXISTS chk_ctse_action;
ALTER TABLE checkout_tip_selection_events ADD CONSTRAINT chk_ctse_action
  CHECK (action IN ('DRAFT_SAVED', 'CONFIRMED', 'LOCKED', 'SUPERSEDED', 'STAFF_CONFIRMED_ON_BEHALF'));
