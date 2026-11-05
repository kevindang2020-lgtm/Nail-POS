-- 172_user_invitations.sql — secure invitation tokens (§23). Replaces the admin-visible temp-password invite with a
-- single-use, expiring, hashed token the invitee redeems to set their own password. Only the token HASH is stored
-- (never the raw token); delivery is tracked so an un-delivered invite is visible rather than silently lost.
CREATE TABLE IF NOT EXISTS user_invitations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID,
  branch_id          UUID,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL,
  invited_by_user_id UUID,
  token_hash         TEXT NOT NULL,                 -- sha-256(token); raw token is never persisted
  token_prefix       TEXT NOT NULL,                 -- short, non-secret display hint
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | expired | cancelled
  delivery_channel   TEXT,                          -- email | sms | manual
  delivery_status    TEXT NOT NULL DEFAULT 'pending', -- pending | delivered | failed | not_connected
  delivery_error     TEXT,
  send_count         INT NOT NULL DEFAULT 1,
  last_sent_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  accepted_user_id   UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_token_hash_uq ON user_invitations (token_hash);
-- at most one OUTSTANDING (pending) invitation per tenant+email (NULL tenant collapses to 'platform' so it is enforced there too)
CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_pending_uq
  ON user_invitations (coalesce(tenant_id::text, 'platform'), lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS user_invitations_status_idx ON user_invitations (status);
CREATE INDEX IF NOT EXISTS user_invitations_tenant_idx ON user_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS user_invitations_email_idx ON user_invitations (lower(email));
