-- 885_customer_note_sources.sql — Customer Notes 6 · 05 "Source / provenance labels" (extras, Nov 12 2026).
--
-- A note's text never said where it came from. A person now states it, per note and tied to the EXACT text they labelled
-- (content_hash = sha256 of the note text, the same rule as customer_note_reviews, migration 843): an edit of the note means the
-- label no longer applies and the note shows "source not stated" again — a label is never carried over to text nobody labelled.
--   customer_reported — the customer said it (e.g. at check-in)
--   staff_observed    — a staff member saw it during service
--   source_confirmed  — checked against a source; the source is REQUIRED in reference (e.g. "signed intake form, Nov 2")
--   ai_suggested      — reserved for a note an AI drafted; people cannot set it (the endpoint refuses), and no AI path writes
--                       notes today, so nothing is labelled AI-suggested unless an AI writer is ever added
-- Visit notes (tickets.service_done_notes) are written by staff at Service Done, so they read as staff-observed without a row here.
-- Append-only (no UPDATE / DELETE): the latest label of the current text wins; older labels stay as history. The note text
-- stays where it is (customers.notes_json); nothing here edits a note or a review.
-- Rollback: DROP TABLE customer_note_sources.
CREATE TABLE IF NOT EXISTS customer_note_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  customer_id     UUID NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('general', 'service_preference', 'technician_preference', 'allergy', 'warning')),
  content_hash    TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source          TEXT NOT NULL CHECK (source IN ('customer_reported', 'staff_observed', 'source_confirmed', 'ai_suggested')),
  reference       TEXT CHECK (reference IS NULL OR length(reference) <= 200),
  set_by_user_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (source <> 'source_confirmed' OR length(btrim(coalesce(reference, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS ix_customer_note_sources_latest ON customer_note_sources (tenant_id, customer_id, category, created_at DESC);

CREATE OR REPLACE FUNCTION customer_note_sources_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_customer_note_sources_append_only ON customer_note_sources;
CREATE TRIGGER trg_customer_note_sources_append_only BEFORE UPDATE OR DELETE ON customer_note_sources
  FOR EACH ROW EXECUTE FUNCTION customer_note_sources_append_only();
