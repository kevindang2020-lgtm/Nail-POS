-- 881_deal_commission_reviews.sql — Extras · Deals & Offers 12 "Commission Impact Review: flag deals where commission basis
-- or funding allocation is not approved before production".
--
-- A deal's discount changes what technicians earn: at checkout the compensation engine takes the discount off the
-- commissionable base with the money path's funding allocation (today 'proportional' — technician and salon each give
-- up their share). Nothing recorded that an owner / manager had looked at that impact and accepted it. One row here is
-- that approval: for one deal VERSION (a later edit of the deal's terms needs a new review), the funding allocation the
-- money path used when it was approved, who, when, an optional note. APPEND-ONLY (no UPDATE / DELETE) — a new review is a
-- new row; history is never rewritten. A review never changes a deal, a price, a ticket or anyone's pay.
CREATE TABLE IF NOT EXISTS deal_commission_reviews (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  deal_id              UUID NOT NULL REFERENCES deals(id),
  deal_version         INTEGER NOT NULL CHECK (deal_version >= 1),
  discount_funding     TEXT NOT NULL CHECK (discount_funding IN ('proportional', 'salon_funded', 'technician_funded', 'noncommissionable')),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 500),
  reviewed_by_user_id  UUID,
  reviewed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_deal_commission_reviews_deal ON deal_commission_reviews (tenant_id, deal_id, reviewed_at DESC, id DESC);

-- B-12: a review can never point at another salon's deal
DROP TRIGGER IF EXISTS trg_tc_deal_commission_reviews__deal_id ON deal_commission_reviews;
CREATE TRIGGER trg_tc_deal_commission_reviews__deal_id BEFORE INSERT OR UPDATE OF tenant_id, deal_id ON deal_commission_reviews
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('deals', 'deal_id');

CREATE OR REPLACE FUNCTION deal_commission_reviews_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_deal_commission_reviews_append_only ON deal_commission_reviews;
CREATE TRIGGER trg_deal_commission_reviews_append_only BEFORE UPDATE OR DELETE ON deal_commission_reviews
  FOR EACH ROW EXECUTE FUNCTION deal_commission_reviews_append_only();
