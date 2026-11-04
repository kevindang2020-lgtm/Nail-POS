-- 785_membership_member_number_unique.sql — D6 Membership guide (Nov 3 2026).
-- The member number was derived from the first 6 characters of the customer id, so the same customer enrolled twice
-- (or two customers whose ids start alike) got the same "M-XXXXXX" number, and nothing stopped it. New numbers are
-- random and checked inside the enrollment transaction; this index makes a duplicate impossible within a salon.
-- Existing duplicates keep the number on their oldest membership; later ones get "-2", "-3", … so nothing is lost.
-- Rollback: DROP INDEX IF EXISTS ux_customer_memberships_member_number;
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, member_number ORDER BY created_at, id) AS rn
  FROM customer_memberships WHERE member_number IS NOT NULL
)
UPDATE customer_memberships cm SET member_number = cm.member_number || '-' || d.rn::text
FROM d WHERE d.id = cm.id AND d.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_memberships_member_number
  ON customer_memberships (tenant_id, member_number) WHERE member_number IS NOT NULL;
