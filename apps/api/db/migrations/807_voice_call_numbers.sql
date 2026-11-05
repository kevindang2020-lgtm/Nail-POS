-- 807_voice_call_numbers.sql — A10 AI Calls (Nov 5 2026): the caller's number and the salon number that was dialed, kept on
-- the canonical call record from the provider's signed lifecycle events (first value wins). The list shows the caller masked
-- unless the viewer may see customer contact details.
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS caller_number TEXT;
ALTER TABLE voice_call_outcomes ADD COLUMN IF NOT EXISTS dialed_number TEXT;
