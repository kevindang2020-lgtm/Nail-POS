-- 720_retention_settings_recovery.sql — Customer Retention Complete Build Guide (Oct 30 2026). EXPAND-ONLY and idempotent.
--
--   tenant_retention_settings         one row per salon: the At Risk threshold (default 60 full local days), the
--                                     Approaching Risk start (default 45), the campaign observation window for
--                                     "returned after campaign" (default 30 days) and a settings version that every
--                                     retention read reports. No row = the documented defaults. Edits are audited
--                                     (audit_events, module 'retention', action retention.settings.updated).
--   retention_sms_recipients          the eligibility check gains 'upcoming_booking' (suppression: a customer with a
--                                     booked / confirmed appointment from today on is never sent a "we miss you" text).
--   indexes                           visit lookups by customer and the recovery report's ticket scan.
--
-- Recovery: rolling the code back leaves the table unread; the widened check constraint accepts every old value.
-- Nothing existing is rewritten or dropped.

CREATE TABLE IF NOT EXISTS tenant_retention_settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES tenants(id),
  risk_days                 integer NOT NULL DEFAULT 60 CHECK (risk_days BETWEEN 14 AND 730),
  approaching_days          integer NOT NULL DEFAULT 45 CHECK (approaching_days BETWEEN 7 AND 729),
  observation_window_days   integer NOT NULL DEFAULT 30 CHECK (observation_window_days BETWEEN 1 AND 180),
  version                   integer NOT NULL DEFAULT 1,
  updated_by_user_id        uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_retention_settings_order CHECK (approaching_days < risk_days)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retention_sms_recipients_eligibility_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%upcoming_booking%') THEN
    ALTER TABLE retention_sms_recipients DROP CONSTRAINT retention_sms_recipients_eligibility_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'retention_sms_recipients_eligibility_check') THEN
    ALTER TABLE retention_sms_recipients ADD CONSTRAINT retention_sms_recipients_eligibility_check CHECK (eligibility = ANY (ARRAY[
      'eligible', 'no_phone', 'invalid_phone', 'no_consent', 'opted_out', 'recently_contacted', 'never_visited', 'not_found',
      'duplicate_destination', 'upcoming_booking']::text[]));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tickets_tenant_customer_visit_idx ON tickets (tenant_id, customer_id, status) WHERE customer_id IS NOT NULL AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS pos_tech_appointments_tenant_customer_date_idx ON pos_tech_appointments (tenant_id, customer_id, appt_date) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS retention_sms_recipients_tenant_customer_idx ON retention_sms_recipients (tenant_id, customer_id, created_at);
