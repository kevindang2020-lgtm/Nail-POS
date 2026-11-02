-- 728_ai_invoices_branch_settings.sql — Four-Module Completion Guide (Oct 30 2026) §11 + §12, items AI-01 and AI-02.
-- EXPAND-ONLY and idempotent (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS). Nothing existing is rewritten.
--
-- Audit (what already existed and why these tables are still needed)
--   tenant_ai_subscriptions (090)   one row per tenant × AI package: status, price, period — the ENTITLEMENT, no money
--   ai_billing_events (092)         deduplicated provider events that move the subscription status; NO amounts
--   billing_invoices / _lines (195) the platform's SOFTWARE-plan invoices (plan_code), written by the Super Admin billing
--                                   cycle — not linked to AI packages, no provider invoice id, no proration lines
--   billing_webhook_events (198)    dedupe for the software-plan webhook (provider_event_id), not AI
-- So no record linked an AI package subscription to a provider invoice, tax, proration, payment or refund. Added:
--
--   ai_billing_invoice_links            one row per provider invoice that bills AI packages for a tenant: provider ids,
--                                       number, date, period, status, currency and the provider's own amounts (subtotal,
--                                       tax — NULL = not provided, never invented — discounts, credits, prorations, total,
--                                       paid, refunded, due). Updated only by a NEWER provider snapshot (provider_updated_at).
--   ai_billing_invoice_line_snapshots   the invoice's lines as last received (package code, kind, signed amount, proration)
--   ai_billing_invoice_events           append-only ingest log, UNIQUE (provider, provider_event_id): a re-delivered webhook
--                                       is recorded once and changes nothing
--   ai_billing_reconciliation_runs      each read-only re-read of the provider (manual / scheduled / test): counts, status,
--                                       visible error. A run NEVER charges and never edits live billing.
--   tenant_ai_branch_settings           per-branch operational override of a TENANT-WIDE AI package (AI-02):
--                                       override_enabled NULL = inherit the salon default; validated settings_json; version
--   tenant_ai_branch_settings_history   append-only history of every branch change (who, from → to, version)
--   ai_usage_logs.branch_id             nullable; written by the AI gateway from now on when the request has a branch.
--                                       Older rows stay NULL = "branch attribution unavailable" (never guessed).
--
-- Recovery: rolling back the code leaves these tables unread (the gate treats a missing branch row as "inherit"). Dropping
-- the history / event tables would lose evidence — forward-fix only.

CREATE TABLE IF NOT EXISTS ai_billing_invoice_links (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  provider               text NOT NULL,
  provider_invoice_id    text NOT NULL,
  invoice_number         text,
  package_code           text,                 -- the AI package when the invoice bills exactly one (else NULL; lines carry it)
  subscription_id        uuid,                 -- tenant_ai_subscriptions.id at link time (informational)
  status                 text NOT NULL CHECK (status IN ('draft', 'open', 'finalized', 'paid', 'void', 'uncollectible')),
  currency               text NOT NULL DEFAULT 'USD',
  invoice_date           date,
  period_start           date,
  period_end             date,
  subtotal_cents         bigint,
  tax_cents              bigint,               -- NULL = the provider gave no tax figure (shown Pending / Unknown)
  discount_cents         bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  credit_cents           bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  proration_cents        bigint NOT NULL DEFAULT 0,   -- signed net of proration lines
  total_cents            bigint,
  amount_paid_cents      bigint NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  amount_refunded_cents  bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0),
  amount_due_cents       bigint,
  finalized_at           timestamptz,
  paid_at                timestamptz,
  voided_at              timestamptz,
  reference              text,                 -- provider reference / hosted invoice id (never a secret)
  provider_updated_at    timestamptz NOT NULL,
  snapshot_hash          text NOT NULL,
  source                 text NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
  last_event_id          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_billing_invoice_links UNIQUE (tenant_id, provider, provider_invoice_id)
);
CREATE INDEX IF NOT EXISTS ai_billing_invoice_links_tenant_idx ON ai_billing_invoice_links (tenant_id, invoice_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ai_billing_invoice_links_pkg_idx ON ai_billing_invoice_links (tenant_id, package_code);

CREATE TABLE IF NOT EXISTS ai_billing_invoice_line_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  invoice_link_id    uuid NOT NULL REFERENCES ai_billing_invoice_links(id),
  provider_line_id   text NOT NULL,
  package_code       text,
  kind               text NOT NULL CHECK (kind IN ('subscription', 'proration', 'usage', 'tax', 'discount', 'credit', 'other')),
  description        text,
  quantity           integer NOT NULL DEFAULT 1,
  amount_cents       bigint NOT NULL,          -- signed (credits / proration credits are negative)
  period_start       date,
  period_end         date,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_billing_invoice_line UNIQUE (invoice_link_id, provider_line_id)
);
CREATE INDEX IF NOT EXISTS ai_billing_invoice_lines_tenant_idx ON ai_billing_invoice_line_snapshots (tenant_id, package_code);

