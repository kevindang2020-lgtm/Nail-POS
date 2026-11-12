-- 847_catalog_category_reviews.sql — SERVICE PRICING 13 (extras, Nov 12 2026): Owner Review for Suspicious Categories.
--
-- Service Categories already lists things a person should look at (catalog-screens.repository categoryReview: a category
-- named like a code, a hair-sounding service in a nails-sounding category, an empty category) and never changes them. This
-- adds the human decision on each finding, without touching the catalog: "approved as is" (the owner/manager confirms the
-- finding is fine, with a note) or "reopened" (back in the queue). Append-only — the latest row per finding wins, and the
-- whole history stays. A decision is tied to the ORIGINAL ids AND the names it was made on (category_name / service_name):
-- a rename puts the finding back in the queue by itself. Fixing a real mistake stays the existing audited Move services.
CREATE TABLE IF NOT EXISTS catalog_category_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  branch_id         UUID,
  kind              TEXT NOT NULL CHECK (kind IN ('code_like_name', 'service_category_mismatch', 'empty')),
  category_id       UUID NOT NULL,
  service_id        UUID,
  category_name     TEXT NOT NULL CHECK (length(category_name) <= 200),
  service_name      TEXT CHECK (service_name IS NULL OR length(service_name) <= 200),
  decision          TEXT NOT NULL CHECK (decision IN ('approved_as_is', 'reopened')),
  note              TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 500),
  reviewer_user_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_catalog_category_reviews_service CHECK ((kind = 'service_category_mismatch') = (service_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_catalog_category_reviews_latest ON catalog_category_reviews (tenant_id, kind, category_id, service_id, created_at DESC);

-- append-only: a decision is never edited or deleted (a change of mind is a new row)
CREATE OR REPLACE FUNCTION catalog_category_reviews_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalog_category_reviews is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_catalog_category_reviews_append_only ON catalog_category_reviews;
CREATE TRIGGER trg_catalog_category_reviews_append_only BEFORE UPDATE OR DELETE ON catalog_category_reviews
  FOR EACH ROW EXECUTE FUNCTION catalog_category_reviews_append_only();
