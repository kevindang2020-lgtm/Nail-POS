-- 321_customer_notes_json.sql — persistence for the full CustomerNotes object (allergyNotes, warnings,
-- preferredStyle, preferredTechnician, servicePreferences, customerVisible). The notes API + in-memory
-- repo already modeled all of these, but the Postgres adapter only persisted salonNotes (customers.notes).
-- A single JSONB column stores the complete object; salonNotes + warnings stay mirrored to the legacy
-- customers.notes / customers.safety_notes columns for existing readers. Completes the feature.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes_json JSONB;
