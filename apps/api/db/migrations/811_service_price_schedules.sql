-- 811_service_price_schedules.sql — D4 Service Pricing gaps (Nov 5 2026): a price / duration change can be SCHEDULED for a
-- future date. It is not the current price until it takes effect; a background job applies due schedules (one per service at
-- a time), writing the change log with the scheduled effective time. A schedule can be cancelled before it applies.
CREATE TABLE IF NOT EXISTS service_price_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  branch_id           uuid,
  service_id          uuid NOT NULL,
  price_cents         integer CHECK (price_cents IS NULL OR price_cents >= 0),
  duration_minutes    integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  effective_at        timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'applied', 'cancelled', 'superseded')),
  reason              text NOT NULL,
  created_by_user_id  uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  applied_at          timestamptz,
  cancelled_at        timestamptz,
  cancelled_by_user_id uuid,
  cancel_reason       text,
  CHECK (price_cents IS NOT NULL OR duration_minutes IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_price_schedule_open ON service_price_schedules (tenant_id, service_id) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_service_price_schedules_due ON service_price_schedules (effective_at) WHERE status = 'scheduled';
