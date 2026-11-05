-- 460_platform_roles.sql — Constitution 7 §5: platform roles.
--
-- A platform account is a users row with role = 'SUPER_ADMIN' (the plane marker, unchanged). platform_role says WHICH
-- platform role it holds; the permission set for each is code (packages/permissions platform-roles.ts), so a role's
-- meaning is reviewed with the code that enforces it. Every existing platform account becomes PLATFORM_SUPER_ADMIN —
-- exactly what it can do today, so nobody is locked out. A platform account whose platform_role is missing resolves to
-- read-only (PLATFORM_AUDITOR) at sign-in, never to everything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role TEXT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_platform_role_vocab;
ALTER TABLE users ADD CONSTRAINT users_platform_role_vocab CHECK (platform_role IS NULL OR platform_role IN (
  'PLATFORM_SUPER_ADMIN','PLATFORM_ADMIN','PLATFORM_SUPPORT','PLATFORM_FINANCE','PLATFORM_SECURITY','PLATFORM_OPERATIONS',
  'PLATFORM_AUDITOR','PLATFORM_AI_ADMIN','PLATFORM_BILLING_ADMIN','PLATFORM_ONBOARDING','PLATFORM_DEVELOPER_SUPPORT'));
-- a platform role belongs only on a platform account
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_platform_role_only_platform;
ALTER TABLE users ADD CONSTRAINT users_platform_role_only_platform CHECK (platform_role IS NULL OR role = 'SUPER_ADMIN');
UPDATE users SET platform_role = 'PLATFORM_SUPER_ADMIN' WHERE role = 'SUPER_ADMIN' AND platform_role IS NULL;
