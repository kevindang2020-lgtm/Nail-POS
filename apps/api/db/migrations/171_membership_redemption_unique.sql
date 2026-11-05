-- 171_membership_redemption_unique.sql
-- Hardens double-redemption prevention: a given ticket service line can redeem at most ONE membership benefit. The
-- enrollment service already checks this before inserting, but the partial unique index makes it race-proof at the DB
-- level (two concurrent redemptions of the same line cannot both commit). NULL service_line_id rows (off-ticket
-- redemptions, if any) are exempt from the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS membership_redemptions_service_line_uq
  ON membership_redemptions (service_line_id)
  WHERE service_line_id IS NOT NULL;
