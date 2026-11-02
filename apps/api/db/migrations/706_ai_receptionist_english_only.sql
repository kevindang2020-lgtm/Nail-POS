-- 706_ai_receptionist_english_only.sql — Kevin's decision (Oct 28 2026): the AI phone receptionist speaks ENGLISH ONLY
-- (POSLanguage.pdf §18: a call is a customer communication). The code now always sends 'en-US' to the voice provider and
-- stores 'en'; this brings the saved configuration in line so every screen and report shows the truth.
--   • ai_receptionist_agents.language        'es' / 'vi' / anything → 'en'
--   • ai_receptionist_settings.settings      defaultLanguage → 'en' (only where it was set to something else)
-- Preference data only — no call, booking, payment or customer row is touched. Idempotent. A live agent already created at
-- the voice provider in another language is corrected by its next update / re-provision (the provider adapter now always
-- patches language = en-US).
UPDATE ai_receptionist_agents SET language = 'en' WHERE language IS DISTINCT FROM 'en';

UPDATE ai_receptionist_settings
   SET settings = settings || '{"defaultLanguage":"en"}'::jsonb
 WHERE settings ? 'defaultLanguage' AND settings->>'defaultLanguage' IS DISTINCT FROM 'en';
