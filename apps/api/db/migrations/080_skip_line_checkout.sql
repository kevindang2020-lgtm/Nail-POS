-- 080_skip_line_checkout.sql — Skip-the-Line Checkout. Adds the payment-intent lifecycle, the cash-to-technician
-- confirmation record, and per-tenant settings. Reuses existing tickets/payments/receipts (no invoices table — the
-- "invoice" is the ticket's derived bill; invoice_id stores the ticket id for traceability). Integer cents throughout.

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  ticket_id UUID NOT NULL,
  invoice_id UUID,                                  -- = ticket id (no separate invoices table)
  customer_id UUID,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  method TEXT NOT NULL,                             -- card|apple_pay|google_pay|cash_to_technician|gift_card|split_payment|bnpl
  status TEXT NOT NULL DEFAULT 'created',           -- created|sent_to_customer|processing|requires_action|succeeded|failed|cancelled|expired|cash_pending_tech_confirmation|cash_confirmed_by_tech|cash_issue_needs_front_desk
  gateway TEXT,
  gateway_payment_intent_id TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT payment_intents_method_chk CHECK (method IN ('card','apple_pay','google_pay','cash_to_technician','gift_card','split_payment','bnpl')),
  CONSTRAINT payment_intents_status_chk CHECK (status IN ('created','sent_to_customer','processing','requires_action','succeeded','failed','cancelled','expired','cash_pending_tech_confirmation','cash_confirmed_by_tech','cash_issue_needs_front_desk'))
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_ticket ON payment_intents(tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_customer ON payment_intents(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS cash_payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  ticket_id UUID NOT NULL,
  invoice_id UUID,
  payment_intent_id UUID,
  customer_id UUID,
  technician_id UUID,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  confirmed_by_user_id UUID,
  confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',           -- pending|confirmed|customer_did_not_pay|cancelled|manager_review
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_conf_status_chk CHECK (status IN ('pending','confirmed','customer_did_not_pay','cancelled','manager_review'))
);
CREATE INDEX IF NOT EXISTS idx_cash_conf_tenant ON cash_payment_confirmations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cash_conf_tech ON cash_payment_confirmations(tenant_id, technician_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_conf_ticket ON cash_payment_confirmations(tenant_id, ticket_id);

CREATE TABLE IF NOT EXISTS skip_line_checkout_settings (
  tenant_id UUID PRIMARY KEY,
  feature_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_send_prompt_on_service_done BOOLEAN NOT NULL DEFAULT TRUE,
  require_front_desk_approval BOOLEAN NOT NULL DEFAULT FALSE,
  allow_cash_to_technician BOOLEAN NOT NULL DEFAULT TRUE,
  require_tech_confirmation_for_cash BOOLEAN NOT NULL DEFAULT TRUE,
  manager_approval_over_cents BIGINT NOT NULL DEFAULT 0,   -- 0 = no manager-approval threshold
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
