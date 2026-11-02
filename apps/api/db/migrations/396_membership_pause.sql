-- 396_membership_pause.sql — Super Admin Technician Account Management, Phase 2: membership-level pause.
-- A Super Admin can pause ONE salon membership while the global account and every other membership stay active. That is
-- the whole point of keeping global-account status separate from membership status, so 'paused' is a membership status
-- distinct from 'suspended'/'former'/'revoked'.
ALTER TABLE tech_salon_memberships DROP CONSTRAINT IF EXISTS tech_salon_memberships_status_check;
ALTER TABLE tech_salon_memberships ADD CONSTRAINT tech_salon_memberships_status_check CHECK (status IN (
  'pending_invite', 'pending_tech_approval', 'pending_salon_approval',
  'active', 'paused', 'suspended', 'former', 'rejected', 'revoked', 'cancelled'));
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ;
ALTER TABLE tech_salon_memberships ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Let the account-status history point at what a scoped event acted on (a membership now; a profile/messaging/deals
-- toggle in the next phase), so the trail reads "paused salon membership X" rather than just "paused".
ALTER TABLE tech_account_status_events ADD COLUMN IF NOT EXISTS target_id   UUID;
ALTER TABLE tech_account_status_events ADD COLUMN IF NOT EXISTS target_kind TEXT;
