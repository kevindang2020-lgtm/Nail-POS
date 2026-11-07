-- 840_payments_is_test.sql — Fiserv master build §12.7 / §14 (Nov 5 2026): UAT card payments are TEST-ONLY.
--
-- "Keep all UAT revenue, tax and settlement data clearly marked as test-only and excluded from platform business
-- analytics" / "AI PowerSalon isolated UAT test tickets do not appear in production financial totals."
--
-- A payment is test-only when a processor charged it (fiserv / cardpointe / clover / commercehub / sandbox) while the
-- merchant that charges its branch is NOT in production — the branch's own merchant account if it has one, else the
-- tenant default (the same precedence as PaymentGatewayResolver.resolve). No real money moves on a UAT MID.
-- NOT test: cash, gift cards, and a card recorded from an outside terminal (processor none/null) — those are real money.
--
-- Set by a trigger, so every writer (POS, customer display, Customer App, Tap to Pay, mobile checkout) is covered without
-- trusting each code path. Platform (Super Admin) money totals filter is_test = false; transaction lists keep the rows,
-- labelled. Rollback: DROP TRIGGER trg_payments_is_test ON payments; DROP FUNCTION payments_mark_test(); then the column.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION payments_mark_test() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE env TEXT;
BEGIN
  IF lower(coalesce(NEW.processor, '')) LIKE 'sandbox%' THEN
    NEW.is_test := true; RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.processor, '')) NOT IN ('fiserv', 'cardpointe', 'clover', 'commercehub', 'commercehub_ttp', 'fiserv_ttp') THEN
    NEW.is_test := false; RETURN NEW;
  END IF;
  SELECT m.environment INTO env FROM payment_merchant_accounts m
   WHERE m.tenant_id::text = NEW.tenant_id::text AND m.branch_id::text = NEW.branch_id::text LIMIT 1;
  IF NOT FOUND THEN
    SELECT c.environment INTO env FROM tenant_payment_config c WHERE c.tenant_id::text = NEW.tenant_id::text LIMIT 1;
  END IF;
  NEW.is_test := coalesce(env, 'sandbox') <> 'production';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_is_test ON payments;
CREATE TRIGGER trg_payments_is_test BEFORE INSERT OR UPDATE OF processor, tenant_id, branch_id ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_mark_test();

-- Backfill: the same rule for rows written before this migration (no production card traffic exists before
-- certification, so this marks only sandbox/UAT card payments). Touches processor-charged rows only.
UPDATE payments p SET is_test = true
 WHERE NOT p.is_test
   AND (lower(coalesce(p.processor, '')) LIKE 'sandbox%'
        OR (lower(coalesce(p.processor, '')) IN ('fiserv', 'cardpointe', 'clover', 'commercehub', 'commercehub_ttp', 'fiserv_ttp')
            AND coalesce((SELECT m.environment FROM payment_merchant_accounts m WHERE m.tenant_id::text = p.tenant_id::text AND m.branch_id::text = p.branch_id::text LIMIT 1),
                         (SELECT c.environment FROM tenant_payment_config c WHERE c.tenant_id::text = p.tenant_id::text LIMIT 1),
                         'sandbox') <> 'production'));

