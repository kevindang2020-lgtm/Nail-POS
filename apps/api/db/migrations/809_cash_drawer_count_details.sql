-- 809_cash_drawer_count_details.sql — D15 Cash Drawer gaps (Nov 5 2026).
--   denominations_json   the bill / coin breakdown of a count (cents value → how many); its total must equal counted_cents
--   approval_*           a count that is off by more than the review limit is marked for a manager's review; the manager's
--                        sign-off (who, when, note) is kept on the drawer — the counted figures never change
ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS denominations_json JSONB;
ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS approved_by_user_id UUID;
ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS approval_note TEXT;
