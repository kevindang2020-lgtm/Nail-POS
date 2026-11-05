-- MERGE: ported from Project B migration 043 (renumbered to avoid collision with Project A 043_*).
-- 043_notification_opt_outs.sql — per-tenant notification opt-out / unsubscribe store. The send path refuses to
-- message any (tenant, channel, address) present here (SMS STOP, email unsubscribe). Tenant-scoped at app level.

CREATE TABLE IF NOT EXISTS notification_opt_outs (
  tenant_id    UUID NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('sms','email')),
  address      TEXT NOT NULL,
  reason       TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, address)
);
