-- 100_go_checkin_allowed_branches.sql — multi-branch Go Check-In devices. The existing branch_id is the DEFAULT branch;
-- allowed_branch_ids holds any ADDITIONAL branches a kiosk may serve. NULL/empty = single-branch (today's behavior). The
-- selectable set = branch_id ∪ allowed_branch_ids; the kiosk picks one at session start, validated server-side against
-- this set, and the chosen branch is carried on the session.
ALTER TABLE go_checkin_devices ADD COLUMN IF NOT EXISTS allowed_branch_ids JSONB;
