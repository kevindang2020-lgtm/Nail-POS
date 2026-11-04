-- 787_validate_not_valid_checks.sql — 547 rule (Nov 3 2026): no constraint may stay NOT VALID. 717 (supplier minimum order)
-- and 740 (message template channel) added theirs NOT VALID so the ALTER would not scan a large table under lock; this
-- validates them (VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock). A database that holds a row breaking the
-- rule keeps the constraint NOT VALID (new writes are still checked) instead of failing the migration — the 547 gate
-- reports it there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_vendors_min_order_nonneg' AND NOT convalidated)
     AND NOT EXISTS (SELECT 1 FROM inventory_vendors WHERE minimum_order_cents < 0) THEN
    ALTER TABLE inventory_vendors VALIDATE CONSTRAINT chk_inventory_vendors_min_order_nonneg;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_pmt_channel' AND NOT convalidated)
     AND NOT EXISTS (SELECT 1 FROM pos_message_templates WHERE channel IS NOT NULL AND channel NOT IN ('sms', 'email')) THEN
    ALTER TABLE pos_message_templates VALIDATE CONSTRAINT ck_pmt_channel;
  END IF;
END $$;
