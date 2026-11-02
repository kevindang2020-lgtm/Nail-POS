-- 501_oauth_server.sql — Constitution 3 §79 (Step 10d, Oct 4 2026): AIPowerSalon as an OAuth 2.1 AUTHORIZATION SERVER, so
-- a partner app (a website booking widget, a marketing tool) gets scoped, revocable access to ONE salon without holding a
-- raw API key. (integration_* tables, migration 228, are the opposite direction — AIPowerSalon as a client of others.)
-- Authorization code + PKCE (S256) only. Every secret, code and token is stored as a hash.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  redirect_uris       TEXT[] NOT NULL,
  client_secret_hash  TEXT,                       -- NULL = public client (PKCE alone)
  allowed_scopes      TEXT[] NOT NULL DEFAULT '{}',
  disabled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_grants (           -- one per (salon, app): what the owner approved
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  approved_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  scopes           TEXT[] NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_oauth_grants_tenant ON oauth_grants (tenant_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash             TEXT PRIMARY KEY,
  grant_id              UUID NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash   TEXT PRIMARY KEY,
  grant_id     UUID NOT NULL REFERENCES oauth_grants (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at   TIMESTAMPTZ NOT NULL,
  rotated_at   TIMESTAMPTZ,                         -- a refresh token that was exchanged (reuse = theft → the grant is revoked)
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oauth_tokens_grant ON oauth_tokens (grant_id);
