-- 560_user_preferred_language.sql — BUILD_PLAN Phase 13 (Constitution 6 §97–98, audit bug 11): the user's app language.
-- The Owner App's language selector was local state only; the four mobile apps now have EN / VI catalogues and the choice
-- is the USER's (it follows them to a new phone), so it lives on the login row. NULL = never chosen: the app follows the
-- device language and English stays the default. user_ui_prefs (141) is tenant-scoped per (tenant, user) and a customer
-- has no tenant row there, so the column goes on users, where every realm's session points.
-- (Number reserved by agent E; the lead confirms or renumbers.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_language_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_preferred_language_chk CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'vi'));
  END IF;
END $$;
