-- 136_support_sessions.sql
-- "Request a session" workflows for human support (spec §21–22): live chat, remote-support, and callback requests.
-- No live agent is connected in-app, so a request simply records intent + (for remote support) explicit consent,
-- and stays 'requested' until support follows up out-of-band. Remote support REQUIRES recorded consent (the
-- service enforces it); every request writes an audit event. Tenant-scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS support_session_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID,
  requested_by_user_id  UUID NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('live_chat','remote_support','callback')),
  topic                 TEXT,
  ticket_id             UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  consent_granted       BOOLEAN NOT NULL DEFAULT false,
  consent_text          TEXT,
  contact_method        TEXT,
  contact_value         TEXT,
  status                TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested','scheduled','active','completed','canceled','declined')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_session_requests_tenant ON support_session_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_session_requests_creator ON support_session_requests (tenant_id, requested_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_session_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     UUID NOT NULL REFERENCES support_session_requests(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  kind           TEXT NOT NULL,
  detail         TEXT,
  actor_user_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_session_events_request ON support_session_events (request_id, created_at);
