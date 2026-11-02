-- 195_billing_subscriptions.sql — software-subscription billing (tenant → AI PowerSalon). Adds invoices, invoice lines,
-- credits, and discounts for SOFTWARE billing (never merchant/customer card transactions — those live under Payments &
-- Revenue). Reuses the canonical subscription_plans / plan_add_ons catalogs and existing tenant_subscriptions,
-- subscription_changes, tenant_add_ons, payment_attempts. Money is integer cents; invoice numbers are unique; finalized
-- invoices are immutable by convention. Seeds realistic data across the two real tenants (honest counts, not the image's
-- fixtures). Idempotent on invoice_number / discount code / natural keys.

CREATE TABLE IF NOT EXISTS billing_invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number       TEXT NOT NULL UNIQUE,
  tenant_id            UUID NOT NULL,
  plan_code            TEXT,
  currency             TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents       BIGINT NOT NULL DEFAULT 0,
  discount_total_cents BIGINT NOT NULL DEFAULT 0,
  credit_total_cents   BIGINT NOT NULL DEFAULT 0,
  tax_total_cents      BIGINT NOT NULL DEFAULT 0,
  total_cents          BIGINT NOT NULL DEFAULT 0,
  amount_paid_cents    BIGINT NOT NULL DEFAULT 0,
  amount_due_cents     BIGINT NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','partially_paid','past_due','failed','void','refunded','uncollectible')),
  retry_status         TEXT,
  invoice_date         DATE,
  due_date             DATE,
  period_start         DATE,
  period_end           DATE,
  finalized_at         TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  last_action          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON billing_invoices (tenant_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status ON billing_invoices (status, due_date);

CREATE TABLE IF NOT EXISTS billing_invoice_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan','addon','usage','fee','discount','credit','tax')),
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  amount_cents  BIGINT NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_lines_invoice ON billing_invoice_lines (invoice_id);

CREATE TABLE IF NOT EXISTS billing_credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  amount_cents      BIGINT NOT NULL,
  remaining_cents   BIGINT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  reason            TEXT NOT NULL DEFAULT 'billing_correction',
  source            TEXT,
  related_invoice_id UUID,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','applied','expired','void')),
  expires_at        TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_credits_tenant ON billing_credits (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_discounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID,
  code           TEXT NOT NULL,
  discount_type  TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  percent        INTEGER,
  amount_cents   BIGINT,
  applies_to     TEXT NOT NULL DEFAULT 'plan',
  starts_at      DATE,
  ends_at        DATE,
  cycles         INTEGER,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','scheduled','expired','void')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_discounts_tenant_code ON billing_discounts (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- ---- Seed ----
DO $$
DECLARE
  t1 uuid := 'e167929e-8d62-4de5-8a0b-0b727d08be38';  -- Pilot Nail Salon
  t2 uuid := 'd45202a2-9910-4431-966e-0e372a702251';  -- Second Salon
  inv uuid; premium int := 19900; growth int := 15900; b1 uuid;
BEGIN
  -- Guard: fixtures only apply on demo-seeded databases (clean DBs skip; keeps migrations
  -- runnable from scratch). The DDL above always applies.
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = t1) OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = t2) THEN
    RAISE NOTICE '195_billing_subscriptions: demo tenants not present — skipping fixtures (clean database)';
    RETURN;
  END IF;
  SELECT id INTO b1 FROM branches WHERE tenant_id = t1 ORDER BY created_at LIMIT 1;
  -- Anchor the two tenant subscriptions onto real plans (idempotent overwrite of nulls).
  UPDATE tenant_subscriptions SET plan_code='premium', monthly_price_cents=premium, billing_interval='month',
    current_period_start = COALESCE(current_period_start, now() - interval '10 days'),
    current_period_end = COALESCE(current_period_end, now() + interval '20 days'), status='active' WHERE tenant_id=t1;
  UPDATE tenant_subscriptions SET plan_code='growth', monthly_price_cents=growth, billing_interval='month',
    current_period_start = COALESCE(current_period_start, now() - interval '5 days'),
    current_period_end = COALESCE(current_period_end, now() + interval '25 days'), status='trialing' WHERE tenant_id=t2;

  -- Add-ons (tenant_add_ons): T1 AI Receptionist + Smart Reminders; T2 Additional Locations.
  INSERT INTO tenant_add_ons (tenant_id, add_on_id, quantity, price_cents, status, started_at, created_at)
  SELECT t1, pa.id, 1, pa.unit_price_cents, 'active', now() - interval '20 days', now() - interval '20 days'
  FROM plan_add_ons pa WHERE pa.code IN ('ai_receptionist','advanced_analytics')
    AND NOT EXISTS (SELECT 1 FROM tenant_add_ons ta WHERE ta.tenant_id=t1 AND ta.add_on_id=pa.id);
  INSERT INTO tenant_add_ons (tenant_id, add_on_id, quantity, price_cents, status, started_at, created_at)
  SELECT t2, pa.id, 2, pa.unit_price_cents, 'active', now() - interval '15 days', now() - interval '15 days'
  FROM plan_add_ons pa WHERE pa.code IN ('marketing_suite')
    AND NOT EXISTS (SELECT 1 FROM tenant_add_ons ta WHERE ta.tenant_id=t2 AND ta.add_on_id=pa.id);

  -- Invoices across statuses. Helper inline.
  -- T1: two paid, one past_due, one open.
  IF NOT EXISTS (SELECT 1 FROM billing_invoices WHERE invoice_number='INV-2026-0312') THEN
    INSERT INTO billing_invoices (invoice_number, tenant_id, plan_code, subtotal_cents, tax_total_cents, total_cents, amount_paid_cents, amount_due_cents, status, invoice_date, due_date, period_start, period_end, finalized_at, paid_at, last_action)
    VALUES
      ('INV-2026-0312', t1, 'premium', premium, 0, premium, 0, premium, 'past_due', now()-interval '8 days', now()-interval '1 day', now()-interval '8 days', now()+interval '22 days', now()-interval '8 days', NULL, 'retry_scheduled'),
      ('INV-2026-0311', t1, 'premium', premium, 0, premium, premium, 0, 'paid', now()-interval '38 days', now()-interval '31 days', now()-interval '38 days', now()-interval '8 days', now()-interval '38 days', now()-interval '37 days', 'paid'),
      ('INV-2026-0309', t2, 'growth', growth, 0, growth, 0, growth, 'failed', now()-interval '6 days', now()-interval '2 days', now()-interval '6 days', now()+interval '24 days', now()-interval '6 days', NULL, 'retry_exhausted'),
      ('INV-2026-0308', t2, 'growth', growth, 0, growth, growth, 0, 'paid', now()-interval '36 days', now()-interval '29 days', now()-interval '36 days', now()-interval '6 days', now()-interval '36 days', now()-interval '35 days', 'paid'),
      ('INV-2026-0307', t1, 'premium', premium, 0, premium, 0, premium, 'open', now()-interval '1 day', now()+interval '6 days', now()-interval '1 day', now()+interval '29 days', now()-interval '1 day', NULL, 'issued');
    UPDATE billing_invoices SET retry_status = CASE WHEN status='past_due' THEN 'Retry 2 of 3' WHEN status='failed' THEN 'Exhausted' ELSE NULL END WHERE retry_status IS NULL AND status IN ('past_due','failed');
  END IF;

  -- Invoice lines (plan charge per invoice).
  INSERT INTO billing_invoice_lines (invoice_id, tenant_id, kind, description, quantity, unit_price_cents, amount_cents)
  SELECT i.id, i.tenant_id, 'plan', UPPER(i.plan_code) || ' plan (monthly)', 1, i.subtotal_cents, i.subtotal_cents
  FROM billing_invoices i WHERE NOT EXISTS (SELECT 1 FROM billing_invoice_lines l WHERE l.invoice_id = i.id);

  -- Credits: T1 service-recovery credit (partially used), T2 billing-correction credit.
  INSERT INTO billing_credits (tenant_id, amount_cents, remaining_cents, reason, source, status, created_at)
  SELECT t1, 5000, 3000, 'service_recovery', 'support', 'active', now()-interval '4 days'
  WHERE NOT EXISTS (SELECT 1 FROM billing_credits WHERE tenant_id=t1 AND reason='service_recovery');
  INSERT INTO billing_credits (tenant_id, amount_cents, remaining_cents, reason, source, status, created_at)
  SELECT t2, 2000, 2000, 'billing_correction', 'admin', 'active', now()-interval '2 days'
  WHERE NOT EXISTS (SELECT 1 FROM billing_credits WHERE tenant_id=t2 AND reason='billing_correction');

  -- Discounts.
  INSERT INTO billing_discounts (tenant_id, code, discount_type, percent, applies_to, starts_at, ends_at, cycles, status)
  SELECT t1, 'LAUNCH20', 'percent', 20, 'plan', (now()-interval '30 days')::date, (now()+interval '60 days')::date, 3, 'active'
  WHERE NOT EXISTS (SELECT 1 FROM billing_discounts WHERE code='LAUNCH20');
  INSERT INTO billing_discounts (tenant_id, code, discount_type, amount_cents, applies_to, starts_at, ends_at, status)
  SELECT t2, 'GROW10', 'fixed', 1000, 'plan', (now()-interval '10 days')::date, (now()+interval '80 days')::date, 'active'
  WHERE NOT EXISTS (SELECT 1 FROM billing_discounts WHERE code='GROW10');

  -- Subscription changes incl. a cancellation request.
  INSERT INTO subscription_changes (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, reason, created_at)
  SELECT * FROM (VALUES
    (t1, 'premium', 'enterprise', 'upgrade', 'immediate', 'pending', now()+interval '2 days', 'need more locations', now()-interval '1 day'),
    (t2, 'growth', 'growth', 'cancel', 'end_of_period', 'pending', now()+interval '25 days', 'closing location', now()-interval '2 days')
  ) v(tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, reason, created_at)
  WHERE NOT EXISTS (SELECT 1 FROM subscription_changes sc WHERE sc.tenant_id = v.tenant_id AND sc.change_type = v.change_type);

  -- Software-billing payment outcomes are tracked on the invoice (status + retry_status); merchant/ticket card
  -- transactions live under Payments & Revenue and are intentionally NOT written here.
END $$;
