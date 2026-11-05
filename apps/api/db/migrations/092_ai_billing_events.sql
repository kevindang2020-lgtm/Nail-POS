-- 092_ai_billing_events.sql — append-only ledger of processed AI-subscription billing events. Gives idempotency
-- (UNIQUE event_id, so a re-delivered webhook is a no-op) and an audit trail of every status transition the billing
-- sync applied. A provider-specific webhook adapter (which verifies the signature and maps the raw event) normalizes
-- into this; the sync claims the event here first, then updates tenant_ai_subscriptions.
CREATE TABLE IF NOT EXISTS ai_billing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT NOT NULL,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  package_code    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  provider        TEXT,
  from_status     TEXT,
  to_status       TEXT,
  payment_status  TEXT,
  applied         BOOLEAN NOT NULL DEFAULT false,
  raw_json        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS ai_billing_events_tenant_pkg_idx ON ai_billing_events (tenant_id, package_code, created_at DESC);
