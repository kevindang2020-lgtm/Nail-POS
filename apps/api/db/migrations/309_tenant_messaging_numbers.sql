-- 309_tenant_messaging_numbers.sql — maps an inbound messaging number (e.g. a tenant's Twilio SMS number) back to the
-- tenant that owns it. Required for multi-tenant inbound at scale: when Twilio POSTs an inbound SMS (a customer texting
-- STOP, START, or a reply) the webhook only knows the To number, so it must resolve To → tenant to record the opt-out
-- against the right tenant. One number belongs to at most one tenant (UNIQUE), and lookups are by number.
CREATE TABLE IF NOT EXISTS tenant_messaging_numbers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  phone_number  TEXT NOT NULL,             -- E.164, e.g. +18565551234
  channel       TEXT NOT NULL DEFAULT 'sms',
  provider      TEXT NOT NULL DEFAULT 'twilio',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_messaging_number ON tenant_messaging_numbers (phone_number);
CREATE INDEX IF NOT EXISTS idx_tenant_messaging_numbers_tenant ON tenant_messaging_numbers (tenant_id);
