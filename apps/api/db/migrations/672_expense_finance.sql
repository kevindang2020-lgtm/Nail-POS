-- 672_expense_finance.sql — Receipt, Expense, Invoice, OCR & Accounting Intelligence (Kevin's master mandate, Oct 21 2026).
--
-- "A receipt is evidence. An expense is the business record. Every dollar must be traceable."
--
-- This UPGRADES the existing ledger rather than adding a second one (§9: no ExpenseV2):
--   * expenses (056) stays THE business record. It gains a lifecycle (draft → pending_review → approved → voided), a
--     version for concurrent edits, the money breakdown (subtotal / tax / tip / fees / discount; amount_cents stays the
--     total), the vendor link, the receipt link, bill + reimbursement state, duplicate state and approval stamps.
--   * ocr_documents (344) stays THE receipt evidence (original bytes in the private bucket, pages, extraction). An expense
--     points at its receipt; a receipt may exist before it becomes an expense (§10).
--   * inventory_vendors (108) stays THE vendor directory (tenant-private, §44). expenses.vendor keeps the RAW receipt text
--     (§46) and expenses.vendor_id the normalized vendor.
--
-- Existing rows: every expense already recorded was entered by an owner and counted in net profit, so it becomes
-- `approved` (nothing a salon already reports changes). Its free-text category is kept VERBATIM in category_raw and the
-- category becomes one of the ten short owner categories (§4) — "supplies" and "Supplies" were being reported as two.
-- Money stays integer cents (§14).

-- ── expenses: the business record ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS kind                 TEXT NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS category_raw         TEXT,
  ADD COLUMN IF NOT EXISTS category_source      TEXT NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS vendor_id            UUID REFERENCES inventory_vendors(id),
  ADD COLUMN IF NOT EXISTS receipt_document_id  UUID REFERENCES ocr_documents(id),
  ADD COLUMN IF NOT EXISTS subtotal_cents       BIGINT CHECK (subtotal_cents IS NULL OR subtotal_cents >= 0),
  ADD COLUMN IF NOT EXISTS tax_cents            BIGINT CHECK (tax_cents IS NULL OR tax_cents >= 0),
  ADD COLUMN IF NOT EXISTS tip_cents            BIGINT CHECK (tip_cents IS NULL OR tip_cents >= 0),
  ADD COLUMN IF NOT EXISTS fee_cents            BIGINT CHECK (fee_cents IS NULL OR fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS discount_cents       BIGINT CHECK (discount_cents IS NULL OR discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS currency             TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_method       TEXT,
  ADD COLUMN IF NOT EXISTS card_brand           TEXT,
  ADD COLUMN IF NOT EXISTS card_last4           TEXT,
  ADD COLUMN IF NOT EXISTS receipt_number       TEXT,
  ADD COLUMN IF NOT EXISTS invoice_number       TEXT,
  ADD COLUMN IF NOT EXISTS reference_number     TEXT,
  ADD COLUMN IF NOT EXISTS due_date             DATE,
  ADD COLUMN IF NOT EXISTS bill_status          TEXT,
  ADD COLUMN IF NOT EXISTS paid_cents           BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  ADD COLUMN IF NOT EXISTS paid_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursement_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reimburse_user_id    UUID,
  ADD COLUMN IF NOT EXISTS reimbursed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurring            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_status     TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS duplicate_of_id      UUID REFERENCES expenses(id),
  ADD COLUMN IF NOT EXISTS duplicate_reason     TEXT,
  ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tax_review_status    TEXT NOT NULL DEFAULT 'not_reviewed',
  ADD COLUMN IF NOT EXISTS accountant_note      TEXT,
  ADD COLUMN IF NOT EXISTS approved_by          UUID,
  ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason      TEXT,
  ADD COLUMN IF NOT EXISTS voided_by            UUID,
  ADD COLUMN IF NOT EXISTS voided_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason          TEXT,
  ADD COLUMN IF NOT EXISTS archived_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by          UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key      TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(4,3) CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS review_flags         JSONB NOT NULL DEFAULT '[]',   -- §36–38: only these fields need a person's eye
  ADD COLUMN IF NOT EXISTS bill_reminder_kind   TEXT,                          -- the last bill reminder sent: due_soon | due_today | overdue
  ADD COLUMN IF NOT EXISTS bill_reminded_on     DATE,                          -- … and the salon-local day it went out (one per kind per day)
  ADD COLUMN IF NOT EXISTS version              INTEGER NOT NULL DEFAULT 1;

-- the short owner categories (§4): legacy free text → one of the ten keys; the original words stay in category_raw
UPDATE expenses SET category_raw = category WHERE category_raw IS NULL;
UPDATE expenses SET category = CASE
    WHEN lower(btrim(category)) IN ('rent', 'landlord', 'rent / landlord', 'lease', 'cam') THEN 'rent'
    WHEN lower(btrim(category)) IN ('supplies', 'supply', 'inventory', 'products', 'product') THEN 'supplies'
    WHEN lower(btrim(category)) IN ('equipment', 'furniture') THEN 'equipment'
    WHEN lower(btrim(category)) IN ('utilities', 'utility', 'bills', 'utilities / bills', 'electric', 'internet', 'phone') THEN 'utilities'
    WHEN lower(btrim(category)) IN ('marketing', 'advertising', 'ads') THEN 'marketing'
    WHEN lower(btrim(category)) IN ('maintenance', 'repairs', 'repair', 'repairs / maintenance') THEN 'repairs'
    WHEN lower(btrim(category)) IN ('insurance') THEN 'insurance'
    WHEN lower(btrim(category)) IN ('software', 'subscriptions', 'subscription', 'software / subscriptions') THEN 'software'
    WHEN lower(btrim(category)) IN ('payroll', 'wages', 'salary', 'salaries') THEN 'payroll'
    ELSE 'other' END
  WHERE category NOT IN ('rent', 'supplies', 'equipment', 'utilities', 'marketing', 'repairs', 'insurance', 'software', 'payroll', 'other');
UPDATE expenses SET source = 'legacy' WHERE source = 'manual' AND created_at < now();

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_status_check CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'voided'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_kind_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_kind_check CHECK (kind IN ('expense', 'bill'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_bill_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_bill_status_check CHECK (bill_status IS NULL OR bill_status IN ('open', 'partially_paid', 'paid', 'voided'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_bill_shape_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_bill_shape_check CHECK ((kind = 'bill') = (bill_status IS NOT NULL));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_reimbursement_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_reimbursement_status_check CHECK (reimbursement_status IN ('not_required', 'pending', 'approved', 'paid', 'rejected'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_duplicate_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_duplicate_status_check CHECK (duplicate_status IN ('none', 'possible', 'exact', 'overridden', 'confirmed_duplicate'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_source_check CHECK (source IN ('manual', 'ocr', 'import', 'payroll', 'legacy'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_source_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_source_check CHECK (category_source IN ('owner', 'owner_rule', 'vendor_rule', 'system_rule', 'ai', 'fallback'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_payment_method_check CHECK (payment_method IS NULL OR payment_method IN ('business_card', 'cash', 'check', 'ach', 'bank_transfer', 'personal_card', 'other'));
-- §61: a printed brand + last four only — never a PAN, CVV or track data
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_card_last4_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_card_last4_check CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_tax_review_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_tax_review_status_check CHECK (tax_review_status IN ('not_reviewed', 'reviewed', 'question'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_currency_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_currency_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_paid_le_total_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_paid_le_total_check CHECK (paid_cents <= amount_cents);

-- one expense per receipt (an OCR posting retried, or a double-tapped Save, never makes two — §123 / §193)
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_receipt_document ON expenses (tenant_id, receipt_document_id)
  WHERE receipt_document_id IS NOT NULL AND status <> 'voided';
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_idempotency ON expenses (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- §152: the queries the reports, inbox and duplicate check actually run
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status_date ON expenses (tenant_id, status, incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_branch_date ON expenses (tenant_id, branch_id, incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_category_date ON expenses (tenant_id, category, incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_vendor ON expenses (tenant_id, vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_bills ON expenses (tenant_id, bill_status, due_date) WHERE kind = 'bill';
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_invoice ON expenses (tenant_id, invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_amount_date ON expenses (tenant_id, amount_cents, incurred_on);

-- B-12: a tenant → tenant foreign key carries the same-salon guard
-- expenses.branch_id never had a tenant-consistency trigger (found by the finance pgtest: an expense could name another
-- salon's branch when the caller's branch check was bypassed). Existing rows are not re-validated; every new write is.
DROP TRIGGER IF EXISTS trg_tc_expenses__branch_id ON expenses;
CREATE TRIGGER trg_tc_expenses__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON expenses FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
CREATE TRIGGER trg_tc_expenses__vendor_id BEFORE INSERT OR UPDATE OF tenant_id, vendor_id ON expenses FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('inventory_vendors', 'vendor_id');
CREATE TRIGGER trg_tc_expenses__receipt_document_id BEFORE INSERT OR UPDATE OF tenant_id, receipt_document_id ON expenses FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('ocr_documents', 'receipt_document_id');
CREATE TRIGGER trg_tc_expenses__duplicate_of_id BEFORE INSERT OR UPDATE OF tenant_id, duplicate_of_id ON expenses FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'duplicate_of_id');

-- ── owner categories: the ten defaults are code (§4); a tenant's custom ones and accounting codes are rows (§5–6) ────
CREATE TABLE IF NOT EXISTS expense_categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  key              TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  label            TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  is_system        BOOLEAN NOT NULL DEFAULT false,        -- a row for a default key carries only the accounting mapping
  accounting_code  TEXT CHECK (accounting_code IS NULL OR char_length(accounting_code) <= 60),
  active           BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  CONSTRAINT expense_categories_tenant_key UNIQUE (tenant_id, key)
);

-- ── categorization rules: owner locks and learned vendor rules, tenant-private (§41, §150, §174) ────────────────────
CREATE TABLE IF NOT EXISTS expense_category_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  vendor_norm    TEXT NOT NULL CHECK (char_length(vendor_norm) BETWEEN 1 AND 120),
  vendor_id      UUID REFERENCES inventory_vendors(id),
  keyword        TEXT CHECK (keyword IS NULL OR char_length(keyword) BETWEEN 1 AND 60),   -- vendor + line-item rule (§42 #3)
  category_key   TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'learned' CHECK (kind IN ('owner_lock', 'learned')),
  hit_count      INTEGER NOT NULL DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_rules_scope ON expense_category_rules (tenant_id, vendor_norm, COALESCE(keyword, '')) WHERE active;
CREATE TRIGGER trg_tc_expense_category_rules__vendor_id BEFORE INSERT OR UPDATE OF tenant_id, vendor_id ON expense_category_rules FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('inventory_vendors', 'vendor_id');

-- ── line items: optional detail (§15–16) ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_line_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  expense_id             UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  line_number            INTEGER NOT NULL CHECK (line_number >= 1),
  description            TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  quantity               NUMERIC(12,3),
  unit_price_cents       BIGINT,
  total_cents            BIGINT NOT NULL,
  suggested_category_key TEXT,
  final_category_key     TEXT,
  confidence             NUMERIC(4,3),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_line_items_number UNIQUE (tenant_id, expense_id, line_number)
);
CREATE INDEX IF NOT EXISTS idx_expense_lines_expense ON expense_line_items (tenant_id, expense_id);
CREATE TRIGGER trg_tc_expense_line_items__expense_id BEFORE INSERT OR UPDATE OF tenant_id, expense_id ON expense_line_items FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'expense_id');

-- ── branch allocation of one shared expense (§68–69): the rows sum EXACTLY to the expense total (service + test) ────
CREATE TABLE IF NOT EXISTS expense_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  expense_id    UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents >= 0),
  basis_points  INTEGER CHECK (basis_points IS NULL OR basis_points BETWEEN 0 AND 10000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_allocations_one_per_branch UNIQUE (tenant_id, expense_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_expense_alloc_branch ON expense_allocations (tenant_id, branch_id);
CREATE TRIGGER trg_tc_expense_allocations__expense_id BEFORE INSERT OR UPDATE OF tenant_id, expense_id ON expense_allocations FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'expense_id');
CREATE TRIGGER trg_tc_expense_allocations__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON expense_allocations FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

-- ── evidence attached to an expense: the receipt, extra pages / invoice / supporting files, a replacement (§10, §84) ──
CREATE TABLE IF NOT EXISTS expense_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  expense_id    UUID NOT NULL REFERENCES expenses(id),
  document_id   UUID NOT NULL REFERENCES ocr_documents(id),
  role          TEXT NOT NULL DEFAULT 'receipt' CHECK (role IN ('receipt', 'invoice', 'supporting', 'replacement')),
  attached_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_documents_once UNIQUE (tenant_id, expense_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_expense_docs_expense ON expense_documents (tenant_id, expense_id);
CREATE TRIGGER trg_tc_expense_documents__expense_id BEFORE INSERT OR UPDATE OF tenant_id, expense_id ON expense_documents FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'expense_id');
CREATE TRIGGER trg_tc_expense_documents__document_id BEFORE INSERT OR UPDATE OF tenant_id, document_id ON expense_documents FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('ocr_documents', 'document_id');

-- ── bill payments: a bill is paid in one or more payments (§54–55) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_bill_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  expense_id     UUID NOT NULL REFERENCES expenses(id),
  amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
  paid_on        DATE NOT NULL,
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('business_card', 'cash', 'check', 'ach', 'bank_transfer', 'personal_card', 'other')),
  reference      TEXT CHECK (reference IS NULL OR char_length(reference) <= 80),
  recorded_by    UUID,
  idempotency_key TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_bill_payments ON expense_bill_payments (tenant_id, expense_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_bill_payments_idem ON expense_bill_payments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER trg_tc_expense_bill_payments__expense_id BEFORE INSERT OR UPDATE OF tenant_id, expense_id ON expense_bill_payments FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'expense_id');

-- ── change history: before / after / actor / reason / time for every change to an expense (§80–81, §134, §204) ──────
CREATE TABLE IF NOT EXISTS expense_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  expense_id     UUID NOT NULL REFERENCES expenses(id),
  action         TEXT NOT NULL,
  actor_user_id  UUID,
  reason         TEXT,
  before_state   JSONB,
  after_state    JSONB,
  version        INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_history ON expense_history (tenant_id, expense_id, created_at);
CREATE TRIGGER trg_tc_expense_history__expense_id BEFORE INSERT OR UPDATE OF tenant_id, expense_id ON expense_history FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('expenses', 'expense_id');

-- ── expense settings, one row per salon (§176) ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_settings (
  tenant_id             UUID PRIMARY KEY REFERENCES tenants(id),
  require_approval      BOOLEAN NOT NULL DEFAULT true,     -- §82: AI extracts, an owner / manager approves
  auto_ready            BOOLEAN NOT NULL DEFAULT true,     -- high-confidence extraction lands Ready (still not approved)
  auto_category         BOOLEAN NOT NULL DEFAULT true,
  learn_from_corrections BOOLEAN NOT NULL DEFAULT true,    -- §41: a repeated correction becomes a tenant vendor rule
  duplicate_detection   BOOLEAN NOT NULL DEFAULT true,
  bill_reminder_days    INTEGER NOT NULL DEFAULT 7 CHECK (bill_reminder_days BETWEEN 0 AND 60),
  default_branch_id     UUID REFERENCES branches(id),
  receptionist_upload   BOOLEAN NOT NULL DEFAULT false,    -- §74
  technician_upload     BOOLEAN NOT NULL DEFAULT false,    -- §75
  version               INTEGER NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID
);
CREATE TRIGGER trg_tc_expense_settings__default_branch_id BEFORE INSERT OR UPDATE OF tenant_id, default_branch_id ON expense_settings FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'default_branch_id');

-- ── §70: tenant row-level security on the expense tables and the receipt evidence (same policy as 544; inert until
-- DB_TENANT_RLS=1 sets app.tenant_id) ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'expense_categories', 'expense_category_rules', 'expense_line_items', 'expense_allocations',
                           'expense_documents', 'expense_bill_payments', 'expense_history', 'expense_settings',
                           'ocr_documents', 'ocr_document_files', 'ocr_document_pages', 'ocr_extracted_fields', 'ocr_line_items']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_session_unrestricted() OR tenant_id = app_session_tenant()) '
                   'WITH CHECK (app_session_unrestricted() OR tenant_id = app_session_tenant())', t);
  END LOOP;
END $$;
