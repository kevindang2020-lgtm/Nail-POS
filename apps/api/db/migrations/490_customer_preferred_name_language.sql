-- 490_customer_preferred_name_language.sql — Functional Decision 1: the customer profile carries a preferred name, a
-- preferred language and a preferred branch as PROFILE fields.
-- They existed only inside customers.notes_json (the private-notes blob), so only staff allowed to edit private notes
-- could set them, nothing could search them, and the booking board / queue / Technician App never saw them.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_language TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_branch_id UUID;

-- Carry over what staff already typed into the notes form. Branch: only when the note names one of THIS salon's
-- branches (case-insensitive); anything else stays in the note and is not guessed.
UPDATE customers SET preferred_name = left(btrim(notes_json::jsonb ->> 'preferredName'), 60)
  WHERE preferred_name IS NULL AND notes_json IS NOT NULL AND btrim(coalesce(notes_json::jsonb ->> 'preferredName', '')) <> '';
UPDATE customers SET preferred_language = left(btrim(notes_json::jsonb ->> 'preferredLanguage'), 40)
  WHERE preferred_language IS NULL AND notes_json IS NOT NULL AND btrim(coalesce(notes_json::jsonb ->> 'preferredLanguage', '')) <> '';
UPDATE customers c SET preferred_branch_id = b.id
  FROM branches b
  WHERE c.preferred_branch_id IS NULL AND c.notes_json IS NOT NULL AND b.tenant_id = c.tenant_id
    AND lower(btrim(c.notes_json::jsonb ->> 'preferredBranch')) = lower(btrim(b.name)) AND btrim(coalesce(c.notes_json::jsonb ->> 'preferredBranch', '')) <> '';
