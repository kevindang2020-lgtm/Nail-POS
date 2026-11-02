-- 371_booking_verification_usage.sql -- daily verification usage, per tenant.
--
-- Why a rollup table and not a COUNT over the sessions:
--
-- `booking_verification_sessions` is DELETED after a short retention window (7 days by default), because it holds
-- a phone hash, an IP and a device id per booking attempt -- a durable record of who tried to book where, from
-- what network. Six months of that is a behavioural dataset nobody asked us to keep.
--
-- But a tenant is still entitled to know how many verification messages they paid for last month. A COUNT over a
-- table we are about to delete is a count that quietly shrinks every night, and their monthly total would fall as
-- the retention window rolled past it.
--
-- So the counts are rolled up BEFORE the rows are purged, into a table that keeps only aggregates: no phone, no
-- hash, no IP, no device. Nothing here identifies a person.
CREATE TABLE IF NOT EXISTS booking_verification_usage_daily (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  usage_date     DATE NOT NULL,

  sent_count     INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  expired_count  INTEGER NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The rollup RECOMPUTES rather than increments, so it is idempotent -- which matters, because a scheduled job
  -- will run twice one day. This constraint is what makes ON CONFLICT DO UPDATE possible.
  UNIQUE (tenant_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_bvud_tenant_date
  ON booking_verification_usage_daily (tenant_id, usage_date DESC);
