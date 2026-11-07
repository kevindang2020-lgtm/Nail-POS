-- 841_face_id_survives_sign_out.sql — Face ID stays on after a normal sign-out (Kevin, Nov 5 2026; changes Constitution 6 §37).
--
-- Before: POST /auth/logout revoked the phone's biometric device credential, so Face ID was gone after every sign-out.
-- Now a normal sign-out on the phone keeps it (the person signs back in with Face ID, as in banking apps). Face ID still
-- ends whenever TRUST ends — and the paths that end trust are many (sign out other devices, Super Admin ending a session,
-- a stolen refresh token, an access change, a suspended account, a PIN lockout, …), written in more than a dozen places.
-- Rather than patch each one, this trigger revokes the credential for (user, device) whenever one of that person's sessions
-- on that device becomes revoked. The ONE exception is the phone's own sign-out, which sets the transaction-local flag
-- aps.keep_face_id = 'on' around its revoke (modules/identity/src/auth/auth.controller.ts doLogout).
--
-- Matching: by auth_device_id when both rows have one, else by device key (credentials store sha256(hex) of the key —
-- hashDeviceKey in auth-devices.ts; sessions store the raw key in device_id). Core sha256(), no pgcrypto needed.
CREATE OR REPLACE FUNCTION end_face_id_with_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('aps.keep_face_id', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  UPDATE device_biometric_credentials
     SET status = 'revoked', revoked_at = now(), revoked_reason = 'session_revoked'
   WHERE status = 'active'
     AND user_id = NEW.user_id
     AND ((NEW.auth_device_id IS NOT NULL AND auth_device_id = NEW.auth_device_id)
       OR (NEW.device_id IS NOT NULL AND device_key_hash = encode(sha256(convert_to(NEW.device_id::text, 'UTF8')), 'hex')));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sessions_end_face_id ON sessions;
CREATE TRIGGER trg_sessions_end_face_id
  AFTER UPDATE OF status ON sessions
  FOR EACH ROW
  WHEN (NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked')
  EXECUTE FUNCTION end_face_id_with_session();
