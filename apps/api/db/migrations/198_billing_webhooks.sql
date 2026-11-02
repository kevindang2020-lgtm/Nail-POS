-- 198_billing_webhooks.sql — idempotent billing-provider webhook ingestion. Dedup by provider_event_id (UNIQUE) so the
-- same event is never processed twice (no double-paid invoice, no duplicate credit). Also seeds a few historical
-- software payment attempts (dev fixtures) so Failed vs Recovered analytics render with a real recovered rate.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL DEFAULT 'fiserv',
  provider_event_id  TEXT NOT NULL UNIQUE,
  event_type         TEXT NOT NULL,
  invoice_id         UUID,
  status             TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','ignored','error')),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_type ON billing_webhook_events (event_type, received_at DESC);

-- Historical payment attempts (dev fixtures) across the last 5 weeks: some failed, some recovered (succeeded with a
-- recovered_from_status linking to the prior failed obligation). Attached to seeded invoices; production data comes from
-- real retries. Idempotent on idempotency_key.
DO $$
DECLARE fail_inv uuid; pd_inv uuid; t1 uuid := 'e167929e-8d62-4de5-8a0b-0b727d08be38';
BEGIN
  SELECT id INTO fail_inv FROM billing_invoices WHERE invoice_number='INV-2026-0309';
  SELECT id INTO pd_inv FROM billing_invoices WHERE invoice_number='INV-2026-0312';
  -- Guard: fixtures depend on 195's seed invoices, which only exist on demo-seeded databases.
  IF fail_inv IS NULL OR pd_inv IS NULL THEN
    RAISE NOTICE '198_billing_webhooks: seed invoices not present — skipping fixtures (clean database)';
    RETURN;
  END IF;
  INSERT INTO billing_payment_attempts (invoice_id, tenant_id, amount_cents, status, idempotency_key, recovered_from_status, attempt_number, created_at)
  SELECT * FROM (VALUES
    (fail_inv, t1, 15900, 'failed',    'seed-att-1', NULL,       1, now() - interval '28 days'),
    (fail_inv, t1, 15900, 'succeeded', 'seed-att-2', 'failed',   2, now() - interval '27 days'),
    (pd_inv,   t1, 19900, 'failed',    'seed-att-3', NULL,       1, now() - interval '21 days'),
    (pd_inv,   t1, 19900, 'failed',    'seed-att-4', NULL,       2, now() - interval '14 days'),
    (fail_inv, t1, 15900, 'succeeded', 'seed-att-5', 'past_due', 1, now() - interval '7 days')
  ) v(invoice_id, tenant_id, amount_cents, status, idempotency_key, recovered_from_status, attempt_number, created_at)
  WHERE NOT EXISTS (SELECT 1 FROM billing_payment_attempts WHERE idempotency_key='seed-att-1');
END $$;
