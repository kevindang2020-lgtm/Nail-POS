-- 497_auth_events.sql — Constitution 3 §55–57, §88, §147 (Step 5, Oct 3 2026): a typed log of authentication events
-- (sign-in success / failure, MFA failure, recovery code used, refresh-token reuse, step-up, device trust/revoke/block,
-- sign-out), and each session's authentication strength. Credentials never reach this table: the writer scrubs any
-- password / code / token / secret key and masks identifiers before insert.
CREATE TABLE IF NOT EXISTS auth_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type   TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  user_id      UUID REFERENCES users (id) ON DELETE SET NULL,
  tenant_id    UUID,
  session_id   UUID,
  ip           TEXT,
  user_agent   TEXT,
  reason       TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT auth_events_outcome_check CHECK (outcome IN ('success', 'failure', 'info'))
);
CREATE INDEX IF NOT EXISTS ix_auth_events_user ON auth_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_auth_events_type ON auth_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_auth_events_tenant ON auth_events (tenant_id, occurred_at DESC);
-- How strongly THIS session was authenticated, and when the password was last proved (sign-in or step-up).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_primary_auth_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_strength TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS step_up_strength TEXT;
