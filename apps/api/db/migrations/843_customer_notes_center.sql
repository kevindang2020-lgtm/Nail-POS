-- 843_customer_notes_center.sql — Customer Notes SUNMI guide (Nov 9 2026): the salon-wide notes workspace.
--
-- The notes themselves stay where they are (ONE source): customers.notes_json (+ the legacy customers.notes /
-- customers.safety_notes mirrors) and tickets.service_done_notes (visit notes written at Service Done). No second notes
-- table. Two additions only:
--   • customers.notes_updated_at — when the notes object was last saved (the workspace's "Updated" date; customers.updated_at
--     changes for every profile edit, so it cannot date a note).
--   • customer_note_reviews — the human Review & Accuracy step for safety notes (allergies / sensitivities and critical
--     service warnings). Append-only: a review is tied to the exact text it confirmed (content_hash = sha256 of the note
--     text, core sha256(), no pgcrypto), so a later edit puts the note back into "needs review" by itself.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_note_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  customer_id       UUID NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('allergy', 'warning')),
  content_hash      TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  decision          TEXT NOT NULL CHECK (decision IN ('confirmed', 'needs_correction')),
  reason            TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  reviewer_user_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_customer_note_reviews_latest ON customer_note_reviews (tenant_id, customer_id, category, created_at DESC);
