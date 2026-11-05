-- 455_fraud_pattern_event.sql — Constitution 12 §172–180: the fraud detector's security-event type.
-- Recreates the event_type CHECK with one more value; the list must stay identical to SECURITY_EVENT_TYPES (a test).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'security_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE security_events DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE security_events ADD CONSTRAINT security_events_event_type_check CHECK (event_type IN (
  'LOGIN_FAILED_BURST','MFA_ENROLLED','MFA_CONFIRMED','MFA_DISABLED','MFA_RESET',
  'SESSION_REVOKED','SESSIONS_REVOKED_ALL','PRIVILEGE_ESCALATION_ATTEMPT','CROSS_TENANT_ACCESS_ATTEMPT',
  'SUPPORT_MODE_STARTED','SUPPORT_MODE_ENDED','API_KEY_CREATED','API_KEY_REVOKED',
  'WEBHOOK_SIGNATURE_FAILED','SMS_ABUSE_DETECTED','SECRET_ROTATED','KEY_FALLBACK_IN_USE',
  'FRAUD_PATTERN_DETECTED'));
