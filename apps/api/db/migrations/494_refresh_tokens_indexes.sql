-- 494_refresh_tokens_indexes.sql — Constitution 3 Step 2 (Oct 3 2026): refresh-token rotation on the refresh_tokens table
-- that migration 001 created and nothing used. Lookups are by hash; the family is the session.
CREATE UNIQUE INDEX IF NOT EXISTS ux_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_session ON refresh_tokens (session_id);
