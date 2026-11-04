-- 803_messaging_number_branch.sql — C4 audit (Nov 4 2026): tenant_messaging_numbers.branch_id (309) was never written, so a
-- text to a branch's own Twilio number was filed salon-wide and answered from the salon number. The write path now records
-- the branch; this backfills numbers that are a branch credential's sending number.
UPDATE tenant_messaging_numbers n SET branch_id = c.branch_id, updated_at = now()
  FROM tenant_messaging_credentials c
 WHERE c.tenant_id = n.tenant_id AND c.branch_id IS NOT NULL AND c.from_number = n.phone_number AND n.branch_id IS NULL;
