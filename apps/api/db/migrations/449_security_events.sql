-- 449_security_events.sql — Constitution 12 §186–194, §267: the security event store.
--
-- WHY A NEW TABLE (the "no *_v2 without a reason" rule): audit_events requires tenant_id (NOT NULL) and has no event
-- vocabulary, so a Super Admin's security event or a failed webhook signature — neither has a salon — cannot be
-- recorded there at all. §189 asks for separate security categories and §194 for events that are never sampled away.
--
-- APPEND-ONLY AT THE DATABASE (§187). A trigger refuses UPDATE and DELETE, so neither an application bug nor someone
-- holding the application's credentials can rewrite history. The retention job is the ONE sanctioned deleter: it sets
-- a transaction-local flag the trigger checks, and only rows past retention may go.
CREATE TABLE IF NOT EXISTS security_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'LOGIN_FAILED_BURST','MFA_ENROLLED','MFA_CONFIRMED','MFA_DISABLED','MFA_RESET',
                    'SESSION_REVOKED','SESSIONS_REVOKED_ALL','PRIVILEGE_ESCALATION_ATTEMPT','CROSS_TENANT_ACCESS_ATTEMPT',
                    'SUPPORT_MODE_STARTED','SUPPORT_MODE_ENDED','API_KEY_CREATED','API_KEY_REVOKED',
                    'WEBHOOK_SIGNATURE_FAILED','SMS_ABUSE_DETECTED','SECRET_ROTATED','KEY_FALLBACK_IN_USE')),
  severity        TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  tenant_id       UUID,                    -- NULL for platform events (Super Admin, webhooks before tenant resolution)
  actor_type      TEXT,                    -- user / super_admin / service / provider / anonymous
  actor_id        TEXT,
  resource_type   TEXT,
  resource_id     TEXT,
  reason          TEXT,                    -- a SAFE reason: never a secret, token, OTP or card number (§188)
  request_id      TEXT,
  correlation_id  TEXT,
  ip              TEXT,
  device          TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_security_events_time ON security_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_security_events_type_time ON security_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_security_events_tenant_time ON security_events (tenant_id, occurred_at DESC) WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION security_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aps.security_retention', true) = 'on'
     AND OLD.occurred_at < now() - interval '400 days' THEN
    RETURN OLD;                                -- the retention job, and only for rows past retention
  END IF;
  RAISE EXCEPTION 'security_events is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_security_events_append_only ON security_events;
CREATE TRIGGER trg_security_events_append_only BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION security_events_append_only();
