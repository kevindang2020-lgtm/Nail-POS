-- 689_refresh_token_family.sql — Secure Tap to Pay mandate §2 / §14 / §69 (Oct 23 2026, M6-6): a refresh token belongs to a
-- named FAMILY (one sign-in's chain of rotations: login issues the root, every rotation inherits its family_id). Reuse of a
-- rotated token revokes the whole family (and its session) and is reported as TOKEN_REUSE_DETECTED. Until now the family
-- was implied by session_id; the column makes it explicit (DeviceSession.refreshTokenFamilyId) without a second table.
--
--  • family_id is nullable on purpose: rows written by older code (and by the password-reset / system-reset paths, which
--    insert directly) read as family = their session (coalesce(family_id, session_id)) — exactly the rule before this
--    migration, so nothing changes for them. The backfill below writes that rule into existing rows.
--  • ix_refresh_tokens_family: a reuse revokes every token of the family in one indexed update.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
UPDATE refresh_tokens SET family_id = session_id WHERE family_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_family ON refresh_tokens (family_id) WHERE family_id IS NOT NULL;
