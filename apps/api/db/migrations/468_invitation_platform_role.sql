-- 468_invitation_platform_role.sql — Constitution 7 §24/§25: inviting a PLATFORM user names the platform role they will
-- hold. Only an inviter with super_admin.platform_roles.manage may invite one, never beyond their own permissions (the
-- grant ceiling), and acceptance gives the new account exactly that role. Before this, a SUPER_ADMIN invitation carried
-- no platform role, so the invitee resolved to read-only (the fail-safe) with nothing recording what was intended.
ALTER TABLE user_invitations ADD COLUMN IF NOT EXISTS platform_role TEXT NULL;
ALTER TABLE user_invitations DROP CONSTRAINT IF EXISTS user_invitations_platform_role_vocab;
ALTER TABLE user_invitations ADD CONSTRAINT user_invitations_platform_role_vocab CHECK (platform_role IS NULL OR (role = 'SUPER_ADMIN' AND platform_role IN (
  'PLATFORM_SUPER_ADMIN','PLATFORM_ADMIN','PLATFORM_SUPPORT','PLATFORM_FINANCE','PLATFORM_SECURITY','PLATFORM_OPERATIONS',
  'PLATFORM_AUDITOR','PLATFORM_AI_ADMIN','PLATFORM_BILLING_ADMIN','PLATFORM_ONBOARDING','PLATFORM_DEVELOPER_SUPPORT')));
