-- 491_session_lock.sql — Functional Decision 35, server side: a locked POS session is locked for the API too.
-- The idle lock lived only in the browser (localStorage): clearing it, or opening a second tab, skipped the PIN while
-- the session stayed fully usable. Now POST /auth/lock stamps the session; until /auth/verify-pin succeeds the API
-- answers every other request with 423 SESSION_LOCKED; a lock older than 8 hours revokes the session (full sign-in).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
COMMENT ON COLUMN sessions.locked_at IS 'Idle-locked since (Decision 35); NULL = unlocked. Cleared by a correct PIN.';
