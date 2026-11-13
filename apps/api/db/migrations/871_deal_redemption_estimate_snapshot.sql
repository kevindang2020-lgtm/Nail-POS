-- 871_deal_redemption_estimate_snapshot.sql — Extras · Deals & Offers 08 "Preview vs Paid Comparison".
--
-- A deal / coupon application's discount is re-priced while the ticket is open (lines added or removed, prices changed,
-- another offer won — deals ledger syncAmount overwrites amount_discounted_cents). Nothing kept the figure the desk first
-- saw, so a paid redemption could not be compared with its initial estimate. estimate_snapshot keeps it, written ONCE
-- when the application is created: { discountCents, allocations: [{lineId, cents}], lines: [{lineId, priceCents}] }.
-- It is immutable after that (a trigger refuses any change once set); history is never rewritten. Older rows stay NULL
-- (the comparison says "not recorded" — never a guessed figure). Expand-only, idempotent; money is integer cents.
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS estimate_snapshot JSONB;

CREATE OR REPLACE FUNCTION deal_redemption_estimate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estimate_snapshot IS NOT NULL AND NEW.estimate_snapshot IS DISTINCT FROM OLD.estimate_snapshot THEN
    RAISE EXCEPTION 'deal_redemptions.estimate_snapshot is written once and never changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_deal_redemption_estimate_immutable ON deal_redemptions;
CREATE TRIGGER trg_deal_redemption_estimate_immutable BEFORE UPDATE OF estimate_snapshot ON deal_redemptions
  FOR EACH ROW EXECUTE FUNCTION deal_redemption_estimate_immutable();
