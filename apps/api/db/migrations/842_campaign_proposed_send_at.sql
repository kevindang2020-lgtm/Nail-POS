-- 842_campaign_proposed_send_at.sql — Campaign Builder SUNMI addendum (Nov 8 2026): the six-step builder's Step 5 "Schedule"
-- proposes a send time (salon local date + time, checked for quiet hours, DST, the offer's dates). The draft carries it so the
-- approver sees it and Campaign Center's launch dialog starts from it. It is a PROPOSAL only: nothing is scheduled until an owner
-- or manager approves and launches the campaign (scheduled_at, set by launch, stays the only send time the worker reads).
-- Not part of the content hash: changing the proposal never voids an approval of the message / offer / audience.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS proposed_send_at TIMESTAMPTZ;
COMMENT ON COLUMN campaigns.proposed_send_at IS 'Campaign Builder proposal only; scheduled_at (set by launch) is the send time.';
