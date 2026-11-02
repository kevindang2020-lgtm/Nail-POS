-- 711_finance_one_screen.sql — Deposits & Settlements, AI Deposit Reconciliation and Invoices mandates (Oct 29 2026).
-- Additive only: no existing column is dropped or rewritten, no posted bank history is changed.
--
--   reconciliation_allocations   the auditable link between a processor settlement's expected payout and a bank deposit
--                                (spec Deposit §09 / Settlements §07 "Match allocation"). Replaces the 1:1
--                                bank_deposits.matched_settlement_id for matching: one settlement → many deposits (split),
--                                many settlements → one deposit (combined), partial amounts. A row is IMMUTABLE once
--                                written (amount, sides, evidence, actor); an unmatch stamps unmatched_* — it is never
--                                deleted. The service checks, under row locks, that the active allocations of a
--                                settlement never exceed its expected payout and those of a deposit never exceed its amount.
--   reconciliation_notes         review notes on a settlement, a bank deposit or an exception (append-only).
--   bank_accounts.is_default     the default account for Record a Deposit (one per tenant) + deactivated_* stamps.
--   bank_deposits.*              who recorded a manual deposit, its notes, the request idempotency key and a normalised
--                                reference for the duplicate check.
--   invoice_payments             immutable payment entries posted against an invoice (Record Payment — not a card charge).
--   invoices.*                   the bill-to snapshot taken at creation (name / phone / email as they were), the digits of
--                                that phone for search, discount, sent / paid / void stamps and the void reason.
--
-- Existing 1:1 links (bank_deposits.matched_settlement_id) are carried into allocations ONCE, as source 'legacy_link', for
-- the smaller of the deposit amount and the settlement's expected payout — so no reconciled history disappears.

CREATE TABLE IF NOT EXISTS reconciliation_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id         UUID NOT NULL REFERENCES payment_settlements(id) ON DELETE RESTRICT,
  deposit_id            UUID NOT NULL REFERENCES bank_deposits(id) ON DELETE RESTRICT,
  amount_cents          BIGINT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  source                TEXT NOT NULL DEFAULT 'manual',
  evidence_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  note                  TEXT,
  idempotency_key       TEXT,
  created_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmatched_at          TIMESTAMPTZ,
  unmatched_by_user_id  UUID,
  unmatch_reason        TEXT,
  CONSTRAINT reconciliation_allocations_amount_check CHECK (amount_cents > 0),
  CONSTRAINT reconciliation_allocations_source_check CHECK (source IN ('manual', 'suggestion_accepted', 'legacy_link')),
  CONSTRAINT reconciliation_allocations_unmatch_check CHECK ((unmatched_at IS NULL) = (unmatch_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_allocations_idem ON reconciliation_allocations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recon_allocations_settlement ON reconciliation_allocations (tenant_id, settlement_id) WHERE unmatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recon_allocations_deposit ON reconciliation_allocations (tenant_id, deposit_id) WHERE unmatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recon_allocations_tenant_created ON reconciliation_allocations (tenant_id, created_at DESC, id DESC);

-- an allocation's facts never change; only the unmatch stamps may be set, once
CREATE OR REPLACE FUNCTION reconciliation_allocations_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reconciliation allocations are never deleted (unmatch instead)' USING ERRCODE = '42501'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.settlement_id <> OLD.settlement_id OR NEW.deposit_id <> OLD.deposit_id
     OR NEW.amount_cents <> OLD.amount_cents OR NEW.currency <> OLD.currency OR NEW.source <> OLD.source
     OR NEW.evidence_json IS DISTINCT FROM OLD.evidence_json OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at <> OLD.created_at
     OR (OLD.unmatched_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a reconciliation allocation is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reconciliation_allocations_immutable ON reconciliation_allocations;
CREATE TRIGGER trg_reconciliation_allocations_immutable BEFORE UPDATE OR DELETE ON reconciliation_allocations
  FOR EACH ROW EXECUTE FUNCTION reconciliation_allocations_immutable();

CREATE TABLE IF NOT EXISTS reconciliation_notes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type           TEXT NOT NULL,
  target_id             UUID NOT NULL,
  body                  TEXT NOT NULL,
  author_user_id        UUID,
  author_role           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_notes_target_check CHECK (target_type IN ('settlement', 'deposit', 'exception')),
  CONSTRAINT reconciliation_notes_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_recon_notes_target ON reconciliation_notes (tenant_id, target_type, target_id, created_at DESC);

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS deactivated_by_user_id UUID;
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS created_by_user_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_default ON bank_accounts (tenant_id) WHERE is_default;

ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS created_by_user_id UUID;
ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE bank_deposits ADD COLUMN IF NOT EXISTS reference_normalized TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_deposits_idem ON bank_deposits (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
UPDATE bank_deposits SET reference_normalized = nullif(regexp_replace(upper(reference), '[^A-Z0-9]', '', 'g'), '')
 WHERE reference IS NOT NULL AND reference_normalized IS NULL;

-- carry the existing 1:1 links into allocations (once; the legacy columns stay as they were)
INSERT INTO reconciliation_allocations (tenant_id, settlement_id, deposit_id, amount_cents, currency, source, evidence_json, created_at)
SELECT d.tenant_id, d.matched_settlement_id, d.id,
       least(d.amount_cents, coalesce(s.expected_net_cents, s.net_cents)), d.currency, 'legacy_link',
       jsonb_build_object('basis', 'legacy_link', 'legacyStatus', d.reconciliation_status), coalesce(d.updated_at, d.created_at)
  FROM bank_deposits d JOIN payment_settlements s ON s.id = d.matched_settlement_id AND s.tenant_id = d.tenant_id
 WHERE d.matched_settlement_id IS NOT NULL
   AND least(d.amount_cents, coalesce(s.expected_net_cents, s.net_cents)) > 0
   AND NOT EXISTS (SELECT 1 FROM reconciliation_allocations a WHERE a.tenant_id = d.tenant_id AND a.deposit_id = d.id AND a.source = 'legacy_link');

CREATE TABLE IF NOT EXISTS invoice_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id            UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents          BIGINT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  paid_on               DATE NOT NULL,
  method                TEXT NOT NULL,
  reference             TEXT,
  note                  TEXT,
  idempotency_key       TEXT NOT NULL,
  recorded_by_user_id   UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_payments_amount_check CHECK (amount_cents > 0),
  CONSTRAINT invoice_payments_method_check CHECK (method IN ('cash', 'check', 'card_external', 'bank_transfer', 'other'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payments_idem ON invoice_payments (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (tenant_id, invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant_paid_on ON invoice_payments (tenant_id, paid_on);

CREATE OR REPLACE FUNCTION invoice_payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'invoice payment entries are immutable' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_invoice_payments_immutable ON invoice_payments;
CREATE TRIGGER trg_invoice_payments_immutable BEFORE UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION invoice_payments_immutable();

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_to_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_to_phone TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_to_phone_digits TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_to_email TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_by_user_id UUID;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_idem ON invoices (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
