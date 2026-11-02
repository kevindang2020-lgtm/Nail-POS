-- 686_security_event_mfa_replace_refused.sql — Security Deep Scan C1 (Oct 23 2026): POST /auth/mfa/enroll refuses to replace
-- a CONFIRMED authenticator without its current code and records MFA_REPLACE_REFUSED. The type was added to the code catalog
-- (SECURITY_EVENT_TYPES) but not to the database CHECK, so every such event would be refused by the database and dropped
-- (the recorder logs and returns false — exactly what 510 fixed for MFA_RECOVERY_CODES_GENERATED). Recreates the event_type
-- CHECK with that value; the list must stay identical to SECURITY_EVENT_TYPES (security-events.pgtest).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'security_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE security_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE security_events ADD CONSTRAINT security_events_event_type_check CHECK (event_type IN (
  'LOGIN_FAILED_BURST','MFA_ENROLLED','MFA_CONFIRMED','MFA_DISABLED','MFA_RESET','MFA_RECOVERY_CODES_GENERATED',
  'SESSION_REVOKED','SESSIONS_REVOKED_ALL','PRIVILEGE_ESCALATION_ATTEMPT','CROSS_TENANT_ACCESS_ATTEMPT',
  'SUPPORT_MODE_STARTED','SUPPORT_MODE_ENDED','API_KEY_CREATED','API_KEY_REVOKED',
  'WEBHOOK_SIGNATURE_FAILED','SMS_ABUSE_DETECTED','SECRET_ROTATED','KEY_FALLBACK_IN_USE',
  'FRAUD_PATTERN_DETECTED','MFA_REPLACE_REFUSED'));
