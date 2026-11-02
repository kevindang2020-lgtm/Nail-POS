-- 510_security_event_mfa_recovery_codes.sql — the security-event type MFA_RECOVERY_CODES_GENERATED (added to the code
-- catalog on Oct 3 2026 with the self-service recovery codes, migration 495) was never added to the database CHECK, so
-- every "recovery codes generated" event was refused by the database and dropped (the recorder never throws into the
-- request — it logs and returns false). Recreates the event_type CHECK with that value; the list must stay identical to
-- SECURITY_EVENT_TYPES (modules/security-center security-events.pgtest "the catalog and the database agree").
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
  'FRAUD_PATTERN_DETECTED'));
