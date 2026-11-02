-- 464_support_session_scope.sql — Constitution 7 §76, §81: a support session carries a SCOPE CLASS, never the tenant
-- owner's full powers. READ_ONLY (default), STANDARD_SUPPORT, ELEVATED_SUPPORT (writes; stronger permission required
-- at start). Existing sessions are READ_ONLY.
ALTER TABLE support_access_sessions ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'READ_ONLY';
ALTER TABLE support_access_sessions DROP CONSTRAINT IF EXISTS support_access_sessions_scope_vocab;
ALTER TABLE support_access_sessions ADD CONSTRAINT support_access_sessions_scope_vocab CHECK (scope IN ('READ_ONLY','STANDARD_SUPPORT','ELEVATED_SUPPORT'));