CREATE TABLE IF NOT EXISTS ai_billing_invoice_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenants(id),
  provider             text NOT NULL,
  provider_event_id    text NOT NULL,
  provider_invoice_id  text,
  event_type           text NOT NULL,
  outcome              text NOT NULL CHECK (outcome IN ('created', 'updated', 'unchanged', 'stale', 'rejected')),
  reason               text,
  run_id               uuid,
  received_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_billing_invoice_events UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS ai_billing_invoice_events_tenant_idx ON ai_billing_invoice_events (tenant_id, received_at DESC);
CREATE OR REPLACE FUNCTION ai_billing_invoice_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ai_billing_invoice_events is append-only'; END $$;
DROP TRIGGER IF EXISTS ai_billing_invoice_events_no_change ON ai_billing_invoice_events;
CREATE TRIGGER ai_billing_invoice_events_no_change BEFORE UPDATE OR DELETE ON ai_billing_invoice_events
  FOR EACH ROW EXECUTE FUNCTION ai_billing_invoice_events_append_only();

CREATE TABLE IF NOT EXISTS ai_billing_reconciliation_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  provider           text,
  trigger            text NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'test')),
  status             text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  idempotency_key    text,
  invoices_seen      integer NOT NULL DEFAULT 0,
  created_count      integer NOT NULL DEFAULT 0,
  updated_count      integer NOT NULL DEFAULT 0,
  unchanged_count    integer NOT NULL DEFAULT 0,
  stale_count        integer NOT NULL DEFAULT 0,
  rejected_count     integer NOT NULL DEFAULT 0,
  error_code         text,
  error_text         text,
  actor_user_id      uuid,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  CONSTRAINT uq_ai_billing_reconciliation_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_billing_reconciliation_runs_tenant_idx ON ai_billing_reconciliation_runs (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tenant_ai_branch_settings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  package_code       text NOT NULL,
  override_enabled   boolean,                  -- NULL = inherit the salon default
  settings_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version            integer NOT NULL DEFAULT 1,
  updated_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_ai_branch_settings UNIQUE (tenant_id, branch_id, package_code),
  CONSTRAINT tenant_ai_branch_settings_obj CHECK (jsonb_typeof(settings_json) = 'object')
);

CREATE TABLE IF NOT EXISTS tenant_ai_branch_settings_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  branch_id            uuid NOT NULL,
  package_code         text NOT NULL,
  version              integer NOT NULL,
  from_override        boolean,
  to_override          boolean,
  from_settings        jsonb,
  to_settings          jsonb NOT NULL,
  actor_user_id        uuid,
  actor_role           text,
  reason               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_ai_branch_settings_history UNIQUE (tenant_id, branch_id, package_code, version)
);
CREATE OR REPLACE FUNCTION tenant_ai_branch_settings_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tenant_ai_branch_settings_history is append-only'; END $$;
DROP TRIGGER IF EXISTS tenant_ai_branch_settings_history_no_change ON tenant_ai_branch_settings_history;
CREATE TRIGGER tenant_ai_branch_settings_history_no_change BEFORE UPDATE OR DELETE ON tenant_ai_branch_settings_history
  FOR EACH ROW EXECUTE FUNCTION tenant_ai_branch_settings_history_append_only();

ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS branch_id uuid;
CREATE INDEX IF NOT EXISTS ai_usage_logs_branch_idx ON ai_usage_logs (tenant_id, package_code, branch_id, created_at) WHERE branch_id IS NOT NULL;
