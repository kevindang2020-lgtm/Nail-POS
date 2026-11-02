-- 499_session_revoke_burns_refresh.sql — Constitution 3 §44 (Step 8, Oct 3 2026): revoking a session must also end its
-- refresh tokens, or the device could mint a fresh access token from the "signed-out" session. Sessions are revoked from
-- several places (POS and customer session lists, sign out everywhere, devices, logout); one trigger covers all of them,
-- including any written later.
CREATE OR REPLACE FUNCTION revoke_refresh_tokens_of_revoked_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sessions_revoke_refresh ON sessions;
CREATE TRIGGER trg_sessions_revoke_refresh AFTER UPDATE OF revoked_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION revoke_refresh_tokens_of_revoked_session();
