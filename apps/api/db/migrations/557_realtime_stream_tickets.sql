-- 557_realtime_stream_tickets.sql — BUILD_PLAN Phase 13 (Constitution 6 §28–32, audit bug 1): native realtime.
--
-- A browser's EventSource sends the httpOnly session cookie; a native Capacitor shell has no cookie (its origin is
-- capacitor://localhost) and an EventSource cannot send an Authorization header. Putting the bearer token in the stream
-- URL would write a 15-minute credential into proxy and access logs. So the native app asks for a STREAM TICKET
-- (POST /realtime/stream-ticket, bearer-authenticated) and opens the stream with `?ticket=`:
--   • single use       redeemed with one UPDATE … WHERE used_at IS NULL … RETURNING — a replayed URL is refused
--   • short-lived      expires_at = issued + 60 s
--   • bound            to the session (sid; a revoked session's ticket is refused at redemption and the stream ends when
--                      the session is revoked), the realm (a tenant ticket cannot open the customer stream), the tenant
--                      and branch the session holds, and the device that asked (X-Device-ID)
--   • never the token  only its SHA-256 is stored; the row holds the session's verified CLAIMS (not its signed token)
--                      so the redeemed request is authorized exactly like the bearer call that asked for the ticket.
--
-- Keyed by a person's session, not by a salon — the same class as `sessions` / `refresh_tokens` (D, IDENTITY; no RLS:
-- redemption happens before any tenant context exists, by hash). Expired rows are deleted by the central retention
-- executor (retention-policy.json: temporary, 1 day after expires_at).
CREATE TABLE IF NOT EXISTS realtime_stream_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash    text NOT NULL CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  session_id     text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 200),
  realm          text NOT NULL CHECK (realm IN ('tenant', 'customer', 'platform')),
  user_id        text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 120),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id      uuid,
  device_id      text CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  claims         jsonb NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT realtime_stream_tickets_short_lived CHECK (expires_at <= created_at + interval '5 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_realtime_stream_tickets_hash ON realtime_stream_tickets (ticket_hash);
CREATE INDEX IF NOT EXISTS ix_realtime_stream_tickets_expiry ON realtime_stream_tickets (expires_at);
CREATE INDEX IF NOT EXISTS ix_realtime_stream_tickets_session ON realtime_stream_tickets (session_id);
COMMENT ON TABLE realtime_stream_tickets IS 'Single-use 60-second tickets that open a realtime SSE stream from a native app without a cookie or a bearer in the URL (Phase 13, Constitution 6 §28–32).';
