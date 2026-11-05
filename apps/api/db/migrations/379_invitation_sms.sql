-- 379_invitation_sms.sql — an invitation that can actually reach a nail technician.
--
-- == THE PROBLEM ===========================================================================================
--
-- `user_invitations.email` is NOT NULL. It was built for platform staff, who all have one.
--
-- A nail technician frequently does not. She has a mobile number. It is the number the salon hires her on, the
-- number the POS already stores, and the number the global technician account now deduplicates her by — and it
-- is the ONE identifier the invitation system could not use.
--
-- So `GlobalTechIdentityService.createInvitation` returned `{ created: false, reason: 'no_email' }` for exactly
-- the technician the feature exists for. The account was created, the membership was created, and the person it
-- belonged to was never told.
--
-- == WHAT CHANGES ==========================================================================================
--
-- email becomes nullable, a phone column is added, and a CHECK insists on AT LEAST ONE of them. An invitation
-- with neither is not an invitation — it is a row that can never be delivered to anybody, and the constraint
-- says so at the database rather than letting it sit there looking sent.
ALTER TABLE user_invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE user_invitations ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_reachable;
ALTER TABLE user_invitations ADD  CONSTRAINT user_invitations_reachable
  CHECK (email IS NOT NULL OR normalized_phone IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_user_invitations_phone ON user_invitations (normalized_phone)
  WHERE normalized_phone IS NOT NULL;

-- Existing rows are untouched: they all have an email, so the CHECK passes for every one of them and the
-- pending-invite unique behaviour of the platform surface is unchanged.
